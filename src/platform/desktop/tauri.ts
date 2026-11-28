import { isTauri } from '@tauri-apps/api/core';
import { startCompactDesktop } from './compact-runtime';
import type { CompactPresentationState } from './compact-runtime';

export interface DesktopHooks { flushSave(): void; setQuit(handler: (() => void) | null): void; presentationState?(): CompactPresentationState }
export interface DesktopOptions { setControlInset(physicalPixels: number): void; setEditing(value: boolean): void }

/** Start the current compact native shell. The legacy expanded shell is no longer selectable. */
export async function startDesktop(hooks: DesktopHooks, options: DesktopOptions): Promise<void> {
  if (!isTauri()) return;
  document.body.classList.add('native-shell', 'compact-native');
  const stop = await startCompactDesktop({ ...hooks, ...options });
  window.addEventListener('pagehide', stop, { once: true });
}
