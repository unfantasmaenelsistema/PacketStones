// ============================================================
//  engine/algorithms/NetworkUtils.ts
//  Utilidades de red: IP, máscaras, MAC, longest-prefix match
// ============================================================

/**
 * Convierte una IP en formato string a número de 32 bits.
 * Ejemplo: "192.168.1.1" → 3232235777
 */
export function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Convierte número de 32 bits a IP string.
 */
export function numberToIp(n: number): string {
  return [
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ].join('.');
}

/**
 * Comprueba si una IP pertenece a una red/máscara.
 */
export function ipInNetwork(ip: string, network: string, mask: string): boolean {
  const ipNum = ipToNumber(ip);
  const netNum = ipToNumber(network);
  const maskNum = ipToNumber(mask);
  return (ipNum & maskNum) === (netNum & maskNum);
}

/**
 * Calcula la dirección de red a partir de IP + máscara.
 */
export function networkAddress(ip: string, mask: string): string {
  const ipNum = ipToNumber(ip);
  const maskNum = ipToNumber(mask);
  return numberToIp((ipNum & maskNum) >>> 0);
}

/**
 * Calcula la longitud del prefijo (/24, /16, etc.) a partir de la máscara.
 */
export function maskToPrefix(mask: string): number {
  const num = ipToNumber(mask);
  let count = 0;
  let n = num;
  while (n > 0) {
    count += n & 1;
    n >>>= 1;
  }
  return count;
}

/**
 * Comprueba si una IP es válida.
 */
export function isValidIp(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => {
    const n = parseInt(p, 10);
    return !isNaN(n) && n >= 0 && n <= 255 && String(n) === p;
  });
}

/**
 * Genera una dirección MAC aleatoria con prefijo de simulador.
 */
export function generateMac(): string {
  const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  return `aa:bb:${hex()}:${hex()}:${hex()}:${hex()}`;
}

/**
 * Genera una IP en el rango 192.168.X.Y libre.
 */
export function generateDefaultIp(index: number): string {
  const subnet = Math.floor(index / 254) + 1;
  const host = (index % 254) + 1;
  return `192.168.${subnet}.${host}`;
}

/**
 * Broadcast de una red dada su IP y máscara.
 */
export function broadcastAddress(ip: string, mask: string): string {
  const ipNum = ipToNumber(ip);
  const maskNum = ipToNumber(mask);
  const wildcard = (~maskNum) >>> 0;
  return numberToIp((ipNum | wildcard) >>> 0);
}

/**
 * Simula pérdida de paquetes según porcentaje (0-100).
 * Devuelve true si el paquete se pierde.
 */
export function simulatePacketLoss(lossPercent: number): boolean {
  return Math.random() * 100 < lossPercent;
}
