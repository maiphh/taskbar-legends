import { CONFIG } from '../config';
import { TextSaveStore } from '../core/save-store';
import type { SaveStore } from '../core/save-store';

/** Default browser persistence. */
export function localSaveStore(key = CONFIG.runtime.saveKey): SaveStore {
  const storage = {
    getItem: (key: string) => window.localStorage.getItem(key),
    setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
    removeItem: (key: string) => window.localStorage.removeItem(key),
  };
  return new TextSaveStore(storage, key);
}
