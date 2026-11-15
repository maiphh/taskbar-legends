import { isTauri } from '@tauri-apps/api/core';
import { startCompactDesktop } from './compact-runtime';

export interface DesktopHooks { flushSave(): void; setQuit(handler: (() => void) | null): void }
export interface DesktopOptions { setEditing(value: boolean): void }

/** Start the current compact native shell. The legacy expanded shell is no longer selectable. */
export async function startDesktop(hooks: DesktopHooks, options: DesktopOptions): Promise<void> {
  if (!isTauri()) return;
  document.body.classList.add('native-shell', 'compact-native');
  const stop = await startCompactDesktop({ ...hooks, setEditing: options.setEditing });
  window.addEventListener('pagehide', stop, { once: true });
}
