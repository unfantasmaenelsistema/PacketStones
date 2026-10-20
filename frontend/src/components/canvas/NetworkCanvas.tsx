// ============================================================
//  components/canvas/NetworkCanvas.tsx
//  Lienzo interactivo: construir la red y ver los paquetes viajar.
//  Zoom con rueda o pellizco, desplazamiento arrastrando el fondo.
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '@/engine/store';
import { Device, DeviceType, Link, PacketAnimation, PacketKind, Position } from '@/types/network';
import { shortIfName } from '@/engine/factory';
import { hasValidAddress } from '@/engine/algorithms/NetworkUtils';
import { useT } from '@/hooks';

const R = 30;                    // radio del icono de equipo (unidades de mundo)
const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;
const ICON: Record<DeviceType, string> = { router: '🔀', switch: '🔁', pc: '💻' };

interface View { x: number; y: number; scale: number }

type Palette = Record<string, string>;
const VARS = [
  'bg', 'grid', 'cable', 'label', 'label-2', 'ok', 'bad', 'warn', 'accent', 'panel',
  'dev-router-bg', 'dev-router', 'dev-switch-bg', 'dev-switch', 'dev-pc-bg', 'dev-pc', 'dev-off-bg',
  'pk-req', 'pk-rep', 'pk-arp', 'pk-dhcp', 'pk-lost', 'pk-stroke',
];
function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const p: Palette = {};
  for (const v of VARS) p[v] = cs.getPropertyValue(`--${v}`).trim() || '#888';
  return p;
}

const PK_VAR: Record<PacketKind, string> = {
  icmp_request: 'pk-req', icmp_reply: 'pk-rep', arp_request: 'pk-arp', arp_reply: 'pk-arp', dhcp: 'pk-dhcp',
};

/** API mínima para que otros componentes sepan dónde está el centro visible. */
export const canvasApi = {
  center: (): Position => ({ x: 400, y: 260 }),
};

