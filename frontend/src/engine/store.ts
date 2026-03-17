// ============================================================
//  engine/store.ts  —  Estado global con Zustand
// ============================================================

import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import {
  Device, Link, PacketAnimation, LogEntry,
  SimulatorState, Tool, DeviceType, Topology, RouteEntry,
} from '@/types/network';
import { generateMac, generateDefaultIp } from './algorithms/NetworkUtils';
import { buildConnectedRoutes } from './algorithms/RoutingEngine';
import { networkEngine } from './NetworkEngine';

// ── Defaults por tipo de dispositivo ──────────────────────
const DEFAULT_INTERFACES = {
  router: ['GigabitEthernet0/0', 'GigabitEthernet0/1', 'GigabitEthernet0/2'],
  switch: ['FastEthernet0/1', 'FastEthernet0/2', 'FastEthernet0/3', 'FastEthernet0/4',
           'FastEthernet0/5', 'FastEthernet0/6', 'FastEthernet0/7', 'FastEthernet0/8'],
  pc:     ['eth0'],
};

let deviceCounter = 0;

function createDevice(type: DeviceType, position: { x: number; y: number }): Device {
  deviceCounter++;
  const idx = deviceCounter;
  const hostname = `${type === 'router' ? 'Router' : type === 'switch' ? 'Switch' : 'PC'}${idx}`;
  const ifaceNames = DEFAULT_INTERFACES[type];

  const interfaces = ifaceNames.map((name, i) => ({
    id: uuidv4(),
    name,
    ipAddress: type === 'pc' ? generateDefaultIp(idx) : '',
    subnetMask: '255.255.255.0',
    status: 'up' as const,
    macAddress: generateMac(),
    connectedLinkId: undefined,
  }));

  const device: Device = {
    id: uuidv4(),
    type,
    hostname,
    position,
    status: 'up',
    interfaces,
    ...(type === 'router' && {
      routingTable: [],
    }),
    ...(type === 'switch' && {
      macTable: [],
    }),
    ...(type === 'pc' && {
      defaultGateway: '',
    }),
  };

  return device;
}

// ── Estado inicial ─────────────────────────────────────────
interface StoreState extends SimulatorState {
  // Acciones de topología
  addDevice:       (type: DeviceType, position: { x: number; y: number }) => void;
  removeDevice:    (id: string) => void;
  updateDevice:    (id: string, updates: Partial<Device>) => void;
  moveDevice:      (id: string, position: { x: number; y: number }) => void;
  addLink:         (sourceId: string, targetId: string) => void;
  removeLink:      (id: string) => void;
  toggleLinkStatus:(id: string) => void;
  toggleDeviceStatus:(id: string) => void;

  // Selección
  selectDevice:    (id: string | null) => void;
  selectLink:      (id: string | null) => void;
  setTool:         (tool: Tool) => void;
  setCableSource:  (id: string | null) => void;

  // Simulación
  sendPing:        (sourceId: string, destIp: string) => void;
  updateAnimations:(time: number) => void;
  clearAnimations: () => void;

  // Rutas
  addRoute:        (deviceId: string, route: RouteEntry) => void;
  removeRoute:     (deviceId: string, routeIdx: number) => void;

  // Log
  addLog:          (entry: LogEntry) => void;
  clearLogs:       () => void;

  // Topología
  saveTopology:    (name: string) => string;
  loadTopology:    (json: string) => void;
  loadExample:     () => void;
  clearAll:        () => void;
}

