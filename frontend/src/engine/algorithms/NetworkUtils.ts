// ============================================================
//  engine/algorithms/NetworkUtils.ts
//  Utilidades de red: IP, máscaras, MAC y subredes
// ============================================================

/**
 * Comprueba si una IP es válida (cuatro octetos decimales 0-255, sin ceros a la izquierda).
 */
export function isValidIp(ip: string): boolean {
  if (typeof ip !== 'string') return false;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255 && String(Number(p)) === p);
}

/**
 * Convierte una IP en número de 32 bits sin signo.
 * Ejemplo: "192.168.1.1" → 3232235777
 */
export function ipToNumber(ip: string): number {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

/** Convierte un número de 32 bits en IP. */
export function numberToIp(n: number): string {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
}

/** Máscara válida = IP válida con los unos contiguos (255.255.255.0 sí, 255.0.255.0 no). */
export function isValidMask(mask: string): boolean {
  if (!isValidIp(mask)) return false;
  const n = ipToNumber(mask);
  const inv = (~n) >>> 0;
  return ((inv + 1) & inv) === 0;  // el complemento debe ser 0…01…1
}

/** Longitud de prefijo de una máscara (/24, /30…). */
export function maskToPrefix(mask: string): number {
  let n = ipToNumber(mask);
  let count = 0;
  while (n) { count += n & 1; n >>>= 1; }
  return count;
}

/** Máscara a partir de un prefijo. */
export function prefixToMask(prefix: number): string {
  const p = Math.max(0, Math.min(32, Math.floor(prefix)));
  return numberToIp(p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0);
}

/** Dirección de red de IP + máscara. */
export function networkAddress(ip: string, mask: string): string {
  return numberToIp((ipToNumber(ip) & ipToNumber(mask)) >>> 0);
}

/** Dirección de broadcast de IP + máscara. */
export function broadcastAddress(ip: string, mask: string): string {
  return numberToIp((ipToNumber(ip) | (~ipToNumber(mask) >>> 0)) >>> 0);
}

/** ¿Pertenece la IP a la red/máscara? */
export function ipInNetwork(ip: string, network: string, mask: string): boolean {
  const m = ipToNumber(mask);
  return ((ipToNumber(ip) & m) >>> 0) === ((ipToNumber(network) & m) >>> 0);
}

/** ¿Es una IP de host usable (ni red ni broadcast) en su subred? En /31 y /32 todas valen. */
export function isHostAddress(ip: string, mask: string): boolean {
  if (maskToPrefix(mask) >= 31) return true;
  return ip !== networkAddress(ip, mask) && ip !== broadcastAddress(ip, mask);
}

/** Notación CIDR: "192.168.1.0/24". */
export function cidr(ip: string, mask: string): string {
  return `${networkAddress(ip, mask)}/${maskToPrefix(mask)}`;
}

/** MAC aleatoria localmente administrada (02:…) para no chocar con fabricantes reales. */
export function generateMac(): string {
  const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  return `02:50:${hex()}:${hex()}:${hex()}:${hex()}`;
}

/** Interfaz con IP y máscara válidas. */
export function hasValidAddress(iface: { ipAddress: string; subnetMask: string }): boolean {
  return isValidIp(iface.ipAddress) && isValidMask(iface.subnetMask) && maskToPrefix(iface.subnetMask) > 0;
}
