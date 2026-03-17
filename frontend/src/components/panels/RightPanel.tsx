// ============================================================
//  components/panels/RightPanel.tsx
//  Configuración del dispositivo/enlace seleccionado
// ============================================================

import React, { useState } from 'react';
import { useStore } from '@/engine/store';
import { Device, Link, NetworkInterface, RouteEntry } from '@/types/network';
import { isValidIp } from '@/engine/algorithms/NetworkUtils';
import { buildConnectedRoutes } from '@/engine/algorithms/RoutingEngine';
import { v4 as uuidv4 } from 'uuid';

export const RightPanel: React.FC = () => {
  const {
    devices, links,
    selectedDeviceId, selectedLinkId,
    updateDevice, removeDevice,
    toggleDeviceStatus, toggleLinkStatus,
    sendPing, addRoute, removeRoute,
    saveTopology, loadTopology,
  } = useStore();

  const device = devices.find(d => d.id === selectedDeviceId);
  const link = links.find(l => l.id === selectedLinkId);

  if (!device && !link) return <EmptyPanel />;
  if (link)   return <LinkConfig link={link} toggleStatus={() => toggleLinkStatus(link.id)} />;
  if (device) return (
    <DeviceConfig
      device={device}
      updateDevice={updateDevice}
      removeDevice={removeDevice}
      toggleStatus={() => toggleDeviceStatus(device.id)}
      sendPing={sendPing}
      addRoute={addRoute}
      removeRoute={removeRoute}
      saveTopology={saveTopology}
      loadTopology={loadTopology}
    />
  );
  return null;
};

// ── Panel vacío ────────────────────────────────────────────
const EmptyPanel: React.FC = () => {
  const { saveTopology, loadTopology, devices, links } = useStore();
  const [topoName, setTopoName] = useState('mi-red');

  const handleSave = () => {
    const json = saveTopology(topoName);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${topoName}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoad = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => loadTopology(ev.target?.result as string);
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <aside style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.headerIcon}>📋</span>
        <span style={styles.headerTitle}>Información</span>
      </div>

      <div style={styles.body}>
        <div style={styles.hint}>
          Selecciona un dispositivo o enlace para configurarlo.
        </div>

        <div style={styles.statsGrid}>
          <Stat label="Dispositivos" value={devices.length} />
          <Stat label="Enlaces" value={links.length} />
          <Stat label="Activos" value={devices.filter(d => d.status === 'up').length} />
          <Stat label="Caídos" value={devices.filter(d => d.status === 'down').length} />
        </div>

        <div style={styles.sectionTitle}>GUARDAR / CARGAR</div>
        <input
          style={styles.input}
          value={topoName}
          onChange={e => setTopoName(e.target.value)}
          placeholder="Nombre de la topología"
        />
        <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={handleSave}>
          💾 Guardar JSON
        </button>
        <button style={{ ...styles.btn }} onClick={handleLoad}>
          📂 Cargar JSON
        </button>
      </div>
    </aside>
  );
};

// ── Stat card ──────────────────────────────────────────────
const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div style={styles.statCard}>
    <div style={styles.statValue}>{value}</div>
    <div style={styles.statLabel}>{label}</div>
  </div>
);

// ── Config de enlace ───────────────────────────────────────
const LinkConfig: React.FC<{ link: Link; toggleStatus: () => void }> = ({ link, toggleStatus }) => {
  const { updateDevice, devices, links } = useStore();
  const [latency, setLatency] = useState(link.latency);
  const [loss, setLoss] = useState(link.packetLoss);

  const srcDevice = devices.find(d => d.id === link.sourceDeviceId);
  const tgtDevice = devices.find(d => d.id === link.targetDeviceId);

  const applyChanges = () => {
    // Actualizar el link directamente en el store
    useStore.setState(s => ({
      links: s.links.map(l =>
        l.id === link.id ? { ...l, latency, packetLoss: loss } : l
      ),
    }));
  };

  return (
    <aside style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.headerIcon}>🔌</span>
        <span style={styles.headerTitle}>Enlace</span>
        <StatusBadge status={link.status} />
      </div>
      <div style={styles.body}>
        <Row label="Origen" value={srcDevice?.hostname ?? '?'} />
        <Row label="Destino" value={tgtDevice?.hostname ?? '?'} />
        <Row label="Estado" value={link.status.toUpperCase()} />
        <Row label="Ancho de banda" value={`${link.bandwidth} Mbps`} />

        <div style={styles.sectionTitle}>PARÁMETROS</div>
        <SliderRow
          label="Latencia (ms)"
          value={latency}
          min={1} max={500}
          onChange={setLatency}
        />
        <SliderRow
          label="Pérdida (%)"
          value={loss}
          min={0} max={100}
          onChange={setLoss}
        />
        <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={applyChanges}>
          Aplicar
        </button>
        <button
          style={{ ...styles.btn, ...(link.status === 'down' ? styles.btnSuccess : styles.btnDanger) }}
          onClick={toggleStatus}
        >
          {link.status === 'up' ? '⬇️ Bajar enlace' : '⬆️ Subir enlace'}
        </button>
      </div>
    </aside>
  );
};

