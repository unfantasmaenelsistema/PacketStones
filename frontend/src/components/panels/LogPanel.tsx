// ============================================================
//  components/panels/LogPanel.tsx
//  Log de simulación: cada mensaje aparece cuando el paquete llega
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '@/engine/store';
import { LogLevel } from '@/types/network';
import { useT } from '@/hooks';

const ICON: Record<LogLevel, string> = { info: '→', success: '✓', warning: '⚠', error: '✗' };
const LEVELS: Array<LogLevel | 'all'> = ['all', 'info', 'success', 'warning', 'error'];

export const LogPanel: React.FC = () => {
  const t = useT();
  const logs = useStore(s => s.logs);
  const { clearLogs } = useStore.getState();
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState<LogLevel | 'all'>('all');
  const [auto, setAuto] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  const shown = filter === 'all' ? logs : logs.filter(l => l.level === filter);

  useEffect(() => {
    const el = bodyRef.current;
    if (auto && el) el.scrollTop = el.scrollHeight;
  }, [shown.length, auto, collapsed]);

  const time = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour12: false });

  return (
    <section className="log" style={{ height: collapsed ? 37 : 'clamp(130px, 24vh, 230px)' }} aria-label={t('log.title')}>
      <div className="log-head">
        <h3>📟 {t('log.title')}</h3>
        <span className="log-count">{t('log.entries', { n: logs.length })}</span>
        <div className="log-filters">
          {LEVELS.map(f => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? t('log.all') : `${ICON[f]} ${t(`log.${f}`)}`}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <button className={`tb-btn icon ${auto ? 'active' : ''}`} style={{ height: 26, width: 26 }} onClick={() => setAuto(v => !v)} title={t('log.autoscroll')} aria-label={t('log.autoscroll')}>⇣</button>
        <button className="tb-btn icon" style={{ height: 26, width: 26 }} onClick={clearLogs} title={t('log.clear')} aria-label={t('log.clear')}>🗑️</button>
        <button className="tb-btn icon" style={{ height: 26, width: 26 }} onClick={() => setCollapsed(v => !v)} title={t('log.collapse')} aria-label={t('log.collapse')}>
          {collapsed ? '▲' : '▼'}
        </button>
      </div>
      {!collapsed && (
        <div className="log-body" ref={bodyRef} aria-live="polite">
          {shown.length === 0 && <div className="log-empty">{t('log.empty')}</div>}
          {shown.map(e => (
            <div key={e.id} className={`log-line ${e.level}`}>
              <span className="ts">{time(e.timestamp)}</span>
              <span className="msg">{ICON[e.level]}</span>
              <span className="src">{e.source}</span>
              <span className="msg">{t(e.key, e.params)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
