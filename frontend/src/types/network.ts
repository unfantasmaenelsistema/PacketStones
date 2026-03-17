// ============================================================
//  types/network.ts  —  Tipos centrales del simulador
// ============================================================

export type DeviceType = 'router' | 'switch' | 'pc';
export type DeviceStatus = 'up' | 'down';
export type LinkStatus = 'up' | 'down';
export type PacketType = 'icmp_request' | 'icmp_reply' | 'arp_request' | 'arp_reply' | 'dhcp' | 'data';
export type Tool = 'select' | 'cable' | 'delete';

// ── Posición en el canvas ──────────────────────────────────
export interface Position {
  x: number;
  y: number;
}

// ── Interfaz de red de un dispositivo ─────────────────────
export interface NetworkInterface {
  id: string;
  name: string;          // e.g. "eth0", "GigabitEthernet0/0"
  ipAddress: string;     // e.g. "192.168.1.1"
  subnetMask: string;    // e.g. "255.255.255.0"
  status: LinkStatus;
  macAddress: string;
  connectedLinkId?: string;
}

// ── Entrada en la tabla de rutas ──────────────────────────
export interface RouteEntry {
  destination: string;   // e.g. "192.168.2.0"
  subnetMask: string;    // e.g. "255.255.255.0"
  nextHop: string;       // e.g. "192.168.1.1" o "directly connected"
  interface: string;     // nombre de interfaz
  metric: number;
  type: 'static' | 'connected' | 'rip';
}

// ── Entrada en la tabla MAC de un switch ─────────────────
export interface MacEntry {
  macAddress: string;
  port: string;          // nombre de interfaz
  timestamp: number;     // para expiración TTL
}

// ── Dispositivo genérico ───────────────────────────────────
export interface Device {
  id: string;
  type: DeviceType;
  hostname: string;
  position: Position;
  status: DeviceStatus;
  interfaces: NetworkInterface[];
  // Config específica por tipo
  routingTable?: RouteEntry[];    // Router
  macTable?: MacEntry[];          // Switch
  defaultGateway?: string;        // PC
  dnsServer?: string;             // PC (DHCP opcional)
}

// ── Enlace entre dos dispositivos ─────────────────────────
export interface Link {
  id: string;
  sourceDeviceId: string;
  sourceInterfaceId: string;
  targetDeviceId: string;
  targetInterfaceId: string;
  status: LinkStatus;
  latency: number;        // ms
  packetLoss: number;     // 0-100 %
  bandwidth: number;      // Mbps
}

// ── Paquete en tránsito ────────────────────────────────────
export interface Packet {
  id: string;
  type: PacketType;
  sourceIp: string;
  destinationIp: string;
  sourceMac: string;
  destinationMac: string;
  ttl: number;
  payload?: string;
  // Para ICMP
  icmpSequence?: number;
  icmpCode?: number;
}

// ── Animación de un paquete moviéndose por un enlace ──────
export interface PacketAnimation {
  id: string;
  packet: Packet;
  linkId: string;
  fromDeviceId: string;
  toDeviceId: string;
  progress: number;      // 0.0 → 1.0
  startTime: number;
  duration: number;      // ms
  color: string;
  dropped: boolean;
}

// ── Entrada de log ─────────────────────────────────────────
export interface LogEntry {
  id: string;
  timestamp: number;
  level: 'info' | 'warning' | 'error' | 'success';
  source: string;        // nombre del dispositivo
  message: string;
}

// ── Topología completa (para guardar/cargar JSON) ─────────
export interface Topology {
  version: string;
  name: string;
  createdAt: string;
  devices: Device[];
  links: Link[];
}

// ── Estado global del simulador ────────────────────────────
export interface SimulatorState {
  devices: Device[];
  links: Link[];
  packets: PacketAnimation[];
  logs: LogEntry[];
  selectedDeviceId: string | null;
  selectedLinkId: string | null;
  activeTool: Tool;
  cableSource: string | null;     // id del dispositivo origen al trazar cable
  isSimulating: boolean;
  stepMode: boolean;
}
