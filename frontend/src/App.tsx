// ============================================================
//  App.tsx  —  Layout principal, atajos de teclado, tema e idioma
// ============================================================

import React, { useEffect } from 'react';
import { NetworkCanvas } from '@/components/canvas/NetworkCanvas';
import { LeftPanel } from '@/components/panels/LeftPanel';
import { RightPanel } from '@/components/panels/RightPanel';
import { LogPanel } from '@/components/panels/LogPanel';
import { Toolbar } from '@/components/ui/Toolbar';
import { useStore } from '@/engine/store';
import { useT } from '@/hooks';

const Toast: React.FC = () => {
  const t = useT();
  const toast = useStore(s => s.toast);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => useStore.setState(s => (s.toast?.id === toast.id ? { toast: null } : {})), 3200);
    return () => clearTimeout(id);
  }, [toast]);
  if (!toast) return null;
  return <div className={`toast ${toast.level}`} role="status">{t(toast.key, toast.params)}</div>;
};

const App: React.FC = () => {
  const theme = useStore(s => s.theme);
  const lang = useStore(s => s.lang);
  const drawer = useStore(s => s.drawer);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = lang === 'es' ? 'Packet Stones — Simulador de redes' : 'Packet Stones — Network simulator';
  }, [lang]);

  // Atajos: V / C / X herramientas, Supr borra la selección, Esc cancela
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, select, textarea, [contenteditable="true"]') || e.ctrlKey || e.metaKey || e.altKey) return;
      const st = useStore.getState();
      const k = e.key.toLowerCase();
      if (k === 'v') st.setTool('select');
      else if (k === 'c') st.setTool('cable');
      else if (k === 'x') st.setTool('delete');
      else if (k === 'delete' || k === 'backspace') { e.preventDefault(); st.deleteSelection(); }
      else if (k === 'escape') {
        if (st.cableSource) st.setCableSource(null);
        else if (st.activeTool !== 'select') st.setTool('select');
        else { st.selectDevice(null); st.setDrawer(null); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="main">
        <LeftPanel />
        <NetworkCanvas />
        <RightPanel />
        <div className={`scrim ${drawer ? 'show' : ''}`} onClick={() => useStore.getState().setDrawer(null)} />
      </div>
      <LogPanel />
      <Toast />
    </div>
  );
};

export default App;
