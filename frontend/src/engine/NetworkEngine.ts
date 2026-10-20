// ============================================================
//  engine/NetworkEngine.ts
//  Motor de simulación: ping (ICMP) con ARP, switches que aprenden
//  MACs, routers que enrutan con TTL, pérdida por enlace y DHCP (DORA).
//
//  El motor es síncrono: calcula de una vez todo lo que ocurre y
//  devuelve una línea temporal (animaciones + mensajes con su instante).
//  El store la reproduce después a la velocidad elegida.
// ============================================================

import {
  ArpEntry, Device, Link, LogLevel, LogMessage, LogParams,
  NetworkInterface, PacketKind,
} from '@/types/network';
import { TopologyView } from './algorithms/Topology';
import { findBestRoute } from './algorithms/RoutingEngine';
import {
  broadcastAddress, hasValidAddress, ipInNetwork, ipToNumber, isValidIp,
  networkAddress, numberToIp,
} from './algorithms/NetworkUtils';

/** Duración base (unidades de simulación ≈ ms a velocidad 1×) de cruzar un enlace. */
const HOP_TIME = 520;
const PING_GAP = 450;
const MAX_HOPS = 40;

export interface AnimSpec {
  kind: PacketKind;
  linkId: string;
  from: string;
  to: string;
  start: number;
  duration: number;
  dropAt?: number;
}

export interface TimedLog {
  at: number;
  msg: LogMessage;
}

export interface SimResult {
  devices: Device[];
  anims: AnimSpec[];
  logs: TimedLog[];
  end: number;
}

interface Hop extends Endpoint {
  arrival: number;
  latency: number;  // ms acumulados en un sentido
}

interface Endpoint {
  device: Device;
  iface: NetworkInterface;
}

type Fail = { ok: false; t: number; reason: 'timeout' | 'unreachable' | 'ttl' };

class Sim {
  topo: TopologyView;
  anims: AnimSpec[] = [];
  logs: TimedLog[] = [];
  end = 0;

  constructor(devices: Device[], links: Link[], private lossRoll: () => number) {
    // Copia profunda: el motor modifica ARP, tablas MAC y direcciones DHCP
    this.topo = new TopologyView(structuredClone(devices), links);
  }

  log(at: number, level: LogLevel, source: string, key: string, params?: LogParams) {
    this.logs.push({ at, msg: { level, source, key, params } });
    this.end = Math.max(this.end, at);
  }

  // ── Un salto por un cable ────────────────────────────────
  private traverse(kind: PacketKind, from: Device, iface: NetworkInterface, t: number) {
    const link = this.topo.linkOf(iface)!;
    const to = this.topo.peer(link, from.id)!;
    const duration = HOP_TIME + Math.min(link.latency, 500) * 2;
    const dropped = link.packetLoss > 0 && this.lossRoll() * 100 < link.packetLoss;
    this.anims.push({
      kind, linkId: link.id, from: from.id, to: to.device.id,
      start: t, duration, dropAt: dropped ? 0.55 : undefined,
    });
    this.end = Math.max(this.end, t + duration);
    if (dropped) {
      this.log(t + duration * 0.55, 'warning', `${from.hostname} ↔ ${to.device.hostname}`, 'log.lost', { loss: link.packetLoss });
    }
    return { to, arrival: t + duration, latency: link.latency, dropped };
  }

  private learnMac(sw: Device, mac: string, port: string) {
    const table = sw.macTable ?? (sw.macTable = []);
    const e = table.find(x => x.macAddress === mac);
    if (e) e.port = port;
    else table.push({ macAddress: mac, port });
  }

  private learnArp(dev: Device, entry: ArpEntry) {
    const table = dev.arpTable ?? (dev.arpTable = []);
    const e = table.find(x => x.ip === entry.ip && x.interface === entry.interface);
    if (e) e.mac = entry.mac;
    else table.push(entry);
  }

