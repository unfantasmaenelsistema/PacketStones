// ============================================================
//  components/ui/Toolbar.tsx
//  Barra superior: estado de la red, velocidad, archivo, idioma y tema
// ============================================================

import React, { useState } from 'react';
import { useStore } from '@/engine/store';
import { asset, BRAND_URL, REPO_URL, useT } from '@/hooks';

export const Toolbar: React.FC = () => {
  const t = useT();
  const devices = useStore(s => s.devices);
  const links = useStore(s => s.links);
  const speed = useStore(s => s.speed);
  const lang = useStore(s => s.lang);
  const theme = useStore(s => s.theme);
  const drawer = useStore(s => s.drawer);
  const { setSpeed, clearAnimations, exportTopology, importTopology, setLang, setTheme, requestFit, setDrawer } = useStore.getState();

  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('mi-red');

  const up = devices.filter(d => d.status === 'up').length;

  const download = () => {
    const safe = (name.trim() || 'topologia').replace(/[^\w.-]+/g, '_').slice(0, 60);
    const blob = new Blob([exportTopology(safe)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safe}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaveOpen(false);
  };

  const load = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 2_000_000) { importTopology('null'); return; }
      file.text().then(txt => importTopology(txt));
    };
    input.click();
  };

  return (
    <>
      <header className="toolbar">
        <button
          className={`tb-btn icon only-narrow ${drawer === 'left' ? 'active' : ''}`}
          onClick={() => setDrawer(drawer === 'left' ? null : 'left')}
          title={t('top.tools')} aria-label={t('top.tools')}
        >☰</button>

        <a className="tb-brand" href={BRAND_URL} target="_blank" rel="noopener noreferrer" title={t('top.brand')}>
          <img src={asset('logo.png')} alt="Un fantasma en el sistema" />
          <b>Packet Stones</b>
        </a>

        <div className="sep only-wide" />

        <div className="tb-stats only-wide">
          <span><i className="dot" />{up} {t('top.active')}</span>
          <span><i className="dot bad" />{devices.length - up} {t('top.down')}</span>
          <span>🔌 {links.filter(l => l.status === 'up').length}/{links.length} {t('top.links')}</span>
        </div>

        <div className="spacer" />

        <label className="tb-speed">
          <span className="only-wide">{t('top.speed')}</span>
          <select value={speed} onChange={e => setSpeed(Number(e.target.value))} aria-label={t('top.speed')}>
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
          </select>
        </label>

        <button className="tb-btn" onClick={() => setSaveOpen(true)} title={t('top.save')}>💾<span className="only-wide">{t('top.save')}</span></button>
        <button className="tb-btn" onClick={load} title={t('top.load')}>📂<span className="only-wide">{t('top.load')}</span></button>
        <button className="tb-btn" onClick={clearAnimations} title={t('top.clearPackets')}>🧹<span className="only-wide">{t('top.clearPackets')}</span></button>
        <button className="tb-btn tb-fit" onClick={requestFit} title={t('top.fitTip')}>⤢<span className="only-wide">{t('top.fit')}</span></button>

        <div className="sep" />

        <button className="tb-btn" onClick={() => setLang(lang === 'es' ? 'en' : 'es')} title={t('top.lang')}>
          {lang === 'es' ? 'EN' : 'ES'}
        </button>
        <button className="tb-btn icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={t('top.theme')} aria-label={t('top.theme')}>
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <a className="tb-btn only-wide" href={REPO_URL} target="_blank" rel="noopener noreferrer" title={t('top.github')}>
          GitHub
        </a>
        <a className="tb-site only-wide" href={BRAND_URL} target="_blank" rel="noopener noreferrer">unfantasmaenelsistema.com</a>

        <button
          className={`tb-btn icon only-narrow ${drawer === 'right' ? 'active' : ''}`}
          onClick={() => setDrawer(drawer === 'right' ? null : 'right')}
          title={t('top.config')} aria-label={t('top.config')}
        >⚙</button>
      </header>

      {saveOpen && (
        <div className="modal-bg" onClick={() => setSaveOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={t('save.title')}>
            <h3>💾 {t('save.title')}</h3>
            <input
              className="input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('save.name')}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') download(); if (e.key === 'Escape') setSaveOpen(false); }}
            />
            <div className="modal-actions">
              <button className="btn small" onClick={() => setSaveOpen(false)}>{t('save.cancel')}</button>
              <button className="btn small primary" onClick={download}>{t('save.ok')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