export const NetworkCanvas: React.FC = () => {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ x: 0, y: 0, scale: 1 });
  const size = useRef({ w: 800, h: 500, dpr: 1 });
  const palette = useRef<Palette>({});
  const pointer = useRef<Position | null>(null);           // última posición en mundo (vista previa del cable)
  const pointers = useRef(new Map<number, Position>());     // punteros activos en pantalla (pellizco)
  const gesture = useRef<
    | { kind: 'drag'; id: string; dx: number; dy: number; moved: boolean }
    | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
    | { kind: 'pinch'; dist: number; scale: number; cx: number; cy: number; vx: number; vy: number }
    | null
  >(null);

  const activeTool = useStore(s => s.activeTool);
  const cableSource = useStore(s => s.cableSource);
  const theme = useStore(s => s.theme);
  const fitNonce = useStore(s => s.fitNonce);
  const [grabbing, setGrabbing] = useState(false);

  // ── Coordenadas ──────────────────────────────────────────
  const toWorld = (sx: number, sy: number): Position => {
    const v = view.current;
    return { x: (sx - v.x) / v.scale, y: (sy - v.y) / v.scale };
  };
  const screenPos = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  canvasApi.center = () => toWorld(size.current.w / 2, size.current.h / 2);

  const zoomAt = (sx: number, sy: number, factor: number) => {
    const v = view.current;
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
    const k = scale / v.scale;
    view.current = { scale, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k };
  };

  const fit = () => {
    const { devices } = useStore.getState();
    const { w, h } = size.current;
    if (!devices.length) { view.current = { x: 0, y: 0, scale: 1 }; return; }
    const xs = devices.map(d => d.position.x), ys = devices.map(d => d.position.y);
    const minX = Math.min(...xs) - R - 40, maxX = Math.max(...xs) + R + 40;
    const minY = Math.min(...ys) - R - 30, maxY = Math.max(...ys) + R + 50;
    const scale = Math.max(MIN_SCALE, Math.min(1.3, Math.min(w / (maxX - minX), h / (maxY - minY))));
    view.current = { scale, x: w / 2 - ((minX + maxX) / 2) * scale, y: h / 2 - ((minY + maxY) / 2) * scale };
  };

  // ── Tamaño (ResizeObserver) y tema ───────────────────────
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size.current = { w: r.width, h: r.height, dpr };
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    palette.current = readPalette();
  }, [theme]);

  // Encajar al cargar una topología (con un fotograma de margen para tener tamaño real)
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(fit));
    return () => cancelAnimationFrame(id);
  }, [fitNonce]);

  // ── Bucle de dibujo ──────────────────────────────────────
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const now = performance.now();
      const st = useStore.getState();
      st.tick(now);
      draw(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const draw = (now: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const P = palette.current;
    const { w, h, dpr } = size.current;
    const v = view.current;
    const st = useStore.getState();
    const byId = new Map(st.devices.map(d => [d.id, d]));

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = P.bg;
    ctx.fillRect(0, 0, w, h);

    // Rejilla en el espacio del mundo
    const step = 40 * v.scale;
    if (step > 8) {
      ctx.strokeStyle = P.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = ((v.x % step) + step) % step; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = ((v.y % step) + step) % step; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
    }

    ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, dpr * v.x, dpr * v.y);

    for (const link of st.links) drawLink(ctx, P, link, byId, link.id === st.selectedLinkId);

    // Vista previa del cable
    if (st.activeTool === 'cable' && st.cableSource && pointer.current) {
      const src = byId.get(st.cableSource);
      if (src) {
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = P.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(src.position.x, src.position.y);
        ctx.lineTo(pointer.current.x, pointer.current.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    for (const d of st.devices) drawDevice(ctx, P, d, d.id === st.selectedDeviceId, d.id === st.cableSource);
    for (const a of st.anims) drawPacket(ctx, P, a, byId, now);
  };

  // ── Hit testing ──────────────────────────────────────────
  const deviceAt = (p: Position): Device | null => {
    const { devices } = useStore.getState();
    for (let i = devices.length - 1; i >= 0; i--) {
      const d = devices[i];
      if (Math.hypot(d.position.x - p.x, d.position.y - p.y) <= R + 4) return d;
    }
    return null;
  };
  const linkAt = (p: Position): Link | null => {
    const { devices, links } = useStore.getState();
    const tol = 8 / view.current.scale;
    for (const l of links) {
      const a = devices.find(d => d.id === l.sourceDeviceId);
      const b = devices.find(d => d.id === l.targetDeviceId);
      if (a && b && segDist(p, a.position, b.position) < tol) return l;
    }
    return null;
  };

  // ── Punteros (ratón, lápiz y táctil) ─────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = screenPos(e);
    pointers.current.set(e.pointerId, s);
    canvasRef.current!.setPointerCapture(e.pointerId);

    if (pointers.current.size === 2) {   // pellizco
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: view.current.scale,
        cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, vx: view.current.x, vy: view.current.y,
      };
      return;
    }
    if (pointers.current.size > 2) return;

    const st = useStore.getState();
    const p = toWorld(s.x, s.y);
    pointer.current = p;
    const device = deviceAt(p);
    const link = device ? null : linkAt(p);

    if (st.activeTool === 'cable') {
      if (device) {
        if (!st.cableSource) st.setCableSource(device.id);
        else if (device.id !== st.cableSource) {
          st.addLink(st.cableSource, device.id);
          st.setCableSource(null);
        }
        return;
      }
      st.setCableSource(null);
    } else if (st.activeTool === 'delete') {
      if (device) { st.removeDevice(device.id); return; }
      if (link) { st.removeLink(link.id); return; }
    } else {
      if (device) {
        st.selectDevice(device.id);
        gesture.current = { kind: 'drag', id: device.id, dx: p.x - device.position.x, dy: p.y - device.position.y, moved: false };
        setGrabbing(true);
        return;
      }
      if (link) { st.selectLink(link.id); return; }
    }
    // Fondo: desplazar la vista (y deseleccionar si no se arrastra)
    gesture.current = { kind: 'pan', sx: s.x, sy: s.y, vx: view.current.x, vy: view.current.y, moved: false };
    setGrabbing(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = screenPos(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, s);
    pointer.current = toWorld(s.x, s.y);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, g.scale * dist / g.dist));
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const k = scale / g.scale;
      view.current = { scale, x: cx - (g.cx - g.vx) * k, y: cy - (g.cy - g.vy) * k };
    } else if (g.kind === 'drag') {
      g.moved = true;
      useStore.getState().moveDevice(g.id, { x: pointer.current.x - g.dx, y: pointer.current.y - g.dy });
    } else if (g.kind === 'pan') {
      if (Math.hypot(s.x - g.sx, s.y - g.sy) > 3) g.moved = true;
      view.current = { ...view.current, x: g.vx + (s.x - g.sx), y: g.vy + (s.y - g.sy) };
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === 'pan' && !g.moved && useStore.getState().activeTool === 'select') {
      useStore.getState().selectDevice(null);
      useStore.getState().setDrawer(null);
    }
    if (g?.kind === 'drag' && !g.moved) useStore.getState().setDrawer('right');
    if (g?.kind !== 'pinch' || pointers.current.size === 0) gesture.current = null;
    setGrabbing(false);
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const s = screenPos(e);
    zoomAt(s.x, s.y, Math.exp(-e.deltaY * 0.0015));
  };

  // Rueda sin desplazar la página
  useEffect(() => {
    const c = canvasRef.current!;
    const stop = (e: WheelEvent) => e.preventDefault();
    c.addEventListener('wheel', stop, { passive: false });
    return () => c.removeEventListener('wheel', stop);
  }, []);

  // ── Soltar un equipo arrastrado desde el panel ───────────
  const onDrop = (e: React.DragEvent) => {
    const type = e.dataTransfer.getData('text/x-device') as DeviceType;
    if (!['router', 'switch', 'pc'].includes(type)) return;
    e.preventDefault();
    const s = screenPos(e);
    useStore.getState().addDevice(type, toWorld(s.x, s.y));
  };

  const cursor = activeTool === 'cable' ? 'crosshair' : activeTool === 'delete' ? 'not-allowed' : grabbing ? 'grabbing' : 'default';

  return (
    <div ref={wrapRef} className="canvas-area" onDragOver={e => e.preventDefault()} onDrop={onDrop}>
      <canvas
        ref={canvasRef}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        aria-label="Packet Stones"
      />
      {activeTool === 'cable' && (
        <div className="canvas-hint">🔌 {cableSource ? t('cable.pick') : t('tool.cable.tip')}</div>
      )}
      {activeTool === 'delete' && <div className="canvas-hint">🗑️ {t('tool.delete.tip')}</div>}
      <div className="zoom-ctl">
        <button onClick={() => zoomAt(size.current.w / 2, size.current.h / 2, 1.2)} aria-label="Zoom +">+</button>
        <button onClick={() => zoomAt(size.current.w / 2, size.current.h / 2, 1 / 1.2)} aria-label="Zoom −">−</button>
        <button onClick={fit} title={t('top.fitTip')} aria-label={t('top.fitTip')}>⤢</button>
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════
//  Dibujo
// ════════════════════════════════════════════════════════════

function drawDevice(ctx: CanvasRenderingContext2D, P: Palette, d: Device, selected: boolean, cableSrc: boolean) {
  const { x, y } = d.position;
  const off = d.status === 'down';
  const border = P[`dev-${d.type}`];

  if (selected || cableSrc) {
    ctx.beginPath();
    ctx.arc(x, y, R + 7, 0, Math.PI * 2);
    ctx.fillStyle = cableSrc ? P.accent + '40' : P.warn + '33';
    ctx.fill();
  }

  ctx.beginPath();
  if (d.type === 'switch') roundRect(ctx, x - R - 4, y - R + 8, 2 * R + 8, 2 * R - 16, 10);
  else if (d.type === 'router') ctx.arc(x, y, R, 0, Math.PI * 2);
  else roundRect(ctx, x - R + 2, y - R + 2, 2 * R - 4, 2 * R - 4, 12);
  ctx.fillStyle = off ? P['dev-off-bg'] : P[`dev-${d.type}-bg`];
  ctx.fill();
  ctx.strokeStyle = selected ? P.warn : cableSrc ? P.accent : border;
  ctx.lineWidth = selected || cableSrc ? 3 : 2;
  ctx.stroke();

  // Estado
  ctx.beginPath();
  ctx.arc(x + R - 6, y - R + 6, 6, 0, Math.PI * 2);
  ctx.fillStyle = off ? P.bad : P.ok;
  ctx.fill();
  ctx.strokeStyle = P.bg;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.globalAlpha = off ? 0.35 : 1;
  ctx.font = '22px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ICON[d.type], x, y + 1);
  ctx.globalAlpha = 1;

  ctx.textBaseline = 'top';
  ctx.font = '600 12px "DM Sans", system-ui, sans-serif';
  ctx.fillStyle = off ? P['label-2'] : P.label;
  ctx.fillText(d.hostname, x, y + R + 6);

  if (d.type !== 'switch') {
    const ips = d.interfaces.filter(i => hasValidAddress(i));
    const txt = ips.length === 0 ? '' : d.type === 'pc' ? ips[0].ipAddress : ips.length === 1 ? ips[0].ipAddress : `${ips[0].ipAddress} +${ips.length - 1}`;
    if (txt) {
      ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillStyle = P['label-2'];
      ctx.fillText(txt, x, y + R + 21);
    }
  }
}

function drawLink(ctx: CanvasRenderingContext2D, P: Palette, link: Link, byId: Map<string, Device>, selected: boolean) {
  const a = byId.get(link.sourceDeviceId);
  const b = byId.get(link.targetDeviceId);
  if (!a || !b) return;
  const down = link.status === 'down' || a.status === 'down' || b.status === 'down';
  ctx.beginPath();
  ctx.moveTo(a.position.x, a.position.y);
  ctx.lineTo(b.position.x, b.position.y);
  ctx.strokeStyle = selected ? P.warn : link.status === 'down' ? P.bad : P.cable;
  ctx.lineWidth = selected ? 3.5 : 2;
  ctx.setLineDash(down ? [7, 5] : []);
  ctx.stroke();
  ctx.setLineDash([]);

  const dx = b.position.x - a.position.x, dy = b.position.y - a.position.y;
  const len = Math.hypot(dx, dy) || 1;
  const ia = a.interfaces.find(i => i.id === link.sourceInterfaceId);
  const ib = b.interfaces.find(i => i.id === link.targetInterfaceId);

  // Nombre de interfaz junto a cada extremo + punto de estado del puerto
  ctx.font = '9.5px "JetBrains Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const end = (dev: Device, iface: typeof ia, sign: number) => {
    if (!iface) return;
    const k = Math.min(R + 30, len / 2 - 6) / len;
    const px = dev.position.x + dx * k * sign, py = dev.position.y + dy * k * sign;
    const portUp = !down && iface.status === 'up';
    if (len > 150) {
      const nx = -dy / len, ny = dx / len;
      const label = shortIfName(iface.name);
      const lx = px + nx * 12, ly = py + ny * 12;
      const tw = ctx.measureText(label).width + 6;
      ctx.fillStyle = P.bg + 'd9';
      ctx.beginPath();
      roundRect(ctx, lx - tw / 2, ly - 7, tw, 14, 4);
      ctx.fill();
      ctx.fillStyle = P['label-2'];
      ctx.fillText(label, lx, ly);
    }
    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = portUp ? P.ok : P.bad;
    ctx.fill();
  };
  end(a, ia, 1);
  end(b, ib, -1);

  if (link.latency > 1 || link.packetLoss > 0) {
    const mx = (a.position.x + b.position.x) / 2, my = (a.position.y + b.position.y) / 2;
    const label = `${link.latency}ms${link.packetLoss > 0 ? ` · ${link.packetLoss}%` : ''}`;
    ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace';
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = P.panel;
    ctx.beginPath();
    roundRect(ctx, mx - tw / 2, my - 8, tw, 16, 6);
    ctx.fill();
    ctx.fillStyle = link.packetLoss > 0 ? P.warn : P['label-2'];
    ctx.fillText(label, mx, my);
  }
}