  /**
   * Trama de broadcast desde `iface`: los switches la inundan por todos sus
   * puertos salvo el de entrada (y aprenden la MAC origen). Devuelve los
   * equipos de capa 3 a los que llega y cuándo.
   */
  private broadcast(kind: PacketKind, dev: Device, iface: NetworkInterface, srcMac: string, t: number): Hop[] {
    const reached: Hop[] = [];
    const seen = new Set<string>();
    const queue: Array<{ dev: Device; ifs: NetworkInterface[]; t: number; lat: number }> = [{ dev, ifs: [iface], t, lat: 0 }];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const out of cur.ifs) {
        if (!this.topo.canTransmit(cur.dev, out)) continue;
        const hop = this.traverse(kind, cur.dev, out, cur.t);
        if (hop.dropped) continue;
        const lat = cur.lat + hop.latency;
        if (hop.to.device.type === 'switch') {
          const sw = hop.to.device;
          this.learnMac(sw, srcMac, hop.to.iface.name);
          if (seen.has(sw.id)) continue;  // sin STP: se corta el bucle para no simular una tormenta
          seen.add(sw.id);
          this.log(hop.arrival, 'info', sw.hostname, 'log.swFlood', { port: hop.to.iface.name });
          queue.push({ dev: sw, ifs: sw.interfaces.filter(i => i.id !== hop.to.iface.id), t: hop.arrival, lat });
        } else {
          reached.push({ ...hop.to, arrival: hop.arrival, latency: lat });
        }
      }
    }
    return reached;
  }

  /**
   * Trama unicast hacia `dstMac`. Cada switch aprende la MAC origen y, si
   * conoce la de destino, la reenvía solo por ese puerto; si no, inunda.
   */
  private unicast(kind: PacketKind, dev: Device, iface: NetworkInterface, srcMac: string, dstMac: string, t: number):
    { ok: true; hop: Hop } | { ok: false; t: number } {
    let cur = dev, out = iface, time = t, lat = 0;
    for (let i = 0; i < MAX_HOPS; i++) {
      if (!this.topo.canTransmit(cur, out)) return { ok: false, t: time };
      const hop = this.traverse(kind, cur, out, time);
      if (hop.dropped) return { ok: false, t: hop.arrival };
      time = hop.arrival;
      lat += hop.latency;
      const nd = hop.to.device;
      if (nd.type !== 'switch') {
        if (hop.to.iface.macAddress !== dstMac) return { ok: false, t: time };
        return { ok: true, hop: { ...hop.to, arrival: time, latency: lat } };
      }
      this.learnMac(nd, srcMac, hop.to.iface.name);
      const known = nd.macTable?.find(e => e.macAddress === dstMac);
      const port = known && nd.interfaces.find(p => p.name === known.port);
      if (port && port.id !== hop.to.iface.id && this.topo.canTransmit(nd, port)) {
        this.log(time, 'info', nd.hostname, 'log.swForward', { mac: dstMac, port: port.name });
        cur = nd;
        out = port;
        continue;
      }
      // MAC desconocida (o puerto caído): inundación y se queda el que tenga esa MAC
      this.log(time, 'info', nd.hostname, 'log.swUnknown', { mac: dstMac });
      const others = nd.interfaces.filter(p => p.id !== hop.to.iface.id);
      const reached: Hop[] = [];
      for (const p of others) reached.push(...this.broadcast(kind, nd, p, srcMac, time));
      const target = reached.find(r => r.iface.macAddress === dstMac);
      if (!target) return { ok: false, t: Math.max(time, ...reached.map(r => r.arrival)) };
      return { ok: true, hop: { ...target, latency: lat + target.latency } };
    }
    return { ok: false, t: time };
  }

  /** ARP: resuelve la MAC de `ip` en la red de `iface` (usa la caché si ya la tiene). */
  private resolve(dev: Device, iface: NetworkInterface, ip: string, t: number):
    { ok: true; mac: string; t: number } | Fail {
    const cached = dev.arpTable?.find(e => e.ip === ip && e.interface === iface.name);
    if (cached) return { ok: true, mac: cached.mac, t };

    this.log(t, 'info', dev.hostname, 'log.arpWho', { ip, me: iface.ipAddress });
    const reached = this.broadcast('arp_request', dev, iface, iface.macAddress, t);
    const owner = reached
      .filter(r => r.iface.ipAddress === ip && r.iface.status === 'up')
      .sort((a, b) => a.arrival - b.arrival)[0];
    if (!owner) {
      const tEnd = Math.max(t + HOP_TIME, ...reached.map(r => r.arrival));
      this.log(tEnd, 'error', dev.hostname, 'log.arpNoReply', { ip });
      return { ok: false, t: tEnd, reason: 'timeout' };
    }
    // El destinatario de la petición aprende también al que pregunta
    this.learnArp(owner.device, { ip: iface.ipAddress, mac: iface.macAddress, interface: owner.iface.name });
    this.log(owner.arrival, 'info', owner.device.hostname, 'log.arpIs', { ip, mac: owner.iface.macAddress });
    const reply = this.unicast('arp_reply', owner.device, owner.iface, owner.iface.macAddress, iface.macAddress, owner.arrival);
    if (!reply.ok) return { ok: false, t: reply.t, reason: 'timeout' };
    this.learnArp(dev, { ip, mac: owner.iface.macAddress, interface: iface.name });
    this.log(reply.hop.arrival, 'info', dev.hostname, 'log.arpLearn', { ip, mac: owner.iface.macAddress });
    return { ok: true, mac: owner.iface.macAddress, t: reply.hop.arrival };
  }

  private owns(dev: Device, ip: string) {
    return dev.status === 'up' && dev.interfaces.some(i => i.status === 'up' && i.ipAddress === ip);
  }

  /**
   * Lleva un paquete IP desde `start` hasta su destino, salto a salto.
   * En cada equipo: elige interfaz de salida y siguiente salto, resuelve ARP
   * y envía la trama. Los routers decrementan el TTL.
   */
  deliverIp(kind: 'icmp_request' | 'icmp_reply', start: Device, srcIp: string, dstIp: string, t: number):
    { ok: true; device: Device; t: number; latency: number; ttl: number; srcIp: string } | Fail {
    let cur = start, time = t, latency = 0, ttl = 64, first = true;

    for (let hops = 0; hops < MAX_HOPS; hops++) {
      if (this.owns(cur, dstIp)) return { ok: true, device: cur, t: time, latency, ttl, srcIp };

      let egress: NetworkInterface | undefined;
      let nextHop: string;

      if (cur.type === 'pc') {
        if (!first) {  // un PC no reenvía paquetes ajenos
          this.log(time, 'warning', cur.hostname, 'log.pcDrop', { dst: dstIp });
          return { ok: false, t: time, reason: 'unreachable' };
        }
        egress = cur.interfaces[0];
        if (!egress || !hasValidAddress(egress)) {
          this.log(time, 'error', cur.hostname, 'log.noIp');
          return { ok: false, t: time, reason: 'unreachable' };
        }
        if (ipInNetwork(dstIp, egress.ipAddress, egress.subnetMask)) {
          nextHop = dstIp;
          this.log(time, 'info', cur.hostname, 'log.sameNet', { dst: dstIp });
        } else {
          const gw = cur.defaultGateway ?? '';
          if (!isValidIp(gw)) {
            this.log(time, 'error', cur.hostname, 'log.noGateway', { dst: dstIp });
            return { ok: false, t: time, reason: 'unreachable' };
          }
          if (!ipInNetwork(gw, egress.ipAddress, egress.subnetMask)) {
            this.log(time, 'error', cur.hostname, 'log.gwOutside', { gw });
            return { ok: false, t: time, reason: 'unreachable' };
          }
          nextHop = gw;
          this.log(time, 'info', cur.hostname, 'log.toGateway', { dst: dstIp, gw });
        }
      } else if (cur.type === 'router') {
        if (!first) {
          ttl -= 1;
          if (ttl <= 0) {
            this.log(time, 'error', cur.hostname, 'log.ttl', { dst: dstIp });
            return { ok: false, t: time, reason: 'ttl' };
          }
        }
        const route = findBestRoute(cur, dstIp);
        if (!route) {
          this.log(time, 'error', cur.hostname, 'log.noRoute', { dst: dstIp });
          return { ok: false, t: time, reason: 'unreachable' };
        }
        if (route.type === 'connected') {
          egress = cur.interfaces.find(i => i.name === route.interface);
          nextHop = dstIp;
        } else {
          nextHop = route.nextHop;
          egress = (route.interface && cur.interfaces.find(i => i.name === route.interface))
            || cur.interfaces.find(i => hasValidAddress(i) && ipInNetwork(nextHop, i.ipAddress, i.subnetMask) && this.topo.canTransmit(cur, i));
        }
        const net = `${route.destination}/${route.subnetMask}`;
        if (!egress || !this.topo.canTransmit(cur, egress)) {
          this.log(time, 'error', cur.hostname, 'log.egressDown', { net });
          return { ok: false, t: time, reason: 'unreachable' };
        }
        this.log(time, 'info', cur.hostname, route.type === 'connected' ? 'log.routeConnected' : 'log.routeVia', {
          dst: dstIp, iface: egress.name, hop: nextHop, type: route.type, ttl,
        });
      } else {
        return { ok: false, t: time, reason: 'unreachable' };
      }

      if (first && !srcIp) srcIp = egress.ipAddress;
      if (!this.topo.canTransmit(cur, egress)) {
        this.log(time, 'error', cur.hostname, 'log.linkDown', { iface: egress.name });
        return { ok: false, t: time, reason: 'unreachable' };
      }

      const arp = this.resolve(cur, egress, nextHop, time);
      if (!arp.ok) return arp;
      const frame = this.unicast(kind, cur, egress, egress.macAddress, arp.mac, arp.t);
      if (!frame.ok) return { ok: false, t: frame.t, reason: 'timeout' };

      time = frame.hop.arrival;
      latency += frame.hop.latency;
      cur = frame.hop.device;
      first = false;
    }
    this.log(time, 'error', cur.hostname, 'log.ttl', { dst: dstIp });
    return { ok: false, t: time, reason: 'ttl' };
  }

  // ════════════════════════════════════════════════════════
  //  PING
  // ════════════════════════════════════════════════════════
  ping(src: Device, dstIp: string, count: number) {
    let t = 0;
    const rtts: number[] = [];
    for (let seq = 1; seq <= count; seq++) {
      this.log(t, 'info', src.hostname, 'log.pingSend', { dst: dstIp, seq });
      if (this.owns(src, dstIp)) {
        this.log(t, 'success', src.hostname, 'log.pingReply', { dst: dstIp, seq, rtt: '<1', ttl: 64 });
        rtts.push(0);
        t += PING_GAP;
        continue;
      }
      const req = this.deliverIp('icmp_request', src, '', dstIp, t);
      if (!req.ok) {
        this.log(req.t, 'error', src.hostname, req.reason === 'timeout' ? 'log.pingTimeout' : req.reason === 'ttl' ? 'log.pingTtl' : 'log.pingUnreachable', { dst: dstIp, seq });
        t = req.t + PING_GAP;
        continue;
      }
      this.log(req.t, 'info', req.device.hostname, 'log.echoRequest', { src: req.srcIp, seq });
      const rep = this.deliverIp('icmp_reply', req.device, dstIp, req.srcIp, req.t);
      if (!rep.ok) {
        this.log(rep.t, 'error', src.hostname, 'log.pingTimeout', { dst: dstIp, seq });
        t = rep.t + PING_GAP;
        continue;
      }
      const rtt = req.latency + rep.latency;
      rtts.push(rtt);
      this.log(rep.t, 'success', src.hostname, 'log.pingReply', { dst: dstIp, seq, rtt, ttl: rep.ttl });
      t = rep.t + PING_GAP;
    }
    if (count > 1) {
      const recv = rtts.length;
      const lostPct = Math.round(((count - recv) / count) * 100);
      this.log(t, recv === count ? 'success' : recv ? 'warning' : 'error', src.hostname, recv ? 'log.pingStats' : 'log.pingStatsNone', {
        dst: dstIp, sent: count, recv, lost: count - recv, pct: lostPct,
        min: recv ? Math.min(...rtts) : 0, max: recv ? Math.max(...rtts) : 0,
        avg: recv ? Math.round(rtts.reduce((a, b) => a + b, 0) / recv) : 0,
      });
    }
  }

  // ════════════════════════════════════════════════════════
  //  DHCP (Discover → Offer → Request → Ack)
  // ════════════════════════════════════════════════════════
  dhcp(pc: Device) {
    const iface = pc.interfaces[0];
    let t = 0;
    if (!iface || !this.topo.canTransmit(pc, iface)) {
      this.log(t, 'error', pc.hostname, 'log.dhcpNoLink');
      return;
    }
    this.log(t, 'info', pc.hostname, 'log.dhcpDiscover');
    const reached = this.broadcast('dhcp', pc, iface, iface.macAddress, t);
    const server = reached
      .filter(r => r.device.type === 'router' && r.iface.dhcpServer && hasValidAddress(r.iface))
      .sort((a, b) => a.arrival - b.arrival)[0];
    if (!server) {
      const tEnd = Math.max(t + HOP_TIME, ...reached.map(r => r.arrival));
      this.log(tEnd, 'error', pc.hostname, 'log.dhcpNoServer');
      return;
    }

    const ip = this.freeAddress(server.iface, pc, iface);
    if (!ip) {
      this.log(server.arrival, 'error', server.device.hostname, 'log.dhcpExhausted');
      return;
    }
    this.log(server.arrival, 'info', server.device.hostname, 'log.dhcpOffer', { ip, host: pc.hostname });
    const offer = this.unicast('dhcp', server.device, server.iface, server.iface.macAddress, iface.macAddress, server.arrival);
    if (!offer.ok) { this.log(offer.t, 'error', pc.hostname, 'log.dhcpTimeout'); return; }
    t = offer.hop.arrival;

    this.log(t, 'info', pc.hostname, 'log.dhcpRequest', { ip });
    const req = this.broadcast('dhcp', pc, iface, iface.macAddress, t).find(r => r.device.id === server.device.id);
    if (!req) { this.log(t + HOP_TIME, 'error', pc.hostname, 'log.dhcpTimeout'); return; }
    this.log(req.arrival, 'info', server.device.hostname, 'log.dhcpAck', { ip });
    const ack = this.unicast('dhcp', server.device, server.iface, server.iface.macAddress, iface.macAddress, req.arrival);
    if (!ack.ok) { this.log(ack.t, 'error', pc.hostname, 'log.dhcpTimeout'); return; }

    iface.ipAddress = ip;
    iface.subnetMask = server.iface.subnetMask;
    pc.defaultGateway = server.iface.ipAddress;
    pc.arpTable = [];
    this.log(ack.hop.arrival, 'success', pc.hostname, 'log.dhcpDone', {
      ip, mask: iface.subnetMask, gw: server.iface.ipAddress,
    });
  }

  /** Primera IP libre de la subred del servidor (desde .100 si la red es grande). */
  private freeAddress(srv: NetworkInterface, pc: Device, pcIface: NetworkInterface): string | null {
    const net = ipToNumber(networkAddress(srv.ipAddress, srv.subnetMask));
    const bcast = ipToNumber(broadcastAddress(srv.ipAddress, srv.subnetMask));
    const size = bcast - net - 1;
    if (size < 1) return null;
    // Si el PC ya tiene una IP válida de esa red, la conserva
    if (hasValidAddress(pcIface) && ipInNetwork(pcIface.ipAddress, srv.ipAddress, srv.subnetMask)
      && !this.isUsed(pcIface.ipAddress, pc)) return pcIface.ipAddress;
    const startOffset = size > 150 ? 100 : 1;
    for (let k = 0; k < size; k++) {
      const ip = numberToIp(net + 1 + ((startOffset - 1 + k) % size));
      if (!this.isUsed(ip, pc)) return ip;
    }
    return null;
  }

  private isUsed(ip: string, except: Device): boolean {
    return this.topo.devices.some(d => d.id !== except.id && d.interfaces.some(i => i.ipAddress === ip));
  }
}

