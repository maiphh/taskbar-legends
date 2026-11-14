import { decodeSave, encodeSave } from './save';
import type { SaveData } from './save';

/** Persistence boundary. localStorage is the default; a Tauri file store or server store can implement this later. */
export interface SaveStore {
  load(): Promise<SaveData | null>;
  save(data: SaveData): Promise<void>;
  clear(): Promise<void>;
  failedRaw(): string | null;
  discardFailed(): Promise<void>;
}
/** Minimal string storage, satisfied by window.localStorage. */
export interface TextStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

/** Stores the v2 JSON under one key. Writes happen synchronously inside save(), so pagehide flushes still land. */
export class TextSaveStore implements SaveStore {
  private readonly failedKey: string;
  private failed: string | null = null;
  private writesBlocked = false;
  constructor(private readonly storage: TextStorage, private readonly key: string) { this.failedKey = `${key}:failed`; }
  load(): Promise<SaveData | null> {
    return Promise.resolve().then(() => {
      try {
        const quarantined = this.storage.getItem(this.failedKey);
        if (quarantined !== null) { this.failed = quarantined; this.writesBlocked = true; throw new Error('A failed save is quarantined; export or discard it before continuing.'); }
        const raw = this.storage.getItem(this.key);
        if (raw === null) { this.writesBlocked = false; return null; }
        try { const data = decodeSave(JSON.parse(raw)); this.writesBlocked = false; return data; }
        catch (error) {
          this.failed = raw; this.writesBlocked = true;
          // Keep the original key untouched. If this copy fails, normal writes remain blocked in this instance,
          // and the next load retries from the still-intact primary value.
          this.storage.setItem(this.failedKey, raw);
          throw error;
        }
      } catch (error) { this.writesBlocked = true; throw error; }
    });
  }
  save(data: SaveData): Promise<void> {
    try {
      if (this.writesBlocked || this.failed !== null || this.storage.getItem(this.failedKey) !== null) return Promise.reject(new Error('Save blocked while a failed save is quarantined.'));
      this.storage.setItem(this.key, JSON.stringify(encodeSave(data))); return Promise.resolve();
    }
    catch (error) { return Promise.reject(error instanceof Error ? error : new Error(String(error))); }
  }
  clear(): Promise<void> { this.storage.removeItem(this.key); return Promise.resolve(); }
  failedRaw(): string | null {
    if (this.failed !== null) return this.failed;
    try { const backup = this.storage.getItem(this.failedKey); if (backup !== null) return backup; } catch { /* try primary key after transient storage errors */ }
    return this.storage.getItem(this.key);
  }
  discardFailed(): Promise<void> {
    try { this.storage.removeItem(this.failedKey); this.storage.removeItem(this.key); this.failed = null; this.writesBlocked = false; return Promise.resolve(); }
    catch (error) { return Promise.reject(error instanceof Error ? error : new Error(String(error))); }
  }
}
/** In-memory store for tests and the sim; still round-trips through the v2 encoding. */
export function memorySaveStore(): SaveStore {
  const map = new Map<string, string>();
  return new TextSaveStore({ getItem: key => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); }, removeItem: key => { map.delete(key); } }, 'save');
}
