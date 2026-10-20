// ============================================================
//  hooks.ts  —  Traducción ligada al idioma del store
// ============================================================

import { useCallback } from 'react';
import { useStore } from '@/engine/store';
import { TKey, translate } from '@/i18n';
import { LogParams } from '@/types/network';

export function useT() {
  const lang = useStore(s => s.lang);
  return useCallback((key: TKey | string, params?: LogParams) => translate(lang, key, params), [lang]);
}

/** Ruta pública (respeta el `base` de Vite para GitHub Pages). */
export const asset = (p: string) => `${import.meta.env.BASE_URL}${p}`;

export const BRAND_URL = 'https://www.unfantasmaenelsistema.com';
export const REPO_URL = 'https://github.com/unfantasmaenelsistema/PacketStones';
