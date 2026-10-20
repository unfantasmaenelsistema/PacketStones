// ============================================================
//  types/network.ts  —  Tipos centrales del simulador
// ============================================================

export type DeviceType = 'router' | 'switch' | 'pc';
export type Status = 'up' | 'down';
export type Tool = 'select' | 'cable' | 'delete';

/** Tipo de tráfico que viaja por un enlace (decide el color en el lienzo). */
export type PacketKind =
  | 'icmp_request'
  | 'icmp_reply'
  | 'arp_request'
  | 'arp_reply'
  | 'dhcp';

// ── Posición en el lienzo ──────────────────────────────────
export interface Position {
  x: number;
  y: number;
}

// ── Interfaz de red de un dispositivo ─────────────────────
export interface NetworkInterface {
  id: string;
  name: string;          // "eth0", "GigabitEthernet0/0", "FastEthernet0/1"
  ipAddress: string;     // vacío en los puertos de switch
  subnetMask: string;
  status: Status;        // 'down' = shutdown administrativo
  macAddress: string;
  connectedLinkId?: string;
  dhcpServer?: boolean;  // Router: sirve direcciones por DHCP en esta interfaz
}

// ── Entrada en la tabla de rutas ──────────────────────────
export interface RouteEntry {
  destination: string;   // dirección de red, p. ej. "192.168.2.0"
  subnetMask: string;
  nextHop: string;       // IP del siguiente salto o "" si es directamente conectada
  interface: string;     // nombre de la interfaz de salida ("" = automática)
  metric: number;
  type: 'connected' | 'static' | 'rip';
}

// ── Tabla MAC de un switch ────────────────────────────────
export interface MacEntry {
  macAddress: string;
  port: string;          // nombre del puerto
}

// ── Caché ARP de un PC o router ───────────────────────────
export interface ArpEntry {
  ip: string;
  mac: string;
  interface: string;
}

// ── Dispositivo ────────────────────────────────────────────
export interface Device {
  id: string;
  type: DeviceType;
  hostname: string;
  position: Position;
  status: Status;
  interfaces: NetworkInterface[];
  routingTable?: RouteEntry[];   // Router (connected + static + rip)
  ripEnabled?: boolean;          // Router
  macTable?: MacEntry[];         // Switch
  arpTable?: ArpEntry[];         // PC y router
  defaultGateway?: string;       // PC
}

// ── Enlace entre dos interfaces ───────────────────────────
export interface Link {
  id: string;
  sourceDeviceId: string;
  sourceInterfaceId: string;
  targetDeviceId: string;
  targetInterfaceId: string;
  status: Status;
  latency: number;        // ms en un sentido
  packetLoss: number;     // 0-100 %
  bandwidth: number;      // Mbps (informativo)
}

// ── Paquete animado sobre un enlace ───────────────────────
export interface PacketAnimation {
  id: string;
  kind: PacketKind;
  linkId: string;
  fromDeviceId: string;
  toDeviceId: string;
  startTime: number;     // ms (performance.now)
  duration: number;      // ms
  dropAt?: number;       // 0..1: el paquete se pierde en ese punto del enlace
}

// ── Log ────────────────────────────────────────────────────
export type LogLevel = 'info' | 'warning' | 'error' | 'success';
export type LogParams = Record<string, string | number>;

/** Mensaje del motor: clave de traducción + parámetros (se traduce al mostrarlo). */
export interface LogMessage {
  level: LogLevel;
  source: string;
  key: string;
  params?: LogParams;
}

export interface LogEntry extends LogMessage {
  id: string;
  timestamp: number;     // Date.now() cuando se muestra
}

// ── Topología completa (guardar / cargar JSON) ────────────
export interface Topology {
  version: string;
  name: string;
  createdAt: string;
  devices: Device[];
  links: Link[];
}
