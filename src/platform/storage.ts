import { CONFIG } from '../config';
import { makeSave, restoreSave } from '../core/save';
import type { GameState } from '../core/model';
export function readLocalSave(nowMs: number): ReturnType<typeof restoreSave> | null {
  const raw = localStorage.getItem(CONFIG.runtime.saveKey);
  return raw ? restoreSave(raw, nowMs) : null;
}
export function writeLocalSave(state: GameState, nowMs: number, remainderMs: number): void {
  localStorage.setItem(CONFIG.runtime.saveKey, makeSave(state, nowMs, remainderMs));
}
