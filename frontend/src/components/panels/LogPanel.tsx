// ============================================================
//  components/panels/LogPanel.tsx
//  Panel inferior con log de simulación en tiempo real
// ============================================================

import React, { useRef, useEffect, useState } from 'react';
import { useStore } from '@/engine/store';
import { LogEntry } from '@/types/network';

const LEVEL_STYLES: Record<LogEntry['level'], React.CSSProperties> = {
  info:    { color: '#9090a8' },
  success: { color: '#22c55e' },
  warning: { color: '#f59e0b' },
  error:   { color: '#f87171' },
};

const LEVEL_ICONS: Record<LogEntry['level'], string> = {
  info:    '→',
  success: '✓',
  warning: '⚠',
  error:   '✗',
};

export const LogPanel: React.FC = () => {
  const { logs, clearLogs } = useStore();
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState<LogEntry['level'] | 'all'>('all');
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll al último log
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const filtered = filter === 'all' ? logs : logs.filter(l => l.level === filter);

  return (
    <div style={{ ...styles.panel, height: collapsed ? 38 : 160 }}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>📟 LOG DE SIMULACIÓN</span>
        <span style={styles.count}>{logs.length} entradas</span>

        <div style={styles.filters}>
          {(['all', 'info', 'success', 'warning', 'error'] as const).map(f => (
            <button
              key={f}
              style={{ ...styles.filterBtn, ...(filter === f ? styles.filterBtnActive : {}) }}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'Todos' : f}
            </button>
          ))}
        </div>

        <div style={styles.actions}>
          <button
            style={styles.iconBtn}
            onClick={() => setAutoScroll(v => !v)}
            title={autoScroll ? 'Desactivar auto-scroll' : 'Activar auto-scroll'}
          >
            {autoScroll ? '📌' : '📍'}
          </button>
          <button style={styles.iconBtn} onClick={clearLogs} title="Limpiar log">🗑️</button>
          <button style={styles.iconBtn} onClick={() => setCollapsed(v => !v)}>
            {collapsed ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Log entries */}
      {!collapsed && (
        <div style={styles.body}>
          {filtered.length === 0 && (
            <div style={styles.empty}>Sin actividad. Selecciona un PC y envía un ping.</div>
          )}
          {[...filtered].reverse().map(entry => (
            <LogLine key={entry.id} entry={entry} />
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
};

const LogLine: React.FC<{ entry: LogEntry }> = ({ entry }) => {
  const time = new Date(entry.timestamp).toLocaleTimeString('es-ES', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  return (
    <div style={styles.logLine}>
      <span style={styles.logTime}>{time}</span>
      <span style={{ ...styles.logIcon, ...LEVEL_STYLES[entry.level] }}>
        {LEVEL_ICONS[entry.level]}
      </span>
      <span style={{ ...styles.logSource }}>[{entry.source}]</span>
      <span style={{ ...styles.logMsg, ...LEVEL_STYLES[entry.level] }}>{entry.message}</span>
    </div>
  );
};

// ── Estilos ────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: '#0a0c10',
    borderTop: '1px solid #1e2a45',
    display: 'flex',
    flexDirection: 'column',
    transition: 'height 0.2s',
    overflow: 'hidden',
    flexShrink: 0,
  },
  header: {
    padding: '6px 14px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    borderBottom: '1px solid #1e2a45',
    flexShrink: 0,
    background: '#0d0d18',
  },
  headerTitle: {
    fontSize: 11, fontWeight: 700,
    letterSpacing: '1.5px', color: '#585870',
    textTransform: 'uppercase' as const,
  },
  count: {
    fontSize: 10, color: '#3d3d6b',
    padding: '1px 6px',
    background: 'rgba(255,255,255,0.03)',
    borderRadius: 4,
  },
  filters: { display: 'flex', gap: 4, marginLeft: 'auto' },
  filterBtn: {
    padding: '2px 8px', fontSize: 10,
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: 4, cursor: 'pointer',
    color: '#585870',
  },
  filterBtnActive: {
    borderColor: '#2e2e3a',
    background: 'rgba(255,255,255,0.05)',
    color: '#9090a8',
  },
  actions: { display: 'flex', gap: 4, marginLeft: 8 },
  iconBtn: {
    background: 'none', border: 'none',
    cursor: 'pointer', fontSize: 13,
    padding: '2px 4px',
  },
  body: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '4px 14px',
    fontFamily: 'monospace',
  },
  empty: { fontSize: 11, color: '#3d3d6b', padding: '8px 0' },
  logLine: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    padding: '2px 0',
    borderBottom: '1px solid rgba(255,255,255,0.02)',
    fontSize: 11,
  },
  logTime: { color: '#3d3d6b', flexShrink: 0, fontSize: 10 },
  logIcon: { flexShrink: 0, width: 12 },
  logSource: { color: '#585870', flexShrink: 0, minWidth: 80 },
  logMsg: { color: '#9090a8', wordBreak: 'break-word' as const },
};
