// ============================================================
//  engine/algorithms/Topology.ts
//  Consultas sobre la topología: enlaces utilizables, vecinos
//  y dominios de capa 2 (lo que alcanza una trama a través de switches)
// ============================================================

import { Device, Link, NetworkInterface } from '@/types/network';

export interface Endpoint {
  device: Device;
  iface: NetworkInterface;
}

export class TopologyView {
  readonly byId = new Map<string, Device>();
  readonly linkById = new Map<string, Link>();

  constructor(public devices: Device[], public links: Link[]) {
    for (const d of devices) this.byId.set(d.id, d);
    for (const l of links) this.linkById.set(l.id, l);
  }

  iface(device: Device, ifaceId: string): NetworkInterface | undefined {
    return device.interfaces.find(i => i.id === ifaceId);
  }

  /** El otro extremo de un enlace visto desde `deviceId`. */
  peer(link: Link, deviceId: string): Endpoint | undefined {
    const otherDev = link.sourceDeviceId === deviceId ? link.targetDeviceId : link.sourceDeviceId;
    const otherIf = link.sourceDeviceId === deviceId ? link.targetInterfaceId : link.sourceInterfaceId;
    const device = this.byId.get(otherDev);
    if (!device) return undefined;
    const iface = this.iface(device, otherIf);
    return iface ? { device, iface } : undefined;
  }

  /** Enlace de una interfaz, si está cableada. */
  linkOf(iface: NetworkInterface): Link | undefined {
    return iface.connectedLinkId ? this.linkById.get(iface.connectedLinkId) : undefined;
  }

  /**
   * Una interfaz puede transmitir si su equipo está encendido, ella no está
   * en shutdown, está cableada, el enlace está arriba y el otro extremo también.
   */
  canTransmit(device: Device, iface: NetworkInterface): boolean {
    if (device.status !== 'up' || iface.status !== 'up') return false;
    const link = this.linkOf(iface);
    if (!link || link.status !== 'up') return false;
    const p = this.peer(link, device.id);
    return !!p && p.device.status === 'up' && p.iface.status === 'up';
  }

  /**
   * Equipos de capa 3 (PC y routers) alcanzables por una trama de broadcast
   * que sale de `iface`, atravesando switches. Sin animación: sirve para RIP
   * y para decidir vecinos.
   */
  l2Domain(device: Device, iface: NetworkInterface): Endpoint[] {
    const out: Endpoint[] = [];
    const seenSwitches = new Set<string>();
    const stack: Array<{ dev: Device; ifs: NetworkInterface[] }> = [{ dev: device, ifs: [iface] }];
    while (stack.length) {
      const { dev, ifs } = stack.pop()!;
      for (const i of ifs) {
        if (!this.canTransmit(dev, i)) continue;
        const p = this.peer(this.linkOf(i)!, dev.id)!;
        if (p.device.type === 'switch') {
          if (seenSwitches.has(p.device.id)) continue;
          seenSwitches.add(p.device.id);
          stack.push({ dev: p.device, ifs: p.device.interfaces.filter(x => x.id !== p.iface.id) });
        } else {
          out.push(p);
        }
      }
    }
    return out;
  }
}
