// ============================================================
//  engine/store.ts  —  Estado global con Zustand
// ============================================================

import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import {
  Device, DeviceType, Link, LogEntry, LogMessage, LogParams, NetworkInterface,
  PacketAnimation, Position, RouteEntry, Tool, Topology,
} from '@/types/network';
import { recomputeRouting } from './algorithms/RoutingEngine';
import { SimResult, simulateDhcp, simulatePing } from './NetworkEngine';
import { buildExample, connect, createDevice, ExampleId, sanitizeTopology } from './factory';
import { Lang } from '@/i18n';

export type Theme = 'dark' | 'light';

export interface Toast {
  id: number;
  key: string;
  params?: LogParams;
  level: 'info' | 'error' | 'success';
}

interface QueuedLog {
  due: number;
  msg: LogMessage;
}

interface StoreState {
  devices: Device[];
  links: Link[];
  anims: PacketAnimation[];
  queue: QueuedLog[];
  logs: LogEntry[];
  selectedDeviceId: string | null;
  selectedLinkId: string | null;
  activeTool: Tool;
  cableSource: string | null;
  speed: number;
  lang: Lang;
  theme: Theme;
  fitNonce: number;
  toast: Toast | null;
  drawer: 'left' | 'right' | null;   // paneles en pantallas estrechas

  // Topología
  addDevice: (type: DeviceType, position: Position) => void;
  removeDevice: (id: string) => void;
  renameDevice: (id: string, hostname: string) => void;
  moveDevice: (id: string, position: Position) => void;
  toggleDevice: (id: string) => void;
  setInterface: (deviceId: string, ifaceId: string, patch: Partial<NetworkInterface>) => void;
  setGateway: (deviceId: string, gw: string) => void;
  setRip: (deviceId: string, on: boolean) => void;
  addStaticRoute: (deviceId: string, route: RouteEntry) => void;
  removeStaticRoute: (deviceId: string, route: RouteEntry) => void;
  addLink: (sourceId: string, targetId: string) => boolean;
  removeLink: (id: string) => void;
  toggleLink: (id: string) => void;
  updateLink: (id: string, patch: Partial<Pick<Link, 'latency' | 'packetLoss'>>) => void;

  // Selección y herramientas
  selectDevice: (id: string | null) => void;
  selectLink: (id: string | null) => void;
  setTool: (tool: Tool) => void;
  setCableSource: (id: string | null) => void;
  deleteSelection: () => void;

  // Simulación
  ping: (sourceId: string, destIp: string, count: number) => void;
  dhcp: (pcId: string) => void;
  tick: (now: number) => void;
  clearAnimations: () => void;
  setSpeed: (s: number) => void;

  // Log y avisos
  clearLogs: () => void;
  showToast: (key: string, level?: Toast['level'], params?: LogParams) => void;

  // Archivo
  exportTopology: (name: string) => string;
  importTopology: (json: string) => boolean;
  loadExample: (id: ExampleId) => void;
  clearAll: () => void;

  // Preferencias y vista
  setLang: (l: Lang) => void;
  setTheme: (t: Theme) => void;
  requestFit: () => void;
  setDrawer: (d: StoreState['drawer']) => void;
}

// ── localStorage protegido (modo privado, almacenamiento bloqueado…) ──
const LS = {
  get(k: string): string | null {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k: string, v: string) {
    try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ }
  },
};

let logSeq = 0;
let toastSeq = 0;
const mkLog = (m: LogMessage): LogEntry => ({ ...m, id: `l${++logSeq}`, timestamp: Date.now() });

/** Vacía cachés ARP y tablas MAC (tras un cambio de cableado o direccionamiento). */
function flushTables(devices: Device[]): { devices: Device[]; flushed: boolean } {
  let flushed = false;
  const out = devices.map(d => {
    if (d.arpTable?.length || d.macTable?.length) {
      flushed = true;
      return { ...d, ...(d.arpTable && { arpTable: [] }), ...(d.macTable && { macTable: [] }) };
    }
    return d;
  });
  return { devices: out, flushed };
}

