// ============================================================
//  engine/NetworkEngine.ts
//  Motor principal de simulación de red
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import {
  Device, Link, Packet, PacketAnimation, LogEntry,
  MacEntry, RouteEntry,
} from '@/types/network';
import { findBestRoute } from './algorithms/RoutingEngine';
import { ipInNetwork, simulatePacketLoss, generateMac, networkAddress } from './algorithms/NetworkUtils';

// ── Tipos de eventos del motor ────────────────────────────
export type EngineEvent =
  | { type: 'packet_sent';     packet: Packet; fromId: string; toId: string }
  | { type: 'packet_received'; packet: Packet; deviceId: string }
  | { type: 'packet_dropped';  packet: Packet; deviceId: string; reason: string }
  | { type: 'link_down';       linkId: string }
  | { type: 'device_down';     deviceId: string }
  | { type: 'ping_result';     success: boolean; sourceId: string; destIp: string; rtt: number }
  | { type: 'log';             entry: LogEntry };

type EventListener = (event: EngineEvent) => void;

// ── Motor de simulación ───────────────────────────────────
export class NetworkEngine {
  private listeners: EventListener[] = [];

  // ── Suscripción a eventos ──────────────────────────────
  on(listener: EventListener) {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  private emit(event: EngineEvent) {
    this.listeners.forEach(l => l(event));
  }

  private log(
    level: LogEntry['level'],
    source: string,
    message: string
  ): LogEntry {
    const entry: LogEntry = {
      id: uuidv4(),
      timestamp: Date.now(),
      level,
      source,
      message,
    };
    this.emit({ type: 'log', entry });
    return entry;
  }

  // ── Buscar dispositivo/link por ID ─────────────────────
  private findDevice(id: string, devices: Device[]): Device | undefined {
    return devices.find(d => d.id === id);
  }

  private findLink(id: string, links: Link[]): Link | undefined {
    return links.find(l => l.id === id);
  }

  // ── Obtener el link entre dos dispositivos ─────────────
  private getLinkBetween(
    aId: string, bId: string, links: Link[]
  ): Link | undefined {
    return links.find(
      l =>
        l.status === 'up' &&
        ((l.sourceDeviceId === aId && l.targetDeviceId === bId) ||
         (l.sourceDeviceId === bId && l.targetDeviceId === aId))
    );
  }

  // ── Obtener vecinos directamente conectados ────────────
  private getNeighbors(
    deviceId: string,
    devices: Device[],
    links: Link[]
  ): Array<{ device: Device; link: Link }> {
    const result: Array<{ device: Device; link: Link }> = [];
    for (const link of links) {
      if (link.status !== 'up') continue;
      let neighborId: string | null = null;
      if (link.sourceDeviceId === deviceId) neighborId = link.targetDeviceId;
      else if (link.targetDeviceId === deviceId) neighborId = link.sourceDeviceId;
      if (!neighborId) continue;
      const device = this.findDevice(neighborId, devices);
      if (device && device.status === 'up') {
        result.push({ device, link });
      }
    }
    return result;
  }

  // ── Obtener IP de un dispositivo en un link ────────────
  private getInterfaceIpForLink(device: Device, linkId: string): string {
    const iface = device.interfaces.find(i => i.connectedLinkId === linkId);
    return iface?.ipAddress ?? '';
  }

  // ════════════════════════════════════════════════════════
  //  PING  — punto de entrada principal
  // ════════════════════════════════════════════════════════
  ping(
    sourceId: string,
    destIp: string,
    devices: Device[],
    links: Link[]
  ): PacketAnimation[] {
    const source = this.findDevice(sourceId, devices);
    if (!source || source.status !== 'up') {
      this.log('error', 'Sistema', `Dispositivo ${sourceId} no encontrado o apagado`);
      return [];
    }

    this.log('info', source.hostname, `Enviando ping a ${destIp}`);

    const packet: Packet = {
      id: uuidv4(),
      type: 'icmp_request',
      sourceIp: source.interfaces[0]?.ipAddress ?? '0.0.0.0',
      destinationIp: destIp,
      sourceMac: source.interfaces[0]?.macAddress ?? generateMac(),
      destinationMac: 'ff:ff:ff:ff:ff:ff',
      ttl: 64,
      icmpSequence: 1,
    };

    const animations: PacketAnimation[] = [];
    const t0 = Date.now();

    this.routePacket(packet, source, destIp, devices, links, animations, t0);

    return animations;
  }

  // ── Enrutar paquete desde un dispositivo ──────────────
  private routePacket(
    packet: Packet,
    current: Device,
    destIp: string,
    devices: Device[],
    links: Link[],
    animations: PacketAnimation[],
    time: number,
    hops = 0
  ): boolean {
    if (hops > 20) {
      this.log('error', current.hostname, `TTL expirado para paquete a ${destIp}`);
      return false;
    }

    // ── PC: verificar si es el destino ─────────────────
    if (current.type === 'pc') {
      const iface = current.interfaces[0];
      if (iface?.ipAddress === destIp) {
        this.log('success', current.hostname, `Paquete ICMP recibido de ${packet.sourceIp}`);
        this.emit({ type: 'packet_received', packet, deviceId: current.id });
        return true;
      }
      // No es el destino → enviar al gateway
      return this.sendToGateway(packet, current, destIp, devices, links, animations, time, hops);
    }

    // ── Switch: forwarding ──────────────────────────────
    if (current.type === 'switch') {
      return this.switchForward(packet, current, destIp, devices, links, animations, time, hops);
    }

    // ── Router: routing ────────────────────────────────
    if (current.type === 'router') {
      return this.routerForward(packet, current, destIp, devices, links, animations, time, hops);
    }

    return false;
  }

  // ── PC → Gateway ───────────────────────────────────────
  private sendToGateway(
    packet: Packet,
    pc: Device,
    destIp: string,
    devices: Device[],
    links: Link[],
    animations: PacketAnimation[],
    time: number,
    hops: number
  ): boolean {
    if (!pc.defaultGateway) {
      this.log('error', pc.hostname, `Sin gateway configurado. No se puede alcanzar ${destIp}`);
      return false;
    }

    // Buscar el gateway en la red
    const neighbors = this.getNeighbors(pc.id, devices, links);

    for (const { device, link } of neighbors) {
      // Si es el gateway directamente (router con esa IP)
      const gwIface = device.interfaces.find(i => i.ipAddress === pc.defaultGateway);
      if (gwIface || device.type === 'switch') {
        const { anim, newTime } = this.createAnimation(packet, link.id, pc.id, device.id, time, link);
        if (anim) {
          animations.push(anim);
          this.log('info', pc.hostname, `→ ${device.hostname} vía ${link.id.slice(0, 6)} (gateway: ${pc.defaultGateway})`);
          return this.routePacket(packet, device, destIp, devices, links, animations, newTime, hops + 1);
        }
      }
    }

    // Si no encontró el gateway directamente, busca a través de switches
    for (const { device, link } of neighbors) {
      if (device.type === 'switch') {
        const { anim, newTime } = this.createAnimation(packet, link.id, pc.id, device.id, time, link);
        if (anim) {
          animations.push(anim);
          return this.routePacket(packet, device, destIp, devices, links, animations, newTime, hops + 1);
        }
      }
    }

    this.log('error', pc.hostname, `No se encontró ruta al gateway ${pc.defaultGateway}`);
    return false;
  }

  // ── Switch: aprender MAC y reenviar ───────────────────
  private switchForward(
    packet: Packet,
    sw: Device,
    destIp: string,
    devices: Device[],
    links: Link[],
    animations: PacketAnimation[],
    time: number,
    hops: number
  ): boolean {
    this.log('info', sw.hostname, `Reenviando trama (flood/forward) hacia ${destIp}`);

    // Switch hace flood → reenvía a todos los puertos excepto el de entrada
    const neighbors = this.getNeighbors(sw.id, devices, links);

    let success = false;
    for (const { device, link } of neighbors) {
      if (device.status !== 'up') continue;

      const { anim, newTime } = this.createAnimation(packet, link.id, sw.id, device.id, time, link);
      if (anim) {
        animations.push(anim);
        const result = this.routePacket(packet, device, destIp, devices, links, animations, newTime, hops + 1);
        if (result) success = true;
      }
    }
    return success;
  }

  // ── Router: routing table lookup ───────────────────────
  private routerForward(
    packet: Packet,
    router: Device,
    destIp: string,
    devices: Device[],
    links: Link[],
    animations: PacketAnimation[],
    time: number,
    hops: number
  ): boolean {
    // Comprobar si alguna interfaz del router tiene el destino en su red
    for (const iface of router.interfaces) {
      if (!iface.ipAddress || iface.status !== 'up') continue;
      if (iface.ipAddress === destIp) {
        this.log('success', router.hostname, `Paquete llegó a ${destIp}`);
        return true;
      }
      // ¿Destino en una red directamente conectada?
      if (ipInNetwork(destIp, networkAddress(iface.ipAddress, iface.subnetMask), iface.subnetMask)) {
        // Reenviar al dispositivo en esa red
        const link = this.findLink(iface.connectedLinkId ?? '', links);
        if (!link || link.status !== 'up') continue;
        const neighborId = link.sourceDeviceId === router.id ? link.targetDeviceId : link.sourceDeviceId;
        const neighbor = this.findDevice(neighborId, devices);
        if (neighbor && neighbor.status === 'up') {
          const { anim, newTime } = this.createAnimation(packet, link.id, router.id, neighbor.id, time, link);
          if (anim) {
            animations.push(anim);
            this.log('info', router.hostname, `→ ${neighbor.hostname} (red directa)`);
            return this.routePacket(packet, neighbor, destIp, devices, links, animations, newTime, hops + 1);
          }
        }
      }
    }

    // Usar tabla de rutas (longest prefix match)
    const route = findBestRoute(router, destIp);
    if (!route) {
      this.log('error', router.hostname, `Sin ruta para ${destIp}`);
      return false;
    }

    if (route.nextHop === 'directly connected') {
      // ya manejado arriba
      return false;
    }

    // Encontrar el siguiente salto
    const neighbors = this.getNeighbors(router.id, devices, links);
    for (const { device, link } of neighbors) {
      const ifaceIp = this.getInterfaceIpForLink(device, link.id);
      if (ifaceIp === route.nextHop || device.interfaces.some(i => i.ipAddress === route.nextHop)) {
        const { anim, newTime } = this.createAnimation(packet, link.id, router.id, device.id, time, link);
        if (anim) {
          animations.push(anim);
          this.log('info', router.hostname, `→ ${device.hostname} (next-hop: ${route.nextHop})`);
          return this.routePacket(packet, device, destIp, devices, links, animations, newTime, hops + 1);
        }
      }
    }

    this.log('error', router.hostname, `No se alcanza el next-hop ${route.nextHop}`);
    return false;
  }

  // ── Crear animación de paquete en un enlace ────────────
  private createAnimation(
    packet: Packet,
    linkId: string,
    fromId: string,
    toId: string,
    startTime: number,
    link: Link
  ): { anim: PacketAnimation | null; newTime: number } {
    // Simular pérdida de paquetes
    if (simulatePacketLoss(link.packetLoss)) {
      this.log('warning', `Link-${linkId.slice(0, 6)}`, `Paquete perdido (loss: ${link.packetLoss}%)`);
      return { anim: null, newTime: startTime };
    }

    const duration = Math.max(300, link.latency * 10 + 300); // ms animación
    const anim: PacketAnimation = {
      id: uuidv4(),
      packet,
      linkId,
      fromDeviceId: fromId,
      toDeviceId: toId,
      progress: 0,
      startTime,
      duration,
      color: packet.type === 'icmp_request' ? '#22d3ee' : '#a3e635',
      dropped: false,
    };

    return { anim, newTime: startTime + duration };
  }

  // ════════════════════════════════════════════════════════
  //  DHCP básico  — asigna IP al PC desde un pool simulado
  // ════════════════════════════════════════════════════════
  simulateDhcp(
    pc: Device,
    dhcpServer: Device
  ): { ip: string; mask: string; gateway: string; dns: string } | null {
    // Buscar un pool disponible en el router/servidor DHCP
    const serverIface = dhcpServer.interfaces.find(i => i.status === 'up' && i.ipAddress);
    if (!serverIface) return null;

    const parts = serverIface.ipAddress.split('.').map(Number);
    // Asignar la siguiente IP disponible en el segmento
    const assignedHost = Math.floor(Math.random() * 200) + 10;
    parts[3] = assignedHost;

    const ip = parts.join('.');
    this.log('info', dhcpServer.hostname, `DHCP: Asignando ${ip} a ${pc.hostname}`);
    this.log('info', pc.hostname, `DHCP: Recibido IP ${ip} / ${serverIface.subnetMask}`);

    return {
      ip,
      mask: serverIface.subnetMask,
      gateway: serverIface.ipAddress,
      dns: serverIface.ipAddress,
    };
  }

  // ════════════════════════════════════════════════════════
  //  Apagar / encender enlace
  // ════════════════════════════════════════════════════════
  toggleLink(link: Link, links: Link[]): Link[] {
    const updated = links.map(l =>
      l.id === link.id
        ? { ...l, status: l.status === 'up' ? 'down' as const : 'up' as const }
        : l
    );
    const newStatus = updated.find(l => l.id === link.id)?.status;
    this.log(
      newStatus === 'down' ? 'warning' : 'info',
      `Enlace`,
      `Link ${link.id.slice(0, 8)} → ${newStatus?.toUpperCase()}`
    );
    this.emit({ type: 'link_down', linkId: link.id });
    return updated;
  }

  // ════════════════════════════════════════════════════════
  //  Apagar / encender dispositivo
  // ════════════════════════════════════════════════════════
  toggleDevice(device: Device, devices: Device[]): Device[] {
    const newStatus = device.status === 'up' ? 'down' as const : 'up' as const;
    this.log(
      newStatus === 'down' ? 'warning' : 'success',
      device.hostname,
      `Dispositivo ${newStatus.toUpperCase()}`
    );
    this.emit({ type: 'device_down', deviceId: device.id });
    return devices.map(d =>
      d.id === device.id ? { ...d, status: newStatus } : d
    );
  }
}

// Instancia global del motor
export const networkEngine = new NetworkEngine();
