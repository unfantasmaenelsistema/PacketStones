// ============================================================
//  App.tsx  —  Layout principal de la aplicación
// ============================================================

import React from 'react';
import { NetworkCanvas } from '@/components/canvas/NetworkCanvas';
import { LeftPanel }     from '@/components/panels/LeftPanel';
import { RightPanel }    from '@/components/panels/RightPanel';
import { LogPanel }      from '@/components/panels/LogPanel';
import { Toolbar }       from '@/components/ui/Toolbar';

const App: React.FC = () => {
  return (
    <div style={styles.root}>
      {/* Barra superior */}
      <Toolbar />

      {/* Área principal: left | canvas | right */}
      <div style={styles.main}>
        <LeftPanel />

        {/* Canvas central */}
        <div style={styles.canvasArea}>
          <NetworkCanvas />
        </div>

        <RightPanel />
      </div>

      {/* Panel de log inferior */}
      <LogPanel />
    </div>
  );
};

export default App;

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    width: '100vw',
    background: '#0d0d12',
    color: '#e8e8f0',
    fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
    overflow: 'hidden',
  },
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  canvasArea: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
};
