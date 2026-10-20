// ============================================================
//  components/panels/RightPanel.tsx
//  Configuración del equipo o cable seleccionado
// ============================================================

import React, { useEffect, useState } from 'react';
import { useStore } from '@/engine/store';
import { Device, Link, NetworkInterface, RouteEntry } from '@/types/network';
import {
  broadcastAddress, cidr, hasValidAddress, ipInNetwork, isHostAddress, isValidIp, isValidMask,
  maskToPrefix, networkAddress,
} from '@/engine/algorithms/NetworkUtils';
import { shortIfName } from '@/engine/factory';
import { useT } from '@/hooks';

type T = ReturnType<typeof useT>;
const ICON = { router: '🔀', switch: '🔁', pc: '💻' } as const;

export const RightPanel: React.FC = () => {
  const drawer = useStore(s => s.drawer);
  const device = useStore(s => s.devices.find(d => d.id === s.selectedDeviceId));
  const link = useStore(s => s.links.find(l => l.id === s.selectedLinkId));

  return (
    <aside className={`side right ${drawer === 'right' ? 'open' : ''}`}>
      {link ? <LinkPanel key={link.id} link={link} />
        : device ? <DevicePanel key={device.id} device={device} />
          : <EmptyPanel />}
    </aside>
  );
};

// ── Sin selección ─────────────────────────────────────────
const EmptyPanel: React.FC = () => {
  const t = useT();
  const devices = useStore(s => s.devices);
  const links = useStore(s => s.links);
  const up = devices.filter(d => d.status === 'up').length;
  return (
    <>
      <div className="side-head"><span className="icon">📋</span><h2>{t('info.title')}</h2></div>
      <div className="side-body">
        <p className="hint">{t('info.hint')}</p>
        <div className="stats">
          <div className="stat"><b>{devices.length}</b><span>{t('info.devices')}</span></div>
          <div className="stat"><b>{links.length}</b><span>{t('info.links')}</span></div>
          <div className="stat"><b>{up}</b><span>{t('info.up')}</span></div>
          <div className="stat"><b>{devices.length - up}</b><span>{t('info.down')}</span></div>
        </div>
        <div className="sec-title">{t('info.howto')}</div>
        <ol className="steps">
          <li>{t('info.step1')}</li>
          <li>{t('info.step2')}</li>
          <li>{t('info.step3')}</li>
          <li>{t('info.step4')}</li>
        </ol>
        <p className="hint" style={{ marginTop: 12 }}>{t('info.shortcuts')}</p>
      </div>
    </>
  );
};

// ── Cable ─────────────────────────────────────────────────
const LinkPanel: React.FC<{ link: Link }> = ({ link }) => {
  const t = useT();
  const devices = useStore(s => s.devices);
  const { toggleLink, updateLink, removeLink } = useStore.getState();
  const a = devices.find(d => d.id === link.sourceDeviceId);
  const b = devices.find(d => d.id === link.targetDeviceId);
  const ia = a?.interfaces.find(i => i.id === link.sourceInterfaceId);
  const ib = b?.interfaces.find(i => i.id === link.targetInterfaceId);

  return (
    <>
      <div className="side-head">
        <span className="icon">🔌</span><h2>{t('link.title')}</h2>
        <span className={`badge ${link.status}`}>{link.status}</span>
      </div>
      <div className="side-body">
        <div className="sec-title">{t('link.ends')}</div>
        <div className="card">
          <div className="card-meta"><b>{a?.hostname}</b> <span className="mono">{ia?.name}</span></div>
          <div className="card-meta" style={{ textAlign: 'center' }}>↕</div>
          <div className="card-meta"><b>{b?.hostname}</b> <span className="mono">{ib?.name}</span></div>
        </div>

        <div className="sec-title">{t('link.params')}</div>
        <Slider label={t('link.latency')} value={link.latency} min={1} max={500} onChange={v => updateLink(link.id, { latency: v })} />
        <Slider label={t('link.loss')} value={link.packetLoss} min={0} max={100} onChange={v => updateLink(link.id, { packetLoss: v })} />

        <button className={`btn ${link.status === 'up' ? 'danger' : 'success'}`} onClick={() => toggleLink(link.id)}>
          {link.status === 'up' ? `⬇️ ${t('link.down')}` : `⬆️ ${t('link.up')}`}
        </button>
        <button className="btn ghost-danger" onClick={() => removeLink(link.id)}>🗑️ {t('link.delete')}</button>
      </div>
    </>
  );
};