// ── Config de dispositivo ──────────────────────────────────
const DeviceConfig: React.FC<{
  device: Device;
  updateDevice: (id: string, updates: Partial<Device>) => void;
  removeDevice: (id: string) => void;
  toggleStatus: () => void;
  sendPing: (sourceId: string, destIp: string) => void;
  addRoute: (deviceId: string, route: RouteEntry) => void;
  removeRoute: (deviceId: string, idx: number) => void;
  saveTopology: (name: string) => string;
  loadTopology: (json: string) => void;
}> = ({ device, updateDevice, removeDevice, toggleStatus, sendPing, addRoute, removeRoute }) => {
  const [hostname, setHostname] = useState(device.hostname);
  const [pingDest, setPingDest] = useState('');
  const [gateway, setGateway] = useState(device.defaultGateway ?? '');

  const [newRoute, setNewRoute] = useState<Partial<RouteEntry>>({
    destination: '', subnetMask: '255.255.255.0', nextHop: '', interface: '', metric: 1, type: 'static',
  });

  const applyHostname = () => {
    if (hostname.trim()) updateDevice(device.id, { hostname: hostname.trim() });
  };

  const updateIface = (ifaceId: string, field: keyof NetworkInterface, value: string) => {
    const updated = device.interfaces.map(i =>
      i.id === ifaceId ? { ...i, [field]: value } : i
    );
    updateDevice(device.id, { interfaces: updated });
  };

  const handlePing = () => {
    if (pingDest.trim()) sendPing(device.id, pingDest.trim());
  };

  const applyGateway = () => {
    updateDevice(device.id, { defaultGateway: gateway });
  };

  const handleAddRoute = () => {
    if (!newRoute.destination || !newRoute.nextHop) return;
    addRoute(device.id, {
      ...newRoute as RouteEntry,
      id: uuidv4(),
    } as RouteEntry);
    setNewRoute({ destination: '', subnetMask: '255.255.255.0', nextHop: '', interface: '', metric: 1, type: 'static' });
  };

  return (
    <aside style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.headerIcon}>
          {device.type === 'router' ? '🔀' : device.type === 'switch' ? '🔁' : '💻'}
        </span>
        <span style={styles.headerTitle}>{device.type.toUpperCase()}</span>
        <StatusBadge status={device.status} />
      </div>

      <div style={styles.body}>
        {/* Hostname */}
        <div style={styles.sectionTitle}>GENERAL</div>
        <div style={styles.fieldRow}>
          <input
            style={styles.input}
            value={hostname}
            onChange={e => setHostname(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applyHostname()}
            placeholder="hostname"
          />
          <button style={{ ...styles.btnSmall, ...styles.btnPrimary }} onClick={applyHostname}>✓</button>
        </div>

        <button
          style={{ ...styles.btn, ...(device.status === 'down' ? styles.btnSuccess : styles.btnDanger), marginBottom: 4 }}
          onClick={toggleStatus}
        >
          {device.status === 'up' ? '⬇️ Apagar' : '⬆️ Encender'}
        </button>

        <button style={{ ...styles.btn, color: '#f87171' }} onClick={() => removeDevice(device.id)}>
          🗑️ Eliminar dispositivo
        </button>

        {/* Interfaces */}
        <div style={styles.sectionTitle}>INTERFACES</div>
        {device.interfaces.map(iface => (
          <div key={iface.id} style={styles.ifaceCard}>
            <div style={styles.ifaceName}>
              {iface.name}
              <span style={{
                marginLeft: 6, fontSize: 9, padding: '1px 5px', borderRadius: 4,
                background: iface.status === 'up' ? '#14532d' : '#450a0a',
                color: iface.status === 'up' ? '#22c55e' : '#ef4444',
              }}>{iface.status.toUpperCase()}</span>
              {iface.connectedLinkId && <span style={{ marginLeft: 4, fontSize: 9, color: '#585870' }}>conectado</span>}
            </div>
            {device.type !== 'switch' && (
              <>
                <div style={styles.ifaceRow}>
                  <span style={styles.ifaceLabel}>IP</span>
                  <input
                    style={styles.ifaceInput}
                    value={iface.ipAddress}
                    onChange={e => updateIface(iface.id, 'ipAddress', e.target.value)}
                    placeholder="0.0.0.0"
                  />
                </div>
                <div style={styles.ifaceRow}>
                  <span style={styles.ifaceLabel}>Máscara</span>
                  <input
                    style={styles.ifaceInput}
                    value={iface.subnetMask}
                    onChange={e => updateIface(iface.id, 'subnetMask', e.target.value)}
                    placeholder="255.255.255.0"
                  />
                </div>
              </>
            )}
            <div style={styles.ifaceRow}>
              <span style={styles.ifaceLabel}>MAC</span>
              <span style={{ fontSize: 9, color: '#585870', fontFamily: 'monospace' }}>{iface.macAddress}</span>
            </div>
          </div>
        ))}

        {/* PC: Gateway */}
        {device.type === 'pc' && (
          <>
            <div style={styles.sectionTitle}>RED</div>
            <div style={styles.ifaceRow}>
              <span style={styles.ifaceLabel}>Gateway</span>
              <input
                style={styles.ifaceInput}
                value={gateway}
                onChange={e => setGateway(e.target.value)}
                onBlur={applyGateway}
                placeholder="192.168.1.1"
              />
            </div>
          </>
        )}

        {/* PC: Ping */}
        {device.type === 'pc' && (
          <>
            <div style={styles.sectionTitle}>SIMULACIÓN</div>
            <div style={styles.fieldRow}>
              <input
                style={styles.input}
                value={pingDest}
                onChange={e => setPingDest(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handlePing()}
                placeholder="IP destino ping"
              />
              <button
                style={{ ...styles.btnSmall, ...styles.btnPrimary }}
                onClick={handlePing}
                disabled={!pingDest.trim()}
              >▶</button>
            </div>
          </>
        )}

        {/* Router: Tabla de rutas */}
        {device.type === 'router' && (
          <>
            <div style={styles.sectionTitle}>TABLA DE RUTAS</div>
            {(device.routingTable ?? []).length === 0
              ? <div style={styles.hint}>Sin rutas configuradas</div>
              : (device.routingTable ?? []).map((route, idx) => (
                <div key={idx} style={styles.routeRow}>
                  <div style={styles.routeNet}>{route.destination}/{route.subnetMask}</div>
                  <div style={styles.routeHop}>{route.nextHop} [{route.metric}]</div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span style={{
                      fontSize: 9, padding: '1px 5px', borderRadius: 4,
                      background: route.type === 'connected' ? '#1e3a5f' : route.type === 'rip' ? '#3a1e1e' : '#1e1e3a',
                      color: route.type === 'connected' ? '#60a5fa' : route.type === 'rip' ? '#f87171' : '#a78bfa',
                    }}>{route.type}</span>
                    {route.type === 'static' && (
                      <button
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}
                        onClick={() => removeRoute(device.id, idx)}
                      >✕</button>
                    )}
                  </div>
                </div>
              ))
            }
            {/* Añadir ruta estática */}
            <div style={{ marginTop: 8, padding: 8, background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid #1e2a45' }}>
              <div style={{ fontSize: 10, color: '#585870', marginBottom: 6 }}>AÑADIR RUTA ESTÁTICA</div>
              <input style={styles.input} placeholder="Destino (ej: 10.0.0.0)"
                value={newRoute.destination} onChange={e => setNewRoute(p => ({ ...p, destination: e.target.value }))} />
              <input style={{ ...styles.input, marginTop: 4 }} placeholder="Máscara"
                value={newRoute.subnetMask} onChange={e => setNewRoute(p => ({ ...p, subnetMask: e.target.value }))} />
              <input style={{ ...styles.input, marginTop: 4 }} placeholder="Next-hop"
                value={newRoute.nextHop} onChange={e => setNewRoute(p => ({ ...p, nextHop: e.target.value }))} />
              <input style={{ ...styles.input, marginTop: 4 }} placeholder="Interfaz (ej: Gi0/0)"
                value={newRoute.interface} onChange={e => setNewRoute(p => ({ ...p, interface: e.target.value }))} />
              <button style={{ ...styles.btn, ...styles.btnPrimary, marginTop: 6 }} onClick={handleAddRoute}>
                + Añadir ruta
              </button>
            </div>
          </>
        )}

        {/* Switch: tabla MAC */}
        {device.type === 'switch' && (
          <>
            <div style={styles.sectionTitle}>TABLA MAC</div>
            {(device.macTable ?? []).length === 0
              ? <div style={styles.hint}>Tabla vacía (se llena durante la simulación)</div>
              : (device.macTable ?? []).map((entry, idx) => (
                <div key={idx} style={styles.routeRow}>
                  <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#9090a8' }}>{entry.macAddress}</span>
                  <span style={{ fontSize: 9, color: '#585870' }}>→ {entry.port}</span>
                </div>
              ))
            }
          </>
        )}
      </div>
    </aside>
  );
};

// ── Componentes auxiliares ────────────────────────────────
const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
    <span style={{ fontSize: 11, color: '#585870' }}>{label}</span>
    <span style={{ fontSize: 11, color: '#9090a8', fontFamily: 'monospace' }}>{value}</span>
  </div>
);

const StatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <span style={{
    marginLeft: 'auto',
    fontSize: 10, fontWeight: 700,
    padding: '2px 8px', borderRadius: 10,
    background: status === 'up' ? '#14532d' : '#450a0a',
    color: status === 'up' ? '#22c55e' : '#ef4444',
  }}>
    {status.toUpperCase()}
  </span>
);