export const useStore = create<StoreState>((set, get) => {
  // Escuchar eventos del motor → agregar logs al store
  networkEngine.on(event => {
    if (event.type === 'log') {
      set(s => ({ logs: [event.entry, ...s.logs].slice(0, 200) }));
    }
  });

  return {
    // ── Estado inicial ────────────────────────────────────
    devices: [],
    links: [],
    packets: [],
    logs: [],
    selectedDeviceId: null,
    selectedLinkId: null,
    activeTool: 'select',
    cableSource: null,
    isSimulating: false,
    stepMode: false,

    // ── Dispositivos ──────────────────────────────────────
    addDevice: (type, position) => {
      const device = createDevice(type, position);
      set(s => ({ devices: [...s.devices, device] }));
    },

    removeDevice: (id) => {
      set(s => ({
        devices: s.devices.filter(d => d.id !== id),
        links: s.links.filter(l => l.sourceDeviceId !== id && l.targetDeviceId !== id),
        selectedDeviceId: s.selectedDeviceId === id ? null : s.selectedDeviceId,
      }));
    },

    updateDevice: (id, updates) => {
      set(s => {
        const updated = s.devices.map(d => {
          if (d.id !== id) return d;
          const merged = { ...d, ...updates };
          // Recalcular rutas conectadas si es router y cambiaron interfaces
          if (merged.type === 'router' && updates.interfaces) {
            const connected = buildConnectedRoutes(merged);
            const nonConnected = (merged.routingTable ?? []).filter(r => r.type !== 'connected');
            merged.routingTable = [...connected, ...nonConnected];
          }
          return merged;
        });
        return { devices: updated };
      });
    },

    moveDevice: (id, position) => {
      set(s => ({
        devices: s.devices.map(d => d.id === id ? { ...d, position } : d),
      }));
    },

    // ── Links ─────────────────────────────────────────────
    addLink: (sourceId, targetId) => {
      const { devices, links } = get();
      const source = devices.find(d => d.id === sourceId);
      const target = devices.find(d => d.id === targetId);
      if (!source || !target) return;
      if (sourceId === targetId) return;

      // Evitar duplicados
      const exists = links.some(
        l => (l.sourceDeviceId === sourceId && l.targetDeviceId === targetId) ||
             (l.sourceDeviceId === targetId && l.targetDeviceId === sourceId)
      );
      if (exists) return;

      // Buscar interfaz libre en cada dispositivo
      const srcIface = source.interfaces.find(
        i => !i.connectedLinkId
      );
      const tgtIface = target.interfaces.find(
        i => !i.connectedLinkId
      );
      if (!srcIface || !tgtIface) {
        console.warn('No hay interfaces libres en uno de los dispositivos');
        return;
      }

      const linkId = uuidv4();
      const link: Link = {
        id: linkId,
        sourceDeviceId: sourceId,
        sourceInterfaceId: srcIface.id,
        targetDeviceId: targetId,
        targetInterfaceId: tgtIface.id,
        status: 'up',
        latency: 1,
        packetLoss: 0,
        bandwidth: 100,
      };

      // Actualizar interfaces con el linkId
      const updatedDevices = devices.map(d => {
        if (d.id === sourceId) {
          return {
            ...d,
            interfaces: d.interfaces.map(i =>
              i.id === srcIface.id ? { ...i, connectedLinkId: linkId } : i
            ),
          };
        }
        if (d.id === targetId) {
          return {
            ...d,
            interfaces: d.interfaces.map(i =>
              i.id === tgtIface.id ? { ...i, connectedLinkId: linkId } : i
            ),
          };
        }
        return d;
      });

      set({ devices: updatedDevices, links: [...links, link] });
    },

    removeLink: (id) => {
      const { devices, links } = get();
      const link = links.find(l => l.id === id);
      if (!link) return;

      // Liberar interfaces
      const updatedDevices = devices.map(d => ({
        ...d,
        interfaces: d.interfaces.map(i =>
          i.connectedLinkId === id ? { ...i, connectedLinkId: undefined } : i
        ),
      }));

      set({
        devices: updatedDevices,
        links: links.filter(l => l.id !== id),
        selectedLinkId: null,
      });
    },

    toggleLinkStatus: (id) => {
      const { links } = get();
      const updated = networkEngine.toggleLink(links.find(l => l.id === id)!, links);
      set({ links: updated });
    },

    toggleDeviceStatus: (id) => {
      const { devices } = get();
      const updated = networkEngine.toggleDevice(devices.find(d => d.id === id)!, devices);
      set({ devices: updated });
    },

    // ── Selección ─────────────────────────────────────────
    selectDevice: (id) => set({ selectedDeviceId: id, selectedLinkId: null }),
    selectLink:   (id) => set({ selectedLinkId: id, selectedDeviceId: null }),
    setTool:      (tool) => set({ activeTool: tool, cableSource: null }),
    setCableSource:(id) => set({ cableSource: id }),

    // ── Simulación ────────────────────────────────────────
    sendPing: (sourceId, destIp) => {
      const { devices, links } = get();
      const animations = networkEngine.ping(sourceId, destIp, devices, links);
      if (animations.length > 0) {
        set(s => ({ packets: [...s.packets, ...animations] }));
      }
    },

    updateAnimations: (now) => {
      set(s => {
        const updated = s.packets
          .map(p => ({
            ...p,
            progress: Math.min(1, (now - p.startTime) / p.duration),
          }))
          .filter(p => p.progress < 1);
        return { packets: updated };
      });
    },

    clearAnimations: () => set({ packets: [] }),

    // ── Rutas ─────────────────────────────────────────────
    addRoute: (deviceId, route) => {
      set(s => ({
        devices: s.devices.map(d =>
          d.id === deviceId
            ? { ...d, routingTable: [...(d.routingTable ?? []), route] }
            : d
        ),
      }));
    },

    removeRoute: (deviceId, routeIdx) => {
      set(s => ({
        devices: s.devices.map(d =>
          d.id === deviceId
            ? { ...d, routingTable: (d.routingTable ?? []).filter((_, i) => i !== routeIdx) }
            : d
        ),
      }));
    },

    // ── Log ───────────────────────────────────────────────
    addLog: (entry) => set(s => ({ logs: [entry, ...s.logs].slice(0, 200) })),
    clearLogs: () => set({ logs: [] }),

    // ── Topología ─────────────────────────────────────────
    saveTopology: (name) => {
      const { devices, links } = get();
      const topology: Topology = {
        version: '1.0',
        name,
        createdAt: new Date().toISOString(),
        devices,
        links,
      };
      return JSON.stringify(topology, null, 2);
    },

    loadTopology: (json) => {
      try {
        const topology: Topology = JSON.parse(json);
        set({
          devices: topology.devices,
          links: topology.links,
          packets: [],
          logs: [],
          selectedDeviceId: null,
          selectedLinkId: null,
        });
      } catch (e) {
        console.error('Error loading topology:', e);
      }
    },

    loadExample: () => {
      // Topología de ejemplo: PC1 --- Switch --- Router --- PC2
      const sw = createDevice('switch', { x: 400, y: 300 });
      const router = createDevice('router', { x: 650, y: 300 });
      const pc1 = createDevice('pc', { x: 150, y: 300 });
      const pc2 = createDevice('pc', { x: 900, y: 180 });
      const pc3 = createDevice('pc', { x: 900, y: 420 });

      // Configurar IPs
      pc1.interfaces[0].ipAddress = '192.168.1.10';
      pc1.defaultGateway = '192.168.1.1';

      pc2.interfaces[0].ipAddress = '192.168.2.10';
      pc2.defaultGateway = '192.168.2.1';

      pc3.interfaces[0].ipAddress = '192.168.2.20';
      pc3.defaultGateway = '192.168.2.1';

      router.interfaces[0].ipAddress = '192.168.1.1';
      router.interfaces[1].ipAddress = '192.168.2.1';

      router.routingTable = [
        ...buildConnectedRoutes(router),
      ];

      deviceCounter = 5;
      set({
        devices: [pc1, sw, router, pc2, pc3],
        links: [],
        packets: [],
        logs: [],
        selectedDeviceId: null,
        selectedLinkId: null,
      });

      // Conectar con addLink
      const store = get();
      store.addLink(pc1.id, sw.id);
      store.addLink(sw.id, router.id);
      store.addLink(router.id, pc2.id);
      store.addLink(router.id, pc3.id);
    },

    clearAll: () => {
      deviceCounter = 0;
      set({
        devices: [],
        links: [],
        packets: [],
        logs: [],
        selectedDeviceId: null,
        selectedLinkId: null,
        cableSource: null,
        activeTool: 'select',
      });
    },
  };
});
