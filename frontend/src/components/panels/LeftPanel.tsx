// ============================================================
//  components/panels/LeftPanel.tsx
//  Herramientas, dispositivos, prácticas de ejemplo y leyenda
// ============================================================

import React from 'react';
import { useStore } from '@/engine/store';
import { DeviceType, Tool } from '@/types/network';
import { ExampleId } from '@/engine/factory';
import { asset, BRAND_URL, useT } from '@/hooks';
import { canvasApi } from '@/components/canvas/NetworkCanvas';

const TOOLS: Array<{ id: Tool; icon: string; key: string }> = [
  { id: 'select', icon: '🖱️', key: 'tool.select' },
  { id: 'cable', icon: '🔌', key: 'tool.cable' },
  { id: 'delete', icon: '🗑️', key: 'tool.delete' },
];

const DEVICES: Array<{ type: DeviceType; icon: string }> = [
  { type: 'router', icon: '🔀' },
  { type: 'switch', icon: '🔁' },
  { type: 'pc', icon: '💻' },
];

const EXAMPLES: Array<{ id: ExampleId; icon: string }> = [
  { id: 'lan', icon: '🏠' },
  { id: 'static', icon: '🛣️' },
  { id: 'rip', icon: '🔺' },
  { id: 'dhcp', icon: '🎟️' },
];

export const LeftPanel: React.FC = () => {
  const t = useT();
  const activeTool = useStore(s => s.activeTool);
  const drawer = useStore(s => s.drawer);
  const { setTool, addDevice, loadExample, clearAll, setDrawer } = useStore.getState();

  const add = (type: DeviceType) => {
    const c = canvasApi.center();
    addDevice(type, { x: c.x + (Math.random() - 0.5) * 160, y: c.y + (Math.random() - 0.5) * 120 });
    setDrawer(null);
  };

  return (
    <aside className={`side left ${drawer === 'left' ? 'open' : ''}`}>
      <a className="brand-block" href={BRAND_URL} target="_blank" rel="noopener noreferrer">
        <img src={asset('logo.png')} alt="Un fantasma en el sistema" />
        <div>
          <b>Packet Stones</b>
          <small>unfantasmaenelsistema.com</small>
        </div>
      </a>

      <section className="section">
        <div className="sec-title">{t('left.tools')}</div>
        <div className="list">
          {TOOLS.map(tool => (
            <button
              key={tool.id}
              className={`item ${activeTool === tool.id ? 'active' : ''}`}
              onClick={() => { setTool(tool.id); setDrawer(null); }}
              title={t(`${tool.key}.tip`)}
            >
              <span className="ic">{tool.icon}</span>
              <span className="grow">{t(tool.key)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="sec-title">{t('left.devices')}</div>
        <div className="list">
          {DEVICES.map(d => (
            <button
              key={d.type}
              className="item draggable"
              draggable
              onDragStart={e => { e.dataTransfer.setData('text/x-device', d.type); e.dataTransfer.effectAllowed = 'copy'; }}
              onClick={() => add(d.type)}
              title={t('left.addTip')}
            >
              <span className="ic">{d.icon}</span>
              <span className="grow">
                <span className="name">{t(`dev.${d.type}`)}</span>
                <span className="desc">{t(`dev.${d.type}.desc`)}</span>
              </span>
              <span className="plus">+</span>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="sec-title">{t('left.examples')}</div>
        <div className="list">
          {EXAMPLES.map(ex => (
            <button key={ex.id} className="item" onClick={() => loadExample(ex.id)} title={t(`ex.${ex.id}.desc`)}>
              <span className="ic">{ex.icon}</span>
              <span className="grow">
                <span className="name">{t(`ex.${ex.id}`)}</span>
                <span className="desc">{t(`ex.${ex.id}.desc`)}</span>
              </span>
            </button>
          ))}
          <button className="item danger" onClick={() => { if (window.confirm(t('left.confirmClear'))) clearAll(); }}>
            <span className="ic">🧨</span>
            <span className="grow">{t('left.clearAll')}</span>
          </button>
        </div>
      </section>

      <section className="section">
        <div className="sec-title">{t('left.legend')}</div>
        <div className="legend">
          <div><i style={{ background: 'var(--pk-req)' }} />{t('legend.req')}</div>
          <div><i style={{ background: 'var(--pk-rep)' }} />{t('legend.rep')}</div>
          <div><i style={{ background: 'var(--pk-arp)' }} />{t('legend.arp')}</div>
          <div><i style={{ background: 'var(--pk-dhcp)' }} />{t('legend.dhcp')}</div>
          <div><i style={{ background: 'var(--pk-lost)' }} />{t('legend.lost')}</div>
          <div><i style={{ background: 'var(--ok)' }} />{t('legend.on')}</div>
          <div><i style={{ background: 'var(--bad)' }} />{t('legend.off')}</div>
        </div>
      </section>
    </aside>
  );
};