const Slider: React.FC<{ label: string; value: number; min: number; max: number; onChange: (v: number) => void }> =
  ({ label, value, min, max, onChange }) => (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>
        <span>{label}</span><span className="mono" style={{ color: 'var(--text-2)' }}>{value}</span>
      </span>
      <input type="range" min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))} />
    </label>
  );

// ── Equipo ────────────────────────────────────────────────
const DevicePanel: React.FC<{ device: Device }> = ({ device }) => {
  const t = useT();
  const { renameDevice, toggleDevice, removeDevice } = useStore.getState();
  const [name, setName] = useState(device.hostname);
  useEffect(() => setName(device.hostname), [device.hostname]);

  return (
    <>
      <div className="side-head">
        <span className="icon">{ICON[device.type]}</span>
        <h2>{device.hostname}</h2>
        <span className={`badge ${device.status}`}>{device.status}</span>
      </div>
      <div className="side-body">
        <div className="sec-title">{t('dev.general')}</div>
        <div className="row">
          <input
            className="input" value={name} maxLength={32} aria-label={t('dev.hostname')}
            onChange={e => setName(e.target.value)}
            onBlur={() => renameDevice(device.id, name)}
            onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </div>
        <div className="row">
          <button className={`btn small ${device.status === 'up' ? 'danger' : 'success'}`} style={{ flex: 1 }} onClick={() => toggleDevice(device.id)}>
            {device.status === 'up' ? `⏻ ${t('dev.powerOff')}` : `⏻ ${t('dev.powerOn')}`}
          </button>
          <button className="btn small ghost-danger" onClick={() => removeDevice(device.id)} title={t('dev.delete')} aria-label={t('dev.delete')}>🗑️</button>
        </div>

        {device.type !== 'switch' && <PingBox device={device} t={t} />}

        {device.type === 'pc' && <PcNetwork device={device} t={t} />}

        {device.type === 'router' && (
          <>
            <div className="sec-title">{t('dev.interfaces')}</div>
            {device.interfaces.map(i => <IfaceEditor key={i.id} device={device} iface={i} t={t} />)}
            <RouterRouting device={device} t={t} />
          </>
        )}

        {device.type === 'switch' && <SwitchInfo device={device} t={t} />}

        {device.type !== 'switch' && <ArpTable device={device} t={t} />}
      </div>
    </>
  );
};

/** «conectada a Router1 (Gi0/0)» o «libre». */
function usePeerLabel(iface: NetworkInterface, t: T) {
  const devices = useStore(s => s.devices);
  const links = useStore(s => s.links);
  const link = links.find(l => l.id === iface.connectedLinkId);
  if (!link) return { text: t('if.free'), up: false };
  const mine = link.sourceInterfaceId === iface.id;
  const peer = devices.find(d => d.id === (mine ? link.targetDeviceId : link.sourceDeviceId));
  const pIf = peer?.interfaces.find(i => i.id === (mine ? link.targetInterfaceId : link.sourceInterfaceId));
  return {
    text: `${t('if.connectedTo')} ${peer?.hostname ?? '?'} (${shortIfName(pIf?.name ?? '?')})`,
    up: link.status === 'up' && peer?.status === 'up' && iface.status === 'up' && pIf?.status === 'up',
  };
}

