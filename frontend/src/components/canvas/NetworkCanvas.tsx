// ============================================================
//  components/canvas/NetworkCanvas.tsx
//  Canvas interactivo donde se construye y visualiza la red
// ============================================================

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useStore } from '@/engine/store';
import { Device, Link, PacketAnimation, Position } from '@/types/network';

// ── Constantes de diseño ──────────────────────────────────
const DEVICE_RADIUS = 32;
const DEVICE_COLORS: Record<string, { bg: string; border: string; icon: string }> = {
  router: { bg: '#1e3a5f', border: '#3b82f6', icon: '🔀' },
  switch: { bg: '#1e3a1e', border: '#22c55e', icon: '🔁' },
  pc:     { bg: '#3a1e3a', border: '#a855f7', icon: '💻' },
};

const STATUS_COLOR = {
  up:   '#22c55e',
  down: '#ef4444',
};

// ── Helpers de geometría ──────────────────────────────────
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// ── Dibujar dispositivo ────────────────────────────────────
function drawDevice(
  ctx: CanvasRenderingContext2D,
  device: Device,
  selected: boolean,
  highlighted: boolean
) {
  const { x, y } = device.position;
  const colors = DEVICE_COLORS[device.type];

  // Sombra / halo selección
  if (selected) {
    ctx.shadowColor = colors.border;
    ctx.shadowBlur = 20;
  }

  // Círculo principal
  ctx.beginPath();
  ctx.arc(x, y, DEVICE_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = device.status === 'down' ? '#1f1f1f' : colors.bg;
  ctx.fill();
  ctx.strokeStyle = selected ? '#f59e0b' : colors.border;
  ctx.lineWidth = selected ? 3 : 2;
  ctx.stroke();

  ctx.shadowBlur = 0;

  // Indicador de estado (punto en la esquina)
  ctx.beginPath();
  ctx.arc(x + 22, y - 22, 7, 0, Math.PI * 2);
  ctx.fillStyle = STATUS_COLOR[device.status];
  ctx.fill();
  ctx.strokeStyle = '#0d0d12';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Emoji/icono
  ctx.font = '20px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = device.status === 'down' ? 0.3 : 1;
  ctx.fillText(colors.icon, x, y);
  ctx.globalAlpha = 1;

  // Nombre
  ctx.font = 'bold 11px "DM Sans", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = device.status === 'down' ? '#555' : '#e8e8f0';
  ctx.fillText(device.hostname, x, y + DEVICE_RADIUS + 6);

  // IP (primera interfaz)
  const ip = device.interfaces[0]?.ipAddress;
  if (ip) {
    ctx.font = '9px monospace';
    ctx.fillStyle = '#9090a8';
    ctx.fillText(ip, x, y + DEVICE_RADIUS + 20);
  }
}

// ── Dibujar enlace ─────────────────────────────────────────
function drawLink(
  ctx: CanvasRenderingContext2D,
  link: Link,
  devices: Device[],
  selected: boolean
) {
  const src = devices.find(d => d.id === link.sourceDeviceId);
  const tgt = devices.find(d => d.id === link.targetDeviceId);
  if (!src || !tgt) return;

  const color = link.status === 'down' ? '#ef4444' : selected ? '#f59e0b' : '#4a5568';

  ctx.beginPath();
  ctx.moveTo(src.position.x, src.position.y);
  ctx.lineTo(tgt.position.x, tgt.position.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? 3 : link.status === 'down' ? 1.5 : 2;
  ctx.setLineDash(link.status === 'down' ? [6, 4] : []);
  ctx.stroke();
  ctx.setLineDash([]);

  // Etiqueta latencia en el centro
  if (link.latency > 1 || link.packetLoss > 0) {
    const mx = (src.position.x + tgt.position.x) / 2;
    const my = (src.position.y + tgt.position.y) / 2;
    ctx.font = '9px monospace';
    ctx.fillStyle = '#6b7280';
    ctx.textAlign = 'center';
    ctx.fillText(`${link.latency}ms${link.packetLoss > 0 ? ` | ${link.packetLoss}%loss` : ''}`, mx, my - 6);
  }
}

// ── Dibujar paquete animado ────────────────────────────────
function drawPacket(
  ctx: CanvasRenderingContext2D,
  anim: PacketAnimation,
  devices: Device[]
) {
  const src = devices.find(d => d.id === anim.fromDeviceId);
  const tgt = devices.find(d => d.id === anim.toDeviceId);
  if (!src || !tgt) return;

  const x = lerp(src.position.x, tgt.position.x, anim.progress);
  const y = lerp(src.position.y, tgt.position.y, anim.progress);

  // Halo
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fillStyle = anim.color + '33';
  ctx.fill();

  // Círculo del paquete
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fillStyle = anim.dropped ? '#ef4444' : anim.color;
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ── Componente principal ───────────────────────────────────
export const NetworkCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const dragRef = useRef<{ deviceId: string; offsetX: number; offsetY: number } | null>(null);

  const {
    devices, links, packets,
    selectedDeviceId, selectedLinkId,
    activeTool, cableSource,
    addDevice, moveDevice, removeDevice, removeLink,
    selectDevice, selectLink,
    addLink, setCableSource, setTool,
    updateAnimations,
  } = useStore();

  // ── Función de dibujado ──────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Limpiar
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Fondo con grid
    ctx.fillStyle = '#0d0d12';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawGrid(ctx, canvas.width, canvas.height);

    // Links
    for (const link of links) {
      drawLink(ctx, link, devices, link.id === selectedLinkId);
    }

    // Línea provisional del cable en curso
    if (activeTool === 'cable' && cableSource) {
      const src = devices.find(d => d.id === cableSource);
      if (src) {
        ctx.beginPath();
        ctx.moveTo(src.position.x, src.position.y);
        // TODO: seguir el cursor (se actualiza en mousemove)
      }
    }

    // Dispositivos
    for (const device of devices) {
      drawDevice(ctx, device, device.id === selectedDeviceId, false);
    }

    // Paquetes animados
    updateAnimations(Date.now());
    for (const anim of packets) {
      drawPacket(ctx, anim, devices);
    }
  }, [devices, links, packets, selectedDeviceId, selectedLinkId, activeTool, cableSource, updateAnimations]);

  // ── Loop de animación ────────────────────────────────────
  useEffect(() => {
    const loop = () => {
      draw();
      animFrameRef.current = requestAnimationFrame(loop);
    };
    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [draw]);

  // ── Resize ───────────────────────────────────────────────
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // ── Obtener posición en canvas ────────────────────────────
  const getCanvasPos = (e: React.MouseEvent<HTMLCanvasElement>): Position => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // ── Hit test: ¿qué dispositivo está en (x,y)? ────────────
  const deviceAtPos = (pos: Position): Device | null => {
    for (let i = devices.length - 1; i >= 0; i--) {
      const d = devices[i];
      const dx = d.position.x - pos.x;
      const dy = d.position.y - pos.y;
      if (Math.sqrt(dx * dx + dy * dy) <= DEVICE_RADIUS + 4) return d;
    }
    return null;
  };

  // ── Hit test: ¿qué link está cerca de (x,y)? ─────────────
  const linkAtPos = (pos: Position): Link | null => {
    for (const link of links) {
      const src = devices.find(d => d.id === link.sourceDeviceId);
      const tgt = devices.find(d => d.id === link.targetDeviceId);
      if (!src || !tgt) continue;
      // Distancia punto a segmento
      const dist = pointToSegmentDist(pos, src.position, tgt.position);
      if (dist < 8) return link;
    }
    return null;
  };

  // ── Eventos del mouse ─────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasPos(e);
    const device = deviceAtPos(pos);
    const link = !device ? linkAtPos(pos) : null;

    if (activeTool === 'select') {
      if (device) {
        selectDevice(device.id);
        dragRef.current = {
          deviceId: device.id,
          offsetX: pos.x - device.position.x,
          offsetY: pos.y - device.position.y,
        };
      } else if (link) {
        selectLink(link.id);
      } else {
        selectDevice(null);
        selectLink(null);
      }
    }

    if (activeTool === 'cable') {
      if (device) {
        if (!cableSource) {
          setCableSource(device.id);
        } else {
          addLink(cableSource, device.id);
          setCableSource(null);
          setTool('select');
        }
      }
    }

    if (activeTool === 'delete') {
      if (device) removeDevice(device.id);
      else if (link) removeLink(link.id);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTool === 'select' && dragRef.current) {
      const pos = getCanvasPos(e);
      moveDevice(dragRef.current.deviceId, {
        x: pos.x - dragRef.current.offsetX,
        y: pos.y - dragRef.current.offsetY,
      });
    }
  };

  const handleMouseUp = () => {
    dragRef.current = null;
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTool !== 'select') return;
    const pos = getCanvasPos(e);
    if (!deviceAtPos(pos)) {
      // No hay dispositivo → abrir menú contextual de añadir
      // (se maneja en el panel lateral, esto es sólo para drag)
    }
  };

  const getCursor = () => {
    if (activeTool === 'cable') return 'crosshair';
    if (activeTool === 'delete') return 'pointer';
    return dragRef.current ? 'grabbing' : 'default';
  };

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', cursor: getCursor(), display: 'block' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
    />
  );
};

// ── Grid de fondo ──────────────────────────────────────────
function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const size = 40;
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += size) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += size) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
}

// ── Distancia punto a segmento ────────────────────────────
function pointToSegmentDist(p: Position, a: Position, b: Position): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
