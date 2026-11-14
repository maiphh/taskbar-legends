import { COMPACT_DEFAULTS, parseCompactPrefs } from './desktop/compact-geometry';
import type { CompactPrefs } from './desktop/compact-geometry';

const KEY = 'taskbar-legends:compact-window:v1';
export function readCompactPrefs(): CompactPrefs {
  try { const raw = localStorage.getItem(KEY); return raw === null ? { ...COMPACT_DEFAULTS } : parseCompactPrefs(JSON.parse(raw)); }
  catch { return { ...COMPACT_DEFAULTS }; }
}
export function writeCompactPrefs(prefs: CompactPrefs): void {
  localStorage.setItem(KEY, JSON.stringify(parseCompactPrefs(prefs)));
}