const SliderRow: React.FC<{
  label: string; value: number; min: number; max: number;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, onChange }) => (
  <div style={{ marginBottom: 10 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
      <span style={{ fontSize: 11, color: '#585870' }}>{label}</span>
      <span style={{ fontSize: 11, color: '#9090a8', fontFamily: 'monospace' }}>{value}</span>
    </div>
    <input
      type="range" min={min} max={max} value={value}
      onChange={e => onChange(Number(e.target.value))}
      style={{ width: '100%' }}
    />
  </div>
);

// ── Estilos ────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 240, minWidth: 240,
    background: '#111520',
    borderLeft: '1px solid #1e2a45',
    display: 'flex', flexDirection: 'column',
    overflowY: 'auto',
  },
  header: {
    padding: '14px 16px',
    display: 'flex', alignItems: 'center', gap: 8,
    borderBottom: '1px solid #1e2a45',
    position: 'sticky', top: 0,
    background: '#111520', zIndex: 1,
  },
  headerIcon: { fontSize: 20 },
  headerTitle: { fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: '#e8e8f0' },
  body: { padding: '12px 14px', flex: 1 },
  sectionTitle: {
    fontSize: 10, fontWeight: 700,
    letterSpacing: '1.5px', color: '#585870',
    marginTop: 14, marginBottom: 8,
    textTransform: 'uppercase' as const,
  },
  hint: { fontSize: 12, color: '#585870', lineHeight: 1.5, marginBottom: 8 },
  fieldRow: { display: 'flex', gap: 6, marginBottom: 6 },
  input: {
    flex: 1, padding: '7px 10px',
    background: '#1a1a24', border: '1px solid #2e2e3a',
    borderRadius: 8, color: '#e8e8f0', fontSize: 12,
    outline: 'none', width: '100%', marginBottom: 4,
  },
  btn: {
    display: 'block', width: '100%', padding: '8px 10px', marginBottom: 4,
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 8, cursor: 'pointer', color: '#9090a8', fontSize: 12, fontWeight: 500,
    textAlign: 'left' as const,
  },
  btnSmall: {
    padding: '7px 12px', background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
    cursor: 'pointer', color: '#e8e8f0', fontSize: 12, flexShrink: 0,
  },
  btnPrimary: { background: 'rgba(124,92,252,0.15)', borderColor: '#7c5cfc', color: '#c084fc' },
  btnDanger:  { background: 'rgba(239,68,68,0.1)',   borderColor: '#ef4444', color: '#f87171' },
  btnSuccess: { background: 'rgba(34,197,94,0.1)',   borderColor: '#22c55e', color: '#4ade80' },
  ifaceCard: {
    padding: 8, marginBottom: 6,
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid #1e2a45', borderRadius: 8,
  },
  ifaceName: { fontSize: 11, fontWeight: 700, color: '#9090a8', marginBottom: 4, fontFamily: 'monospace' },
  ifaceRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 },
  ifaceLabel: { fontSize: 10, color: '#585870', width: 50, flexShrink: 0 },
  ifaceInput: {
    flex: 1, padding: '4px 8px',
    background: '#1a1a24', border: '1px solid #2e2e3a',
    borderRadius: 6, color: '#e8e8f0', fontSize: 11, outline: 'none',
  },
  routeRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '4px 6px', marginBottom: 4,
    background: 'rgba(255,255,255,0.02)', borderRadius: 6,
    border: '1px solid #1e2a45',
  },
  routeNet: { fontSize: 10, fontFamily: 'monospace', color: '#9090a8' },
  routeHop: { fontSize: 9, color: '#585870' },
  statsGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14,
  },
  statCard: {
    padding: 10, textAlign: 'center' as const,
    background: 'rgba(255,255,255,0.03)', border: '1px solid #1e2a45', borderRadius: 8,
  },
  statValue: { fontSize: 20, fontWeight: 700, color: '#7c5cfc', fontFamily: 'monospace' },
  statLabel: { fontSize: 10, color: '#585870', marginTop: 2 },
};