function drawPacket(ctx: CanvasRenderingContext2D, P: Palette, a: PacketAnimation, byId: Map<string, Device>, now: number) {
  if (now < a.startTime) return;
  const src = byId.get(a.fromDeviceId);
  const dst = byId.get(a.toDeviceId);
  if (!src || !dst) return;
  let p = Math.min(1, (now - a.startTime) / a.duration);
  const lost = a.dropAt !== undefined && p >= a.dropAt;
  if (a.dropAt !== undefined) p = Math.min(p, a.dropAt);
  const x = src.position.x + (dst.position.x - src.position.x) * p;
  const y = src.position.y + (dst.position.y - src.position.y) * p;

  if (lost) {
    const fade = 1 - (Math.min(1, (now - a.startTime) / a.duration) - a.dropAt!) / (1 - a.dropAt!);
    ctx.globalAlpha = Math.max(0, fade);
    ctx.strokeStyle = P['pk-lost'];
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7);
    ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7);
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }

  const color = P[PK_VAR[a.kind]];
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, Math.PI * 2);
  ctx.fillStyle = color + '40';
  ctx.fill();
  ctx.beginPath();
  if (a.kind === 'arp_request' || a.kind === 'arp_reply') {
    ctx.rect(x - 6, y - 6, 12, 12);       // ARP: cuadrado
  } else if (a.kind === 'dhcp') {
    ctx.moveTo(x, y - 8); ctx.lineTo(x + 8, y); ctx.lineTo(x, y + 8); ctx.lineTo(x - 8, y); ctx.closePath();  // DHCP: rombo
  } else {
    ctx.arc(x, y, 6.5, 0, Math.PI * 2);  // ICMP: círculo
  }
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = P['pk-stroke'];
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function segDist(p: Position, a: Position, b: Position): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (!l2) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