// ── Editor de IP/máscara de una interfaz (PC o router) ─────
const IfaceEditor: React.FC<{ device: Device; iface: NetworkInterface; t: T; compact?: boolean }> = ({ device, iface, t, compact }) => {
  const { setInterface } = useStore.getState();
  const devices = useStore(s => s.devices);
  const [ip, setIp] = useState(iface.ipAddress);
  const [mask, setMask] = useState(iface.subnetMask);
  useEffect(() => { setIp(iface.ipAddress); setMask(iface.subnetMask); }, [iface.ipAddress, iface.subnetMask]);
  const peer = usePeerLabel(iface, t);

  const ipErr = ip && !isValidIp(ip) ? t('if.invalidIp') : '';
  const maskErr = mask && !isValidMask(mask) ? t('if.invalidMask') : '';
  let warn = '';
  if (!ipErr && !maskErr && ip && mask) {
    if (!isHostAddress(ip, mask)) warn = t('if.netOrBcast');
    const dup = devices.find(d => d.interfaces.some(i => i.id !== iface.id && i.ipAddress === ip));
    if (dup) warn = t('if.duplicate', { host: dup.hostname });
  }

  const commit = () => {
    const nextIp = ip.trim();
    const nextMask = mask.trim();
    if ((nextIp && !isValidIp(nextIp)) || (nextMask && !isValidMask(nextMask))) return;
    if (nextIp !== iface.ipAddress || nextMask !== iface.subnetMask) {
      setInterface(device.id, iface.id, { ipAddress: nextIp, subnetMask: nextMask || '255.255.255.0' });
    }
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && (e.target as HTMLInputElement).blur();

  return (
    <div className="card">
      {!compact && (
        <div className="card-head">
          <b className="mono">{iface.name}</b>
          <span className={`badge ${peer.up ? 'up' : 'down'}`}>{peer.up ? 'up' : 'down'}</span>
        </div>
      )}
      <div className="field">
        <label htmlFor={`ip-${iface.id}`}>{t('if.ip')}</label>
        <input id={`ip-${iface.id}`} className={`input mono ${ipErr ? 'invalid' : ''}`} value={ip} placeholder="192.168.1.10"
          onChange={e => setIp(e.target.value)} onBlur={commit} onKeyDown={onKey} spellCheck={false} inputMode="decimal" />
      </div>
      {ipErr && <div className="err">{ipErr}</div>}
      <div className="field">
        <label htmlFor={`mask-${iface.id}`}>{t('if.mask')}</label>
        <input id={`mask-${iface.id}`} className={`input mono ${maskErr ? 'invalid' : ''}`} value={mask} placeholder="255.255.255.0"
          onChange={e => setMask(e.target.value)} onBlur={commit} onKeyDown={onKey} spellCheck={false} inputMode="decimal" />
      </div>
      {maskErr && <div className="err">{maskErr}</div>}
      {warn && <div className="err" style={{ color: 'var(--warn)' }}>{warn}</div>}
      {hasValidAddress(iface) && (
        <div className="card-meta">
          {t('if.net')} <span className="mono">{cidr(iface.ipAddress, iface.subnetMask)}</span> · bcast <span className="mono">{broadcastAddress(iface.ipAddress, iface.subnetMask)}</span>
        </div>
      )}
      <div className="card-meta">{t('if.mac')} <span className="mono">{iface.macAddress}</span></div>
      <div className="card-meta">{peer.text}</div>
      {device.type === 'router' && (
        <>
          <label className="check">
            <input type="checkbox" checked={iface.status === 'down'}
              onChange={e => setInterface(device.id, iface.id, { status: e.target.checked ? 'down' : 'up' })} />
            <span className="mono">{t('if.shutdown')}</span>
          </label>
          <label className="check" style={{ marginTop: 0 }}>
            <input type="checkbox" checked={!!iface.dhcpServer}
              onChange={e => setInterface(device.id, iface.id, { dhcpServer: e.target.checked })} />
            <span>{t('if.dhcpServer')}</span>
          </label>
        </>
      )}
    </div>
  );
};

// ── PC: interfaz, gateway y DHCP ───────────────────────────
const PcNetwork: React.FC<{ device: Device; t: T }> = ({ device, t }) => {
  const { setGateway, dhcp } = useStore.getState();
  const iface = device.interfaces[0];
  const [gw, setGw] = useState(device.defaultGateway ?? '');
  useEffect(() => setGw(device.defaultGateway ?? ''), [device.defaultGateway]);
  const gwErr = gw && !isValidIp(gw) ? t('if.invalidIp')
    : gw && hasValidAddress(iface) && !ipInNetwork(gw, iface.ipAddress, iface.subnetMask) ? t('pc.gwOutside') : '';

  const commit = () => {
    const v = gw.trim();
    if (v && !isValidIp(v)) return;
    if (v !== (device.defaultGateway ?? '')) setGateway(device.id, v);
  };

  return (
    <>
      <div className="sec-title">{t('pc.network')} · {iface.name}</div>
      <IfaceEditor device={device} iface={iface} t={t} compact />
      <div className="field">
        <label htmlFor="pc-gw">{t('pc.gateway')}</label>
        <input id="pc-gw" className={`input mono ${gw && !isValidIp(gw) ? 'invalid' : ''}`} value={gw} placeholder="192.168.1.1"
          onChange={e => setGw(e.target.value)} onBlur={commit}
          onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} spellCheck={false} inputMode="decimal" />
      </div>
      {gwErr && <div className="err" style={gw && isValidIp(gw) ? { color: 'var(--warn)' } : undefined}>{gwErr}</div>}
      <button className="btn" onClick={() => dhcp(device.id)} disabled={device.status !== 'up'}>🎟️ {t('pc.dhcp')}</button>
    </>
  );
};

