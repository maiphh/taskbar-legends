export type ExitCommand = 'quit_app' | 'relaunch_app';
/**
 * Save-then-exit, shared by native tray/menu-bar events and the HUD Quit button.
 * The first request wins; the native side also ignores duplicates.
 */
export function createExit(flushSave: () => void, exit: (command: ExitCommand) => Promise<unknown>): (command: ExitCommand) => Promise<void> {
  let pending: Promise<void> | undefined;
  return command => {
    pending ??= (async () => { flushSave(); await exit(command); })();
    return pending;
  };
}