function initialTopology(): { devices: Device[]; links: Link[] } {
  const saved = LS.get('ps_topology');
  if (saved) {
    try {
      const t = sanitizeTopology(JSON.parse(saved));
      return { devices: recomputeRouting(t.devices, t.links).devices, links: t.links };
    } catch { /* guardado corrupto: se ignora */ }
  }
  const ex = buildExample('static');
  return { devices: recomputeRouting(ex.devices, ex.links).devices, links: ex.links };
}

function initialLang(): Lang {
  const s = LS.get('ps_lang');
  if (s === 'es' || s === 'en') return s;
  return typeof navigator !== 'undefined' && /^es\b/i.test(navigator.language) ? 'es' : 'en';
}

function initialTheme(): Theme {
  const s = LS.get('ps_theme');
  if (s === 'dark' || s === 'light') return s;
  return 'dark';
}

export const useStore = create<StoreState>((set, get) => {
  /**
   * Aplica un cambio de topología: recalcula rutas (conectadas, estáticas y RIP)
   * y, si el cambio afecta al cableado o a las direcciones, vacía ARP/MAC.
   */
  const commit = (devices: Device[], links: Link[], opts: { flush?: boolean; extra?: Partial<StoreState>; logs?: LogMessage[] } = {}) => {
    let devs = devices;
    const newLogs: LogMessage[] = [...(opts.logs ?? [])];
    if (opts.flush) {
      const f = flushTables(devs);
      devs = f.devices;
      if (f.flushed) newLogs.push({ level: 'info', source: 'Packet Stones', key: 'log.cleared' });
    }
    const r = recomputeRouting(devs, links);
    newLogs.push(...r.logs);
    set(s => ({
      devices: r.devices,
      links,
      ...(newLogs.length && { logs: [...s.logs, ...newLogs.map(mkLog)].slice(-600) }),
      ...opts.extra,
    }));
  };

  const mapDevice = (id: string, fn: (d: Device) => Device) => get().devices.map(d => (d.id === id ? fn(d) : d));

  /** Programa en el tiempo las animaciones y mensajes que devuelve el motor. */
  const play = (res: SimResult) => {
    const now = performance.now();
    const k = 1 / get().speed;
    const anims: PacketAnimation[] = res.anims.map(a => ({
      id: uuidv4(), kind: a.kind, linkId: a.linkId, fromDeviceId: a.from, toDeviceId: a.to,
      startTime: now + a.start * k, duration: a.duration * k, dropAt: a.dropAt,
    }));
    const queue: QueuedLog[] = res.logs.map(l => ({ due: now + l.at * k, msg: l.msg }));
    set(s => ({
      devices: res.devices,
      anims: [...s.anims, ...anims],
      queue: [...s.queue, ...queue].sort((a, b) => a.due - b.due),
    }));
    get().tick(now);
  };

  const topo = initialTopology();

  return {
    devices: topo.devices,
    links: topo.links,
    anims: [],
    queue: [],
    logs: [],
    selectedDeviceId: null,
    selectedLinkId: null,
    activeTool: 'select',
    cableSource: null,
    speed: 1,
    lang: initialLang(),
    theme: initialTheme(),
    fitNonce: 1,
    toast: null,
    drawer: null,

    // ── Dispositivos ──────────────────────────────────────
    addDevice: (type, position) => {
      const d = createDevice(type, position, get().devices);
      commit([...get().devices, d], get().links, { extra: { selectedDeviceId: d.id, selectedLinkId: null } });
    },

    removeDevice: (id) => {
      const { devices, links } = get();
      const gone = new Set(links.filter(l => l.sourceDeviceId === id || l.targetDeviceId === id).map(l => l.id));
      const rest = devices
        .filter(d => d.id !== id)
        .map(d => (d.interfaces.some(i => i.connectedLinkId && gone.has(i.connectedLinkId))
          ? { ...d, interfaces: d.interfaces.map(i => (i.connectedLinkId && gone.has(i.connectedLinkId) ? { ...i, connectedLinkId: undefined } : i)) }
          : d));
      const s = get();
      commit(rest, links.filter(l => !gone.has(l.id)), {
        flush: true,
        extra: {
          selectedDeviceId: s.selectedDeviceId === id ? null : s.selectedDeviceId,
          selectedLinkId: s.selectedLinkId && gone.has(s.selectedLinkId) ? null : s.selectedLinkId,
          cableSource: s.cableSource === id ? null : s.cableSource,
          anims: s.anims.filter(a => !gone.has(a.linkId)),
        },
      });
    },

    renameDevice: (id, hostname) => {
      const name = hostname.trim().slice(0, 32);
      if (!name) return;
      set({ devices: mapDevice(id, d => ({ ...d, hostname: name })) });
    },

    moveDevice: (id, position) => set({ devices: mapDevice(id, d => ({ ...d, position })) }),

    toggleDevice: (id) => {
      const dev = get().devices.find(d => d.id === id);
      if (!dev) return;
      const status = dev.status === 'up' ? 'down' : 'up';
      commit(mapDevice(id, d => ({ ...d, status })), get().links, {
        flush: true,
        logs: [{ level: status === 'up' ? 'success' : 'warning', source: dev.hostname, key: status === 'up' ? 'log.powerOn' : 'log.powerOff' }],
      });
    },

    setInterface: (deviceId, ifaceId, patch) => {
      commit(mapDevice(deviceId, d => ({
        ...d, interfaces: d.interfaces.map(i => (i.id === ifaceId ? { ...i, ...patch } : i)),
      })), get().links, { flush: !('dhcpServer' in patch && Object.keys(patch).length === 1) });
    },

    setGateway: (deviceId, gw) => {
      commit(mapDevice(deviceId, d => ({ ...d, defaultGateway: gw })), get().links, { flush: true });
    },

    setRip: (deviceId, on) => commit(mapDevice(deviceId, d => ({ ...d, ripEnabled: on })), get().links),

    addStaticRoute: (deviceId, route) => commit(
      mapDevice(deviceId, d => ({ ...d, routingTable: [...(d.routingTable ?? []), route] })), get().links,
    ),

    removeStaticRoute: (deviceId, route) => commit(
      mapDevice(deviceId, d => ({ ...d, routingTable: (d.routingTable ?? []).filter(r => r !== route) })), get().links,
    ),

    // ── Cables ────────────────────────────────────────────
    addLink: (sourceId, targetId) => {
      const { devices, links } = get();
      if (sourceId === targetId) return false;
      if (links.some(l => (l.sourceDeviceId === sourceId && l.targetDeviceId === targetId)
        || (l.sourceDeviceId === targetId && l.targetDeviceId === sourceId))) {
        get().showToast('cable.exists', 'error');
        return false;
      }
      for (const id of [sourceId, targetId]) {
        const d = devices.find(x => x.id === id);
        if (d && !d.interfaces.some(i => !i.connectedLinkId)) {
          get().showToast('cable.noPorts', 'error', { host: d.hostname });
          return false;
        }
      }
      const r = connect(devices, sourceId, targetId);
      if (!r) return false;
      commit(r.devices, [...links, r.link], { flush: true });
      return true;
    },

    removeLink: (id) => {
      const { devices, links } = get();
      const updated = devices.map(d => (d.interfaces.some(i => i.connectedLinkId === id)
        ? { ...d, interfaces: d.interfaces.map(i => (i.connectedLinkId === id ? { ...i, connectedLinkId: undefined } : i)) }
        : d));
      commit(updated, links.filter(l => l.id !== id), {
        flush: true,
        extra: {
          selectedLinkId: get().selectedLinkId === id ? null : get().selectedLinkId,
          anims: get().anims.filter(a => a.linkId !== id),
        },
      });
    },

    toggleLink: (id) => {
      const { devices, links } = get();
      const link = links.find(l => l.id === id);
      if (!link) return;
      const status = link.status === 'up' ? 'down' : 'up';
      const name = (did: string) => devices.find(d => d.id === did)?.hostname ?? '?';
      commit(devices, links.map(l => (l.id === id ? { ...l, status } : l)), {
        flush: true,
        logs: [{
          level: status === 'up' ? 'success' : 'warning', source: 'Packet Stones',
          key: status === 'up' ? 'log.linkUp' : 'log.linkDownEv',
          params: { a: name(link.sourceDeviceId), b: name(link.targetDeviceId) },
        }],
      });
    },

    updateLink: (id, patch) => set(s => ({ links: s.links.map(l => (l.id === id ? { ...l, ...patch } : l)) })),

    // ── Selección ─────────────────────────────────────────
    selectDevice: (id) => set({ selectedDeviceId: id, selectedLinkId: null }),
    selectLink: (id) => set({ selectedLinkId: id, selectedDeviceId: null }),
    setTool: (tool) => set({ activeTool: tool, cableSource: null }),
    setCableSource: (id) => set({ cableSource: id }),
    deleteSelection: () => {
      const { selectedDeviceId, selectedLinkId } = get();
      if (selectedDeviceId) get().removeDevice(selectedDeviceId);
      else if (selectedLinkId) get().removeLink(selectedLinkId);
    },

    // ── Simulación ────────────────────────────────────────
    ping: (sourceId, destIp, count) => {
      const { devices, links } = get();
      play(simulatePing(devices, links, sourceId, destIp.trim(), count));
    },

    dhcp: (pcId) => {
      const { devices, links } = get();
      play(simulateDhcp(devices, links, pcId));
    },

    tick: (now) => {
      const { queue, anims } = get();
      let i = 0;
      while (i < queue.length && queue[i].due <= now) i++;
      const finished = anims.some(a => now >= a.startTime + a.duration);
      if (!i && !finished) return;
      set(s => ({
        ...(i && { queue: s.queue.slice(i), logs: [...s.logs, ...s.queue.slice(0, i).map(q => mkLog(q.msg))].slice(-600) }),
        ...(finished && { anims: s.anims.filter(a => now < a.startTime + a.duration) }),
      }));
    },

    clearAnimations: () => {
      // Lo pendiente del log se muestra ya, para no perder el resultado
      set(s => ({ anims: [], queue: [], logs: [...s.logs, ...s.queue.map(q => mkLog(q.msg))].slice(-600) }));
    },

    setSpeed: (speed) => set({ speed }),

    // ── Log y avisos ──────────────────────────────────────
    clearLogs: () => set({ logs: [] }),
    showToast: (key, level = 'info', params) => set({ toast: { id: ++toastSeq, key, level, params } }),

    // ── Archivo ───────────────────────────────────────────
    exportTopology: (name) => {
      const { devices, links } = get();
      const clean = devices.map(d => ({
        ...d,
        ...(d.arpTable && { arpTable: [] }),
        ...(d.macTable && { macTable: [] }),
        ...(d.routingTable && { routingTable: d.routingTable.filter(r => r.type === 'static') }),
      }));
      const topology: Topology = { version: '2.0', name, createdAt: new Date().toISOString(), devices: clean, links };
      return JSON.stringify(topology, null, 2);
    },

    importTopology: (json) => {
      try {
        const t = sanitizeTopology(JSON.parse(json));
        commit(t.devices, t.links, {
          extra: { anims: [], queue: [], logs: [], selectedDeviceId: null, selectedLinkId: null, cableSource: null, fitNonce: get().fitNonce + 1 },
        });
        get().showToast('load.ok', 'success', { name: t.name });
        return true;
      } catch {
        get().showToast('load.error', 'error');
        return false;
      }
    },

    loadExample: (id) => {
      const ex = buildExample(id);
      commit(ex.devices, ex.links, {
        extra: {
          anims: [], queue: [], logs: [], selectedDeviceId: null, selectedLinkId: null,
          cableSource: null, activeTool: 'select', fitNonce: get().fitNonce + 1, drawer: null,
        },
      });
    },

    clearAll: () => set({
      devices: [], links: [], anims: [], queue: [], logs: [],
      selectedDeviceId: null, selectedLinkId: null, cableSource: null, activeTool: 'select',
    }),

    // ── Preferencias y vista ──────────────────────────────
    setLang: (lang) => { LS.set('ps_lang', lang); set({ lang }); },
    setTheme: (theme) => {
      LS.set('ps_theme', theme);
      document.documentElement.dataset.theme = theme;  // antes de que el lienzo relea los colores
      set({ theme });
    },
    requestFit: () => set(s => ({ fitNonce: s.fitNonce + 1 })),
    setDrawer: (drawer) => set({ drawer }),
  };
});

// ── Guardado automático de la topología en este navegador ──
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s, prev) => {
  if (s.devices === prev.devices && s.links === prev.links) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => LS.set('ps_topology', useStore.getState().exportTopology('autosave')), 400);
});
