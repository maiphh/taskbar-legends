import { decodeSave, encodeSave } from './save';
import type { SaveData } from './save';

/** Persistence boundary. localStorage is the default; a Tauri file store or server store can implement this later. */
export interface SaveStore {
  load(): Promise<SaveData | null>;
  save(data: SaveData): Promise<void>;
  clear(): Promise<void>;
}
/** Minimal string storage, satisfied by window.localStorage. */
export interface TextStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

/** Stores the v2 JSON under one key. Writes happen synchronously inside save(), so pagehide flushes still land. */
export class TextSaveStore implements SaveStore {
  constructor(private readonly storage: TextStorage, private readonly key: string) {}
  load(): Promise<SaveData | null> {
    return Promise.resolve().then(() => { const raw = this.storage.getItem(this.key); return raw === null ? null : decodeSave(JSON.parse(raw)); });
  }
  save(data: SaveData): Promise<void> {
    try { this.storage.setItem(this.key, JSON.stringify(encodeSave(data))); return Promise.resolve(); }
    catch (error) { return Promise.reject(error instanceof Error ? error : new Error(String(error))); }
  }
  clear(): Promise<void> { this.storage.removeItem(this.key); return Promise.resolve(); }
}
/** In-memory store for tests and the sim; still round-trips through the v2 encoding. */
export function memorySaveStore(): SaveStore {
  const map = new Map<string, string>();
  return new TextSaveStore({ getItem: key => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); }, removeItem: key => { map.delete(key); } }, 'save');
}
