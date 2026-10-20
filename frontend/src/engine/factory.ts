// ============================================================
//  engine/factory.ts
//  Creación de dispositivos y enlaces, topologías de ejemplo
//  y validación de topologías cargadas desde JSON
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { Device, DeviceType, Link, NetworkInterface, Position, RouteEntry, Topology } from '@/types/network';
import { generateMac, isValidIp, networkAddress } from './algorithms/NetworkUtils';

const IFACE_NAMES: Record<DeviceType, string[]> = {
  router: ['GigabitEthernet0/0', 'GigabitEthernet0/1', 'GigabitEthernet0/2', 'GigabitEthernet0/3'],
  switch: Array.from({ length: 8 }, (_, i) => `FastEthernet0/${i + 1}`),
  pc: ['eth0'],
};

export const HOST_PREFIX: Record<DeviceType, string> = { router: 'Router', switch: 'Switch', pc: 'PC' };

/** Nombre corto de interfaz para el lienzo: GigabitEthernet0/1 → Gi0/1. */
export function shortIfName(name: string): string {
  return name.replace(/^GigabitEthernet/, 'Gi').replace(/^FastEthernet/, 'Fa');
}

/** Primer nombre libre: Router1, Router2… */
export function nextHostname(type: DeviceType, devices: Device[]): string {
  const used = new Set(devices.map(d => d.hostname.toLowerCase()));
  for (let n = 1; ; n++) {
    const name = `${HOST_PREFIX[type]}${n}`;
    if (!used.has(name.toLowerCase())) return name;
  }
}

/** IP libre 192.168.1.10, .11… para PCs nuevos (así se pueden hacer ping sin configurar nada). */
function nextPcIp(devices: Device[]): string {
  const used = new Set(devices.flatMap(d => d.interfaces.map(i => i.ipAddress)));
  for (let h = 10; h < 255; h++) {
    const ip = `192.168.1.${h}`;
    if (!used.has(ip)) return ip;
  }
  return '';
}

export function createDevice(type: DeviceType, position: Position, existing: Device[] = []): Device {
  const interfaces: NetworkInterface[] = IFACE_NAMES[type].map(name => ({
    id: uuidv4(),
    name,
    ipAddress: '',
    subnetMask: type === 'switch' ? '' : '255.255.255.0',
    status: 'up',
    macAddress: generateMac(),
  }));
  if (type === 'pc') interfaces[0].ipAddress = nextPcIp(existing);
  return {
    id: uuidv4(),
    type,
    hostname: nextHostname(type, existing),
    position,
    status: 'up',
    interfaces,
    ...(type === 'router' && { routingTable: [], ripEnabled: false, arpTable: [] }),
    ...(type === 'switch' && { macTable: [] }),
    ...(type === 'pc' && { defaultGateway: '', arpTable: [] }),
  };
}

/**
 * Crea un enlace entre dos equipos. Si no se indica interfaz usa la primera libre.
 * Devuelve los equipos con las interfaces marcadas y el enlace, o null si no hay puertos libres.
 */
export function connect(
  devices: Device[], aId: string, bId: string, aIfIdx?: number, bIfIdx?: number,
): { devices: Device[]; link: Link } | null {
  const a = devices.find(d => d.id === aId);
  const b = devices.find(d => d.id === bId);
  if (!a || !b || a.id === b.id) return null;
  const ia = aIfIdx !== undefined ? a.interfaces[aIfIdx] : a.interfaces.find(i => !i.connectedLinkId);
  const ib = bIfIdx !== undefined ? b.interfaces[bIfIdx] : b.interfaces.find(i => !i.connectedLinkId);
  if (!ia || !ib || ia.connectedLinkId || ib.connectedLinkId) return null;
  const link: Link = {
    id: uuidv4(),
    sourceDeviceId: a.id, sourceInterfaceId: ia.id,
    targetDeviceId: b.id, targetInterfaceId: ib.id,
    status: 'up', latency: 1, packetLoss: 0, bandwidth: 1000,
  };
  const mark = (d: Device, iface: NetworkInterface) => ({
    ...d, interfaces: d.interfaces.map(i => (i.id === iface.id ? { ...i, connectedLinkId: link.id } : i)),
  });
  return {
    devices: devices.map(d => (d.id === a.id ? mark(d, ia) : d.id === b.id ? mark(d, ib) : d)),
    link,
  };
}

// ════════════════════════════════════════════════════════════
//  Topologías de ejemplo
// ════════════════════════════════════════════════════════════

export type ExampleId = 'lan' | 'static' | 'rip' | 'dhcp';

class Builder {
  devices: Device[] = [];
  links: Link[] = [];

