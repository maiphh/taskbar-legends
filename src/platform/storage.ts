import { CONFIG } from '../config';
import { TextSaveStore } from '../core/save-store';
import type { SaveStore } from '../core/save-store';

/** Default browser persistence. */
export function localSaveStore(): SaveStore { return new TextSaveStore(localStorage, CONFIG.runtime.saveKey); }