// ── API pública ────────────────────────────────────────────
export function simulatePing(devices: Device[], links: Link[], sourceId: string, dstIp: string, count = 1,
  rnd: () => number = Math.random): SimResult {
  const sim = new Sim(devices, links, rnd);
  const src = sim.topo.byId.get(sourceId);
  if (!src || src.status !== 'up') {
    sim.log(0, 'error', src?.hostname ?? '?', 'log.deviceDown');
  } else if (!isValidIp(dstIp)) {
    sim.log(0, 'error', src.hostname, 'log.badIp', { ip: dstIp });
  } else {
    sim.ping(src, dstIp, Math.max(1, Math.min(10, Math.floor(count))));
  }
  return { devices: sim.topo.devices, anims: sim.anims, logs: sim.logs, end: sim.end };
}

export function simulateDhcp(devices: Device[], links: Link[], pcId: string,
  rnd: () => number = Math.random): SimResult {
  const sim = new Sim(devices, links, rnd);
  const pc = sim.topo.byId.get(pcId);
  if (!pc || pc.status !== 'up' || pc.type !== 'pc') sim.log(0, 'error', pc?.hostname ?? '?', 'log.deviceDown');
  else sim.dhcp(pc);
  return { devices: sim.topo.devices, anims: sim.anims, logs: sim.logs, end: sim.end };
}