  add(type: DeviceType, x: number, y: number, setup?: (d: Device) => void): Device {
    const d = createDevice(type, { x, y }, this.devices);
    setup?.(d);
    this.devices.push(d);
    return d;
  }
  pc(x: number, y: number, ip: string, gw: string, mask = '255.255.255.0') {
    return this.add('pc', x, y, d => {
      d.interfaces[0].ipAddress = ip;
      d.interfaces[0].subnetMask = mask;
      d.defaultGateway = gw;
    });
  }
  router(x: number, y: number, ips: Array<[string, string] | null>, rip = false) {
    return this.add('router', x, y, d => {
      ips.forEach((v, i) => {
        if (v) { d.interfaces[i].ipAddress = v[0]; d.interfaces[i].subnetMask = v[1]; }
      });
      d.ripEnabled = rip;
    });
  }
  link(a: Device, b: Device, ai?: number, bi?: number) {
    const r = connect(this.devices, a.id, b.id, ai, bi);
    if (!r) throw new Error('example link');
    this.devices = r.devices;
    this.links.push(r.link);
  }
  staticRoute(r: Device, dest: string, mask: string, hop: string) {
    const route: RouteEntry = { destination: dest, subnetMask: mask, nextHop: hop, interface: '', metric: 1, type: 'static' };
    this.devices = this.devices.map(d => (d.id === r.id ? { ...d, routingTable: [...(d.routingTable ?? []), route] } : d));
  }
}

const M24 = '255.255.255.0';
const M30 = '255.255.255.252';

export function buildExample(id: ExampleId): { devices: Device[]; links: Link[] } {
  const b = new Builder();
  if (id === 'lan') {
    const sw = b.add('switch', 420, 260);
    const pcs = [
      b.pc(170, 120, '192.168.1.10', ''),
      b.pc(170, 400, '192.168.1.11', ''),
      b.pc(670, 120, '192.168.1.12', ''),
      b.pc(670, 400, '192.168.2.20', ''),
    ];
    pcs.forEach((p, i) => b.link(p, sw, 0, i));
  } else if (id === 'static') {
    const sw1 = b.add('switch', 260, 260);
    const sw2 = b.add('switch', 860, 260);
    const r1 = b.router(460, 260, [['192.168.1.1', M24], ['10.0.0.1', M30]]);
    const r2 = b.router(660, 260, [['192.168.2.1', M24], ['10.0.0.2', M30]]);
    const p1 = b.pc(90, 150, '192.168.1.10', '192.168.1.1');
    const p2 = b.pc(90, 370, '192.168.1.11', '192.168.1.1');
    const p3 = b.pc(1030, 150, '192.168.2.10', '192.168.2.1');
    const p4 = b.pc(1030, 370, '192.168.2.11', '192.168.2.1');
    b.link(p1, sw1, 0, 0); b.link(p2, sw1, 0, 1); b.link(sw1, r1, 7, 0);
    b.link(r1, r2, 1, 1);
    b.link(r2, sw2, 0, 7); b.link(sw2, p3, 0, 0); b.link(sw2, p4, 1, 0);
    b.staticRoute(r1, '192.168.2.0', M24, '10.0.0.2');
    b.staticRoute(r2, '192.168.1.0', M24, '10.0.0.1');
  } else if (id === 'rip') {
    const r1 = b.router(330, 170, [['192.168.1.1', M24], ['10.0.12.1', M30], ['10.0.13.1', M30]], true);
    const r2 = b.router(620, 120, [['192.168.2.1', M24], ['10.0.12.2', M30], ['10.0.23.1', M30]], true);
    const r3 = b.router(560, 400, [['192.168.3.1', M24], ['10.0.23.2', M30], ['10.0.13.2', M30]], true);
    const sw1 = b.add('switch', 140, 280);
    const p1 = b.pc(60, 440, '192.168.1.10', '192.168.1.1');
    const p2 = b.pc(240, 460, '192.168.1.11', '192.168.1.1');
    const p3 = b.pc(880, 120, '192.168.2.10', '192.168.2.1');
    const p4 = b.pc(820, 470, '192.168.3.10', '192.168.3.1');
    b.link(r1, r2, 1, 1); b.link(r2, r3, 2, 1); b.link(r1, r3, 2, 2);
    b.link(r1, sw1, 0, 7); b.link(sw1, p1, 0, 0); b.link(sw1, p2, 1, 0);
    b.link(r2, p3, 0, 0); b.link(r3, p4, 0, 0);
  } else {
    const r1 = b.router(480, 140, [['192.168.10.1', M24], ['192.168.20.1', M24]]);
    r1.interfaces[0].dhcpServer = true;
    r1.interfaces[1].dhcpServer = true;
    const sw1 = b.add('switch', 260, 300);
    const sw2 = b.add('switch', 700, 300);
    const p1 = b.pc(110, 460, '', '');
    const p2 = b.pc(300, 480, '', '');
    const p3 = b.pc(620, 480, '', '');
    const p4 = b.pc(830, 460, '', '');
    b.link(r1, sw1, 0, 7); b.link(r1, sw2, 1, 7);
    b.link(sw1, p1, 0, 0); b.link(sw1, p2, 1, 0);
    b.link(sw2, p3, 0, 0); b.link(sw2, p4, 1, 0);
  }
  return { devices: b.devices, links: b.links };
}