// ── Ping ───────────────────────────────────────────────────
const PingBox: React.FC<{ device: Device; t: T }> = ({ device, t }) => {
  const { ping } = useStore.getState();
  const devices = useStore(s => s.devices);
  const [dest, setDest] = useState('');
  const [count, setCount] = useState(1);
  const valid = isValidIp(dest.trim());
  const send = () => { if (valid) ping(device.id, dest.trim(), count); };

  // Destinos rápidos: IP de los demás PC y routers
  const targets = devices
    .filter(d => d.id !== device.id && d.type !== 'switch')
    .flatMap(d => d.interfaces.filter(i => hasValidAddress(i)).slice(0, d.type === 'pc' ? 1 : 4).map(i => ({ host: d.hostname, ip: i.ipAddress })))
    .slice(0, 12);

  return (
    <>
      <div className="sec-title">📡 {t('sim.title')}</div>
      <div className="row">
        <input className={`input mono ${dest && !valid ? 'invalid' : ''}`} value={dest} placeholder={t('sim.dest')} aria-label={t('sim.dest')}
          onChange={e => setDest(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} spellCheck={false} inputMode="decimal" />
        <select value={count} onChange={e => setCount(Number(e.target.value))} style={{ width: 58 }} aria-label={t('sim.count')} title={t('sim.count')}>
          <option value={1}>×1</option>
          <option value={4}>×4</option>
          <option value={10}>×10</option>
        </select>
        <button className="btn small primary" onClick={send} disabled={!valid || device.status !== 'up'} aria-label={t('sim.send')}>▶</button>
      </div>
      {targets.length > 0 && (
        <div className="chips" aria-label={t('sim.targets')}>
          {targets.map(x => (
            <button key={x.host + x.ip} className="chip mono" onClick={() => setDest(x.ip)} title={x.host}>{x.ip}</button>
          ))}
        </div>
      )}
    </>
  );
};

// ── Router: RIP, tabla de rutas y rutas estáticas ──────────
const RouterRouting: React.FC<{ device: Device; t: T }> = ({ device, t }) => {
  const { setRip, addStaticRoute, removeStaticRoute } = useStore.getState();
  const [dest, setDest] = useState('');
  const [mask, setMask] = useState('255.255.255.0');
  const [hop, setHop] = useState('');
  const [ifName, setIfName] = useState('');
  const [err, setErr] = useState('');

  const add = () => {
    if (!isValidIp(dest.trim())) return setErr(t('route.errDest'));
    if (!isValidMask(mask.trim())) return setErr(t('route.errMask'));
    if (!isValidIp(hop.trim())) return setErr(t('route.errHop'));
    setErr('');
    const route: RouteEntry = {
      destination: networkAddress(dest.trim(), mask.trim()), subnetMask: mask.trim(),
      nextHop: hop.trim(), interface: ifName, metric: 1, type: 'static',
    };
    addStaticRoute(device.id, route);
    setDest(''); setHop('');
  };

  const routes = device.routingTable ?? [];
  return (
    <>
      <div className="sec-title">{t('router.routes')}</div>
      <label className="check">
        <input type="checkbox" checked={!!device.ripEnabled} onChange={e => setRip(device.id, e.target.checked)} />
        <span><b>{t('router.rip')}</b><br /><span className="card-meta">{t('router.ripHint')}</span></span>
      </label>
      {routes.length === 0 ? <p className="hint">{t('router.noRoutes')}</p> : (
        <div className="card" style={{ padding: '2px 6px' }}>
          <table className="table mono">
            <tbody>
              {routes.map((r, idx) => (
                <tr key={idx}>
                  <td><span className={`badge ${r.type}`}>{r.type === 'connected' ? 'C' : r.type === 'static' ? 'S' : 'R'}</span></td>
                  <td>{r.destination}/{maskToPrefix(r.subnetMask)}</td>
                  <td>{r.type === 'connected' ? t('route.direct') : `→ ${r.nextHop}`}<br />
                    <span style={{ color: 'var(--muted)' }}>{shortIfName(r.interface) || t('route.auto')}{r.type === 'rip' ? ` [120/${r.metric}]` : ''}</span></td>
                  <td>{r.type === 'static' && (
                    <button className="x" onClick={() => removeStaticRoute(device.id, r)} title={t('route.remove')} aria-label={t('route.remove')}>✕</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="card-head"><b>{t('route.addStatic')}</b></div>
        <input className="input mono" style={{ marginBottom: 5 }} placeholder={t('route.dest')} value={dest} onChange={e => setDest(e.target.value)} spellCheck={false} />
        <input className="input mono" style={{ marginBottom: 5 }} placeholder={t('route.mask')} value={mask} onChange={e => setMask(e.target.value)} spellCheck={false} />
        <input className="input mono" style={{ marginBottom: 5 }} placeholder={t('route.nextHop')} value={hop} onChange={e => setHop(e.target.value)} spellCheck={false}
          onKeyDown={e => e.key === 'Enter' && add()} />
        <select value={ifName} onChange={e => setIfName(e.target.value)} style={{ marginBottom: 6 }} aria-label={t('route.iface')}>
          <option value="">{t('route.iface')}: {t('route.auto')}</option>
          {device.interfaces.map(i => <option key={i.id} value={i.name}>{i.name}</option>)}
        </select>
        {err && <div className="err" style={{ marginLeft: 0 }}>{err}</div>}
        <button className="btn primary" style={{ marginBottom: 0 }} onClick={add}>+ {t('route.add')}</button>
      </div>
    </>
  );
};

// ── Switch: puertos y tabla MAC ────────────────────────────
const SwitchPort: React.FC<{ iface: NetworkInterface; t: T }> = ({ iface, t }) => {
  const peer = usePeerLabel(iface, t);
  if (!iface.connectedLinkId) return null;
  return (
    <tr>
      <td><i className={`dot ${peer.up ? '' : 'bad'}`} /></td>
      <td>{shortIfName(iface.name)}</td>
      <td>{peer.text}</td>
    </tr>
  );
};

const SwitchInfo: React.FC<{ device: Device; t: T }> = ({ device, t }) => {
  const used = device.interfaces.filter(i => i.connectedLinkId).length;
  return (
    <>
      <div className="sec-title">{t('sw.ports')} · {used}/{device.interfaces.length}</div>
      <div className="card" style={{ padding: '2px 6px' }}>
        <table className="table">
          <tbody>{device.interfaces.map(i => <SwitchPort key={i.id} iface={i} t={t} />)}</tbody>
        </table>
        {used === 0 && <p className="hint" style={{ margin: 6 }}>—</p>}
      </div>
      <div className="sec-title">{t('mac.title')}</div>
      {(device.macTable ?? []).length === 0 ? <p className="hint">{t('mac.empty')}</p> : (
        <div className="card" style={{ padding: '2px 6px' }}>
          <table className="table mono">
            <tbody>
              {device.macTable!.map(e => (
                <tr key={e.macAddress}><td>{e.macAddress}</td><td>→ {shortIfName(e.port)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

// ── Caché ARP ──────────────────────────────────────────────
const ArpTable: React.FC<{ device: Device; t: T }> = ({ device, t }) => (
  <>
    <div className="sec-title">{t('arp.title')}</div>
    {(device.arpTable ?? []).length === 0 ? <p className="hint">{t('arp.empty')}</p> : (
      <div className="card" style={{ padding: '2px 6px' }}>
        <table className="table mono">
          <tbody>
            {device.arpTable!.map(e => (
              <tr key={e.interface + e.ip}><td>{e.ip}</td><td>{e.mac}</td>{device.type === 'router' && <td>{shortIfName(e.interface)}</td>}</tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </>
);
