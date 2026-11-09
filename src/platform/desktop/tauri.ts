import { isTauri } from '@tauri-apps/api/core';
import { availableMonitors, currentMonitor, cursorPosition, getCurrentWindow, PhysicalPosition, PhysicalSize, primaryMonitor } from '@tauri-apps/api/window';
import type { Monitor } from '@tauri-apps/api/window';
import { CONFIG } from '../../config';
import type { GameDebug } from '../../debug';
import { DesktopController } from './controller';
import { monitorSchema } from './math';
import type { DesktopMonitor } from './math';

function describe(monitor: Monitor): DesktopMonitor {
  return monitorSchema.parse({ key: `${monitor.name ?? 'display'}:${monitor.position.x},${monitor.position.y}`, scaleFactor: monitor.scaleFactor,
    workArea: { x: monitor.workArea.position.x, y: monitor.workArea.position.y, width: monitor.workArea.size.width, height: monitor.workArea.size.height } });
}
export async function startDesktop(game: GameDebug, redraw: () => void): Promise<void> {
  if (!isTauri()) return;
  document.body.classList.add('native-shell');
  const win = getCurrentWindow();
  let stopped = false, timer = 0, nextMonitorPoll = 0, dockDirty = true, lastHeight = 0;
  let selected: Monitor | undefined;
  const errors: { at: number; message: string }[] = [];
  const status = { active: false, ignoring: true, dockCount: 0, hitTests: 0, monitor: '', logicalHeight: 0 };
  const controller = new DesktopController({
    monitor: async () => {
      const monitor = selected ?? await currentMonitor() ?? await primaryMonitor(); selected = undefined;
      if (!monitor) throw new Error('No monitor work area available');
      const parsed = describe(monitor); status.monitor = parsed.key; return parsed;
    },
    frame: async () => ({ origin: await win.innerPosition(), scaleFactor: await win.scaleFactor() }), cursor: cursorPosition,
    setBounds: async (rect, previous) => {
      if (!previous || previous.width !== rect.width || previous.height !== rect.height) await win.setSize(new PhysicalSize(rect.width, rect.height));
      if (!previous || previous.x !== rect.x || previous.y !== rect.y) await win.setPosition(new PhysicalPosition(rect.x, rect.y));
    },
    ignoreCursor: ignore => win.setIgnoreCursorEvents(ignore),
  });
  function record(error: unknown): void {
    errors.push({ at: Date.now(), message: String(error) }); if (errors.length > CONFIG.desktop.errorLimit) errors.shift();
  }
  async function failSafe(error: unknown): Promise<void> {
    record(error); stopped = true; status.active = false; clearTimeout(timer);
    // A failed hit-test must not leave an invisible desktop-wide input blocker.
    try { await win.setIgnoreCursorEvents(true); } catch (failure) { record(failure); }
    try { await win.hide(); } catch (failure) { record(failure); }
  }
  const dirty = (): void => { dockDirty = true; redraw(); };
  const unlisten = await Promise.all([win.onScaleChanged(dirty), win.onMoved(dirty)]);
  const stop = (): void => { stopped = true; clearTimeout(timer); for (const off of unlisten) off(); };
  window.addEventListener('pagehide', stop, { once: true });
  window.__shell = {
    getDiagnostics: () => ({ ...status, errors: structuredClone(errors), config: CONFIG.desktop }),
    monitors: async () => (await availableMonitors()).map(describe),
    selectMonitor: async index => {
      const list = await availableMonitors(); const monitor = list[index];
      if (!Number.isInteger(index) || !monitor) throw new Error('Monitor index out of range');
      selected = monitor; dockDirty = true;
    },
    quit: () => win.close(),
  };
  async function poll(): Promise<void> {
    if (stopped) return;
    try {
      const expanded = game.getLayout().height > CONFIG.view.canvasHeight;
      const height = expanded ? CONFIG.desktop.expandedLogicalHeight : CONFIG.desktop.closedLogicalHeight;
      if (dockDirty || height !== lastHeight || performance.now() >= nextMonitorPoll) {
        dockDirty = false; nextMonitorPoll = performance.now() + CONFIG.desktop.monitorPollMs;
        if (await controller.dock(height)) { status.dockCount += 1; redraw(); }
        lastHeight = height; status.logicalHeight = height;
      }
      status.ignoring = await controller.hitTest(game.getHitRegions()); status.hitTests += 1;
      timer = window.setTimeout(() => { void poll(); }, CONFIG.desktop.cursorPollMs);
    } catch (error) { await failSafe(error); }
  }
  try {
    await win.setIgnoreCursorEvents(true);
    await game.whenReady();
    await poll();
    if (!stopped) { await win.show(); status.active = true; }
  } catch (error) { await failSafe(error); }
}
declare global {
  interface Window {
    __shell?: {
      getDiagnostics(): { active: boolean; ignoring: boolean; dockCount: number; hitTests: number; monitor: string; logicalHeight: number; errors: { at: number; message: string }[]; config: typeof CONFIG.desktop };
      monitors(): Promise<DesktopMonitor[]>; selectMonitor(index: number): Promise<void>; quit(): Promise<void>;
    };
  }
}