// ════════════════════════════════════════════════════════════
//  Validación de topologías cargadas (JSON del usuario)
// ════════════════════════════════════════════════════════════

const str = (v: unknown, max = 64) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown, def: number, min: number, max: number) =>
  (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : def);
const status = (v: unknown) => (v === 'down' ? 'down' : 'up') as 'up' | 'down';
const ipOrEmpty = (v: unknown) => (isValidIp(str(v)) ? str(v) : '');

/**
 * Comprueba y normaliza una topología. Lanza un Error si no es utilizable.
 * Acepta también los JSON guardados por la versión original de Packet Stones.
 */
export function sanitizeTopology(raw: unknown): { devices: Device[]; links: Link[]; name: string } {
  if (!raw || typeof raw !== 'object') throw new Error('json');
  const t = raw as Partial<Topology>;
  if (!Array.isArray(t.devices) || !Array.isArray(t.links)) throw new Error('shape');
  if (t.devices.length > 300 || t.links.length > 1000) throw new Error('size');

  const devices: Device[] = [];
  const ids = new Set<string>();
  for (const rd of t.devices as unknown[]) {
    const d = rd as Partial<Device>;
    if (!d || !['router', 'switch', 'pc'].includes(d.type as string)) throw new Error('device');
    const id = str(d.id, 80);
    if (!id || ids.has(id)) throw new Error('device');
    ids.add(id);
    const type = d.type as DeviceType;
    const ifs = Array.isArray(d.interfaces) ? d.interfaces : [];
    if (!ifs.length || ifs.length > 48) throw new Error('device');
    const interfaces: NetworkInterface[] = ifs.map((ri, idx) => {
      const i = ri as Partial<NetworkInterface>;
      return {
        id: str(i?.id, 80) || uuidv4(),
        name: str(i?.name, 40) || `if${idx}`,
        ipAddress: type === 'switch' ? '' : ipOrEmpty(i?.ipAddress),
        subnetMask: type === 'switch' ? '' : (ipOrEmpty(i?.subnetMask) || '255.255.255.0'),
        status: status(i?.status),
        macAddress: /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(str(i?.macAddress)) ? str(i?.macAddress).toLowerCase() : generateMac(),
        ...(type === 'router' && i?.dhcpServer === true && { dhcpServer: true }),
      };
    });
    const statics: RouteEntry[] = type === 'router' && Array.isArray(d.routingTable)
      ? (d.routingTable as unknown[]).map(r => r as Partial<RouteEntry>)
        .filter(r => r && r.type === 'static' && isValidIp(str(r.destination)) && isValidIp(str(r.subnetMask)) && isValidIp(str(r.nextHop)))
        .map(r => ({
          destination: networkAddress(str(r.destination), str(r.subnetMask)),
          subnetMask: str(r.subnetMask), nextHop: str(r.nextHop),
          interface: str(r.interface, 40), metric: num(r.metric, 1, 0, 255), type: 'static' as const,
        }))
      : [];
    devices.push({
      id, type,
      hostname: str(d.hostname, 32) || HOST_PREFIX[type],
      position: { x: num(d.position?.x, 200, -5000, 5000), y: num(d.position?.y, 200, -5000, 5000) },
      status: status(d.status),
      interfaces,
      ...(type === 'router' && { routingTable: statics, ripEnabled: d.ripEnabled === true, arpTable: [] }),
      ...(type === 'switch' && { macTable: [] }),
      ...(type === 'pc' && { defaultGateway: ipOrEmpty(d.defaultGateway), arpTable: [] }),
    });
  }

  // Enlaces: solo los que apuntan a interfaces existentes y libres
  const links: Link[] = [];
  const usedIf = new Set<string>();
  const byId = new Map(devices.map(d => [d.id, d]));
  for (const rl of t.links as unknown[]) {
    const l = rl as Partial<Link>;
    const a = byId.get(str(l?.sourceDeviceId, 80));
    const b = byId.get(str(l?.targetDeviceId, 80));
    if (!a || !b || a === b) continue;
    const ia = a.interfaces.find(i => i.id === l.sourceInterfaceId);
    const ib = b.interfaces.find(i => i.id === l.targetInterfaceId);
    if (!ia || !ib || usedIf.has(ia.id) || usedIf.has(ib.id)) continue;
    usedIf.add(ia.id); usedIf.add(ib.id);
    const id = str(l.id, 80) || uuidv4();
    ia.connectedLinkId = id;
    ib.connectedLinkId = id;
    links.push({
      id, sourceDeviceId: a.id, sourceInterfaceId: ia.id, targetDeviceId: b.id, targetInterfaceId: ib.id,
      status: status(l.status),
      latency: num(l.latency, 1, 1, 500),
      packetLoss: num(l.packetLoss, 0, 0, 100),
      bandwidth: num(l.bandwidth, 1000, 1, 100000),
    });
  }
  return { devices, links, name: str(t.name, 64) || 'topologia' };
}
