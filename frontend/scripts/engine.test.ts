// ============================================================
//  scripts/engine.test.ts  —  Pruebas del motor de red (npm test)
//  Recorre las cuatro prácticas de ejemplo y casos de fallo.
// ============================================================

import { buildExample, ExampleId, sanitizeTopology } from '@/engine/factory';
import { recomputeRouting } from '@/engine/algorithms/RoutingEngine';
import { simulateDhcp, simulatePing, SimResult } from '@/engine/NetworkEngine';
import { isValidMask } from '@/engine/algorithms/NetworkUtils';
import { Device, Link } from '@/types/network';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '  ✓' : '  ✗ FALLO:'} ${msg}`);
  if (!ok) failures++;
};

const setup = (id: ExampleId) => {
  const ex = buildExample(id);
  const r = recomputeRouting(ex.devices, ex.links);
  return { devices: r.devices, links: ex.links, logs: r.logs };
};
const host = (d: Device[], h: string) => d.find(x => x.hostname === h)!;
const replies = (r: SimResult) => r.logs.filter(l => l.msg.key === 'log.pingReply');
const has = (r: SimResult, key: string) => r.logs.some(l => l.msg.key === key);
const linkBetween = (t: { devices: Device[]; links: Link[] }, a: string, b: string) => t.links.find(l => {
  const s = host(t.devices, a).id, d = host(t.devices, b).id;
  return (l.sourceDeviceId === s && l.targetDeviceId === d) || (l.sourceDeviceId === d && l.targetDeviceId === s);
})!;

console.log('Utilidades');
check(isValidMask('255.255.255.0') && isValidMask('255.255.255.252') && !isValidMask('255.0.255.0'), 'máscaras contiguas');

console.log('LAN con un switch');
let t = setup('lan');
let r = simulatePing(t.devices, t.links, host(t.devices, 'PC1').id, '192.168.1.12');
check(replies(r).length === 1, 'ping en la misma subred');
check(has(r, 'log.arpWho') && has(r, 'log.arpLearn'), 'resuelve ARP antes de enviar');
check((host(r.devices, 'Switch1').macTable ?? []).length === 2, 'el switch aprende 2 MACs');
const r2 = simulatePing(r.devices, t.links, host(t.devices, 'PC1').id, '192.168.1.12');
check(replies(r2).length === 1 && !has(r2, 'log.arpWho'), 'segundo ping usa la caché ARP');
r = simulatePing(t.devices, t.links, host(t.devices, 'PC1').id, '192.168.2.20');
check(replies(r).length === 0 && has(r, 'log.noGateway'), 'otra subred sin gateway: error');
r = simulatePing(t.devices, t.links, host(t.devices, 'PC1').id, '192.168.1.10');
check(replies(r).length === 1, 'ping a sí mismo');

console.log('Rutas estáticas');
t = setup('static');
r = simulatePing(t.devices, t.links, host(t.devices, 'PC1').id, '192.168.2.11', 4);
check(replies(r).length === 4, '4 respuestas de 4');
check(replies(r).every(l => l.msg.params!.ttl === 62), 'TTL 62 tras dos routers');
check(has(r, 'log.pingStats'), 'estadísticas al final');
r = simulatePing(t.devices, t.links, host(t.devices, 'PC1').id, '8.8.8.8');
check(has(r, 'log.noRoute') && replies(r).length === 0, 'sin ruta: destino inalcanzable');
const noReturn = t.devices.map(d => (d.hostname === 'Router2' ? { ...d, routingTable: d.routingTable!.filter(x => x.type !== 'static') } : d));
r = simulatePing(noReturn, t.links, host(t.devices, 'PC1').id, '192.168.2.11');
check(replies(r).length === 0 && has(r, 'log.pingTimeout'), 'sin ruta de vuelta: tiempo agotado');
const off = recomputeRouting(t.devices.map(d => (d.hostname === 'Router1' ? { ...d, status: 'down' as const } : d)), t.links);
r = simulatePing(off.devices, t.links, host(t.devices, 'PC1').id, '192.168.2.11');
check(replies(r).length === 0 && has(r, 'log.arpNoReply'), 'gateway apagado: ARP sin respuesta');
r = simulatePing(t.devices, t.links.map(l => ({ ...l, packetLoss: 100 })), host(t.devices, 'PC1').id, '192.168.1.11', 2);
check(replies(r).length === 0 && has(r, 'log.lost') && r.anims.some(a => a.dropAt !== undefined), 'pérdida 100 %: paquetes perdidos');

console.log('RIP');
t = setup('rip');
check(t.logs.filter(l => l.key === 'log.ripLearn').length === 9, 'cada router aprende 3 redes por RIP');
r = simulatePing(t.devices, t.links, host(t.devices, 'PC1').id, '192.168.3.10');
check(replies(r)[0]?.msg.params!.ttl === 62, 'PC1→PC4 por el enlace directo R1–R3');
const l13 = linkBetween(t, 'Router1', 'Router3');
const downLinks = t.links.map(l => (l.id === l13.id ? { ...l, status: 'down' as const } : l));
const re = recomputeRouting(t.devices, downLinks);
check(re.logs.some(l => l.key === 'log.ripChange'), 'reconverge al caer R1–R3');
r = simulatePing(re.devices, downLinks, host(t.devices, 'PC1').id, '192.168.3.10');
check(replies(r)[0]?.msg.params!.ttl === 61, 'ahora por Router2 (TTL 61)');

console.log('DHCP');
t = setup('dhcp');
let d = simulateDhcp(t.devices, t.links, host(t.devices, 'PC1').id);
check(host(d.devices, 'PC1').interfaces[0].ipAddress === '192.168.10.100' && host(d.devices, 'PC1').defaultGateway === '192.168.10.1', 'PC1 recibe 192.168.10.100 y gateway');
d = simulateDhcp(d.devices, t.links, host(t.devices, 'PC2').id);
check(host(d.devices, 'PC2').interfaces[0].ipAddress === '192.168.10.101', 'PC2 recibe la siguiente libre');
d = simulateDhcp(d.devices, t.links, host(t.devices, 'PC4').id);
check(host(d.devices, 'PC4').interfaces[0].ipAddress === '192.168.20.100', 'PC4 recibe IP de su propia red');
r = simulatePing(d.devices, t.links, host(t.devices, 'PC1').id, '192.168.20.100');
check(replies(r).length === 1, 'ping entre redes tras DHCP');
const noSrv = t.devices.map(x => (x.type === 'router' ? { ...x, interfaces: x.interfaces.map(i => ({ ...i, dhcpServer: false })) } : x));
d = simulateDhcp(noSrv, t.links, host(t.devices, 'PC1').id);
check(has(d, 'log.dhcpNoServer'), 'sin servidor DHCP: aviso');

console.log('Carga de JSON');
const ex = buildExample('static');
const round = sanitizeTopology(JSON.parse(JSON.stringify({ devices: ex.devices, links: ex.links, name: 'x' })));
check(round.devices.length === 8 && round.links.length === 7, 'una topología válida se conserva');
let threw = false;
try { sanitizeTopology({ devices: 3 }); } catch { threw = true; }
check(threw, 'rechaza JSON sin la forma esperada');
const evil = sanitizeTopology({ devices: [{ id: 'a', type: 'pc', hostname: '<img src=x onerror=alert(1)>'.repeat(5), interfaces: [{ id: 'i', ipAddress: '999.1.1.1' }] }], links: [] });
check(evil.devices[0].hostname.length <= 32 && evil.devices[0].interfaces[0].ipAddress === '', 'recorta nombres y descarta IP inválidas');

console.log(failures ? `\n${failures} fallo(s)` : '\nTodo correcto');
if (failures) process.exit(1);
