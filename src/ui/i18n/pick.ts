// Bun macro: imported `with { type: 'macro' }`, it runs at bundle time and
// inlines only the picked keys, so the full catalogs never reach the bundle.

import type { Catalogs } from '../i18n.ts';
import { allCatalogs } from './all.ts';
import { SURFACE_KEYS, type Surface } from './surfaces.ts';

const picked = (key: string, prefixes: readonly string[]) => prefixes.some((p) => key.startsWith(p));

/** Every locale's strings and plural forms whose key starts with one of the surface's prefixes. */
export function pickCatalogs(surface: Surface): Catalogs {
  const prefixes = SURFACE_KEYS[surface];
  const select = <T>(table: Record<string, T>) =>
    Object.fromEntries(Object.entries(table).filter(([key]) => picked(key, prefixes)));
  return {
    strings: Object.fromEntries(Object.entries(allCatalogs.strings).map(([name, c]) => [name, select(c)])),
    plurals: Object.fromEntries(Object.entries(allCatalogs.plurals).map(([name, c]) => [name, select(c)])),
  };
}
