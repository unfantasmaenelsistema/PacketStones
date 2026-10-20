// ============================================================
//  engine/algorithms/RoutingEngine.ts
//  Tablas de rutas: redes conectadas, rutas estáticas y RIP
// ============================================================

import { Device, Link, LogMessage, RouteEntry } from '@/types/network';
import { TopologyView } from './Topology';
import { hasValidAddress, ipInNetwork, maskToPrefix, networkAddress } from './NetworkUtils';

const RIP_INFINITY = 16;

const keyOf = (r: { destination: string; subnetMask: string }) => `${r.destination}/${maskToPrefix(r.subnetMask)}`;

/**
 * Longest-prefix match: la ruta más específica que contiene la IP destino.
 * A igual prefijo gana la de menor distancia administrativa (conectada < estática < RIP).
 */
export function findBestRoute(router: Device, destinationIp: string): RouteEntry | null {
  const rank = { connected: 0, static: 1, rip: 2 } as const;
  let best: RouteEntry | null = null;
  let bestPrefix = -1;
  for (const route of router.routingTable ?? []) {
    if (!ipInNetwork(destinationIp, route.destination, route.subnetMask)) continue;
    const prefix = maskToPrefix(route.subnetMask);
    if (prefix > bestPrefix || (prefix === bestPrefix && best && rank[route.type] < rank[best.type])) {
      best = route;
      bestPrefix = prefix;
    }
  }
  return best;
}

/**
 * Redes directamente conectadas de un router: solo interfaces con IP válida
 * y línea arriba (cable conectado, enlace y extremo remoto activos), como en IOS.
 */
export function connectedRoutes(router: Device, topo: TopologyView): RouteEntry[] {
  if (router.status !== 'up') return [];
  const out: RouteEntry[] = [];
  for (const iface of router.interfaces) {
    if (!hasValidAddress(iface) || !topo.canTransmit(router, iface)) continue;
    out.push({
      destination: networkAddress(iface.ipAddress, iface.subnetMask),
      subnetMask: iface.subnetMask,
      nextHop: '',
      interface: iface.name,
      metric: 0,
      type: 'connected',
    });
  }
  return out;
}

interface RipRoute extends RouteEntry {
  via: string;  // id del router vecino que la anunció (split horizon)
}

/**
 * Recalcula las tablas de todos los routers: conectadas + estáticas del usuario + RIP.
 * RIP se resuelve como vector-distancia (Bellman-Ford) hasta converger, con
 * horizonte dividido y métrica máxima 15. Devuelve los equipos actualizados y
 * los mensajes de log con lo que RIP aprendió o retiró.
 */
export function recomputeRouting(devices: Device[], links: Link[]): { devices: Device[]; logs: LogMessage[] } {
  const topo = new TopologyView(devices, links);
  const routers = devices.filter(d => d.type === 'router');
  const connected = new Map<string, RouteEntry[]>();
  for (const r of routers) connected.set(r.id, connectedRoutes(r, topo));

  // ── Adyacencias RIP: routers RIP en el mismo dominio L2 y la misma subred ──
  const ripRouters = routers.filter(r => r.ripEnabled && r.status === 'up');
  const adj = new Map<string, Array<{ ifaceName: string; neighborId: string; nextHop: string }>>();
  for (const r of ripRouters) {
    const list: Array<{ ifaceName: string; neighborId: string; nextHop: string }> = [];
    for (const iface of r.interfaces) {
      if (!hasValidAddress(iface) || !topo.canTransmit(r, iface)) continue;
      for (const ep of topo.l2Domain(r, iface)) {
        if (ep.device.type !== 'router' || !ep.device.ripEnabled || ep.device.id === r.id) continue;
        if (!hasValidAddress(ep.iface)) continue;
        if (!ipInNetwork(ep.iface.ipAddress, iface.ipAddress, iface.subnetMask)) continue;
        list.push({ ifaceName: iface.name, neighborId: ep.device.id, nextHop: ep.iface.ipAddress });
      }
    }
    adj.set(r.id, list);
  }

  // ── Bellman-Ford ──
  let tables = new Map<string, Map<string, RipRoute>>();
  for (const r of ripRouters) {
    const m = new Map<string, RipRoute>();
    for (const c of connected.get(r.id)!) m.set(keyOf(c), { ...c, via: '' });
    tables.set(r.id, m);
  }
  for (let round = 0; round < RIP_INFINITY; round++) {
    let changed = false;
    const next = new Map<string, Map<string, RipRoute>>();
    for (const r of ripRouters) {
      const mine = new Map(tables.get(r.id)!);
      for (const { ifaceName, neighborId, nextHop } of adj.get(r.id)!) {
        for (const adv of tables.get(neighborId)!.values()) {
          if (adv.via === r.id) continue;                      // horizonte dividido
          const metric = adv.metric + 1;
          if (metric >= RIP_INFINITY) continue;
          const k = keyOf(adv);
          const cur = mine.get(k);
          if (!cur || (cur.type === 'rip' && metric < cur.metric)) {
            mine.set(k, {
              destination: adv.destination, subnetMask: adv.subnetMask,
              nextHop, interface: ifaceName, metric, type: 'rip', via: neighborId,
            });
            changed = true;
          }
        }
      }
      next.set(r.id, mine);
    }
    tables = next;
    if (!changed) break;
  }

  // ── Componer tablas finales ──
  const logs: LogMessage[] = [];
  const updated = devices.map(d => {
    if (d.type !== 'router') return d;
    const conn = connected.get(d.id)!;
    const statics = (d.routingTable ?? []).filter(r => r.type === 'static');
    const taken = new Set([...conn, ...statics].map(keyOf));
    const rip: RouteEntry[] = [];
    for (const r of tables.get(d.id)?.values() ?? []) {
      if (r.type !== 'rip' || taken.has(keyOf(r))) continue;
      const { via: _via, ...route } = r;
      rip.push(route);
    }
    rip.sort((a, b) => keyOf(a).localeCompare(keyOf(b)));

    // Diferencias RIP para el log
    const before = new Map((d.routingTable ?? []).filter(r => r.type === 'rip').map(r => [keyOf(r), r]));
    const after = new Map(rip.map(r => [keyOf(r), r]));
    for (const [k, r] of after) {
      const old = before.get(k);
      if (!old) logs.push({ level: 'info', source: d.hostname, key: 'log.ripLearn', params: { net: k, hop: r.nextHop, metric: r.metric } });
      else if (old.nextHop !== r.nextHop || old.metric !== r.metric)
        logs.push({ level: 'info', source: d.hostname, key: 'log.ripChange', params: { net: k, hop: r.nextHop, metric: r.metric } });
    }
    for (const k of before.keys()) {
      if (!after.has(k)) logs.push({ level: 'warning', source: d.hostname, key: 'log.ripLost', params: { net: k } });
    }

    const routingTable = [...conn, ...statics, ...rip];
    if (JSON.stringify(routingTable) === JSON.stringify(d.routingTable ?? [])) return d;
    return { ...d, routingTable };
  });

  return { devices: updated, logs };
}
