// ============================================================
//  engine/algorithms/RoutingEngine.ts
//  Motor de enrutamiento: longest-prefix match + RIP básico
// ============================================================

import { Device, RouteEntry, Link } from '@/types/network';
import { ipInNetwork, maskToPrefix } from './NetworkUtils';

/**
 * Busca la mejor ruta (longest prefix match) para una IP destino.
 * Devuelve la entrada de ruta o null si no hay.
 */
export function findBestRoute(
  router: Device,
  destinationIp: string
): RouteEntry | null {
  if (!router.routingTable || router.routingTable.length === 0) return null;

  let bestRoute: RouteEntry | null = null;
  let bestPrefix = -1;

  for (const route of router.routingTable) {
    if (ipInNetwork(destinationIp, route.destination, route.subnetMask)) {
      const prefix = maskToPrefix(route.subnetMask);
      if (prefix > bestPrefix) {
        bestPrefix = prefix;
        bestRoute = route;
      }
    }
  }

  return bestRoute;
}

/**
 * Propaga rutas RIP entre routers conectados directamente.
 * Implementación simplificada: comparte rutas directamente conectadas
 * con vecinos con metric+1 (split horizon no implementado por simplicidad).
 */
export function propagateRip(
  devices: Device[],
  links: Link[]
): Device[] {
  const routers = devices.filter(d => d.type === 'router' && d.status === 'up');
  const updated = devices.map(d => ({ ...d, routingTable: [...(d.routingTable ?? [])] }));

  for (const router of routers) {
    // Encontrar routers vecinos (conectados por un link activo)
    const neighborLinks = links.filter(
      l =>
        l.status === 'up' &&
        (l.sourceDeviceId === router.id || l.targetDeviceId === router.id)
    );

    for (const link of neighborLinks) {
      const neighborId = link.sourceDeviceId === router.id
        ? link.targetDeviceId
        : link.sourceDeviceId;

      const neighbor = updated.find(d => d.id === neighborId);
      if (!neighbor || neighbor.type !== 'router' || neighbor.status !== 'up') continue;

      const routerIdx = updated.findIndex(d => d.id === router.id);
      const neighborRoutes = neighbor.routingTable ?? [];

      for (const route of neighborRoutes) {
        // No anunciar rutas con metric >= 15 (RIP max hops)
        if (route.metric >= 15) continue;

        const exists = updated[routerIdx].routingTable?.some(
          r => r.destination === route.destination &&
               r.subnetMask === route.subnetMask &&
               r.metric <= route.metric + 1
        );

        if (!exists) {
          // Obtener IP del neighbor en el interfaz conectado
          const neighborIface = neighbor.interfaces.find(
            i => i.connectedLinkId === link.id && i.status === 'up'
          );
          if (!neighborIface) continue;

          updated[routerIdx].routingTable?.push({
            destination: route.destination,
            subnetMask: route.subnetMask,
            nextHop: neighborIface.ipAddress,
            interface: updated[routerIdx].interfaces.find(
              i => i.connectedLinkId === link.id
            )?.name ?? 'unknown',
            metric: route.metric + 1,
            type: 'rip',
          });
        }
      }
    }
  }

  return updated;
}

/**
 * Construye la tabla de rutas directamente conectadas para un router.
 * Llama esto cuando cambias una IP de interfaz.
 */
export function buildConnectedRoutes(router: Device): RouteEntry[] {
  const connected: RouteEntry[] = [];

  for (const iface of router.interfaces) {
    if (!iface.ipAddress || !iface.subnetMask || iface.status !== 'up') continue;

    // Calcular la red
    const parts = iface.ipAddress.split('.').map(Number);
    const maskParts = iface.subnetMask.split('.').map(Number);
    const networkParts = parts.map((p, i) => p & maskParts[i]);

    connected.push({
      destination: networkParts.join('.'),
      subnetMask: iface.subnetMask,
      nextHop: 'directly connected',
      interface: iface.name,
      metric: 0,
      type: 'connected',
    });
  }

  return connected;
}
