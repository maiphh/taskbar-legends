import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), monitors: vi.fn(), currentMonitor: vi.fn(), primaryMonitor: vi.fn(), getWindow: vi.fn(), getViews: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: h.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: h.listen }));
vi.mock('@tauri-apps/api/window', () => ({ availableMonitors: h.monitors, currentMonitor: h.currentMonitor, primaryMonitor: h.primaryMonitor, getCurrentWindow: h.getWindow }));
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getAllWebviewWindows: h.getViews }));

import { startCompactDesktop } from '../src/platform/desktop/compact-runtime';

const regular = { name: 'regular', position: { x: 0, y: 0 }, scaleFactor: 1, workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } } };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve: (value: T) => resolve(value) }; }

let current = { x: 100, y: 100, width: 640, height: 160 };
let ignored: boolean[];
let eventHandlers: Record<string, (event?: unknown) => void>;
let nodeHandlers: Record<string, (event?: unknown) => void>;
let currentWindow: Record<string, ReturnType<typeof vi.fn>>;
let controlWebview: { label: string; innerSize: ReturnType<typeof vi.fn>; show: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.useFakeTimers(); ignored = []; eventHandlers = {}; nodeHandlers = {}; current = { x: 100, y: 100, width: 640, height: 160 };
  vi.stubGlobal('window', globalThis);
  Object.assign(globalThis, { addEventListener: vi.fn(), removeEventListener: vi.fn(), localStorage: { getItem: () => null, setItem: vi.fn() } });
  const nodes = new Map<string, { hidden?: boolean; addEventListener?: (name: string, callback: (event?: unknown) => void) => void }>();
  for (const id of ['save-recovery', 'edit-overlay', 'drag-handle', 'resize-handle', 'edit-done']) nodes.set(id, { hidden: id === 'edit-overlay' || id === 'save-recovery', addEventListener: (name, callback) => { nodeHandlers[`${id}:${name}`] = callback; } });
  vi.stubGlobal('document', { getElementById: (id: string) => nodes.get(id) ?? null });
  vi.stubGlobal('MutationObserver', class { constructor(private readonly callback: () => void) {} observe() { void this.callback; } disconnect() {} });
  currentWindow = {
    innerPosition: vi.fn(async () => ({ x: current.x, y: current.y })), outerPosition: vi.fn(async () => ({ x: current.x, y: current.y })),
    innerSize: vi.fn(async () => ({ width: current.width, height: current.height })), outerSize: vi.fn(async () => ({ width: current.width, height: current.height })),
    setIgnoreCursorEvents: vi.fn(async (value: boolean) => { ignored.push(value); }), onMoved: vi.fn(async (callback: (event?: unknown) => void) => { eventHandlers.moved = callback; return vi.fn(); }),
    onResized: vi.fn(async (callback: () => void) => { eventHandlers.resized = callback; return vi.fn(); }), onScaleChanged: vi.fn(async (callback: () => void) => { eventHandlers.scale = callback; return vi.fn(); }),
    show: vi.fn(async () => undefined), startDragging: vi.fn(async () => undefined), startResizeDragging: vi.fn(async () => undefined),
  };
  controlWebview = { label: 'controls', innerSize: vi.fn(async () => ({ width: 136, height: 36 })), show: vi.fn(async () => undefined) };
  h.invoke.mockImplementation(async (command: string) => command === 'shell_mode' ? 'overlay' : undefined);
  h.listen.mockImplementation(async (name: string, callback: (event?: unknown) => void) => { eventHandlers[name] = callback; return vi.fn(); });
  h.monitors.mockResolvedValue([regular]); h.currentMonitor.mockResolvedValue(regular); h.primaryMonitor.mockResolvedValue(regular);
  h.getWindow.mockReturnValue(currentWindow); h.getViews.mockResolvedValue([controlWebview]);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('compact native runtime integration seams', () => {
  it('keeps input captured when recovery is visible initially and after exiting Edit', async () => {
    const recovery = document.getElementById('save-recovery') as { hidden: boolean };
    recovery.hidden = false;
    let editing = false;
    const cleanup = await startCompactDesktop({ flushSave: vi.fn(), setQuit: vi.fn(), setEditing: value => { editing = value; const overlay = document.getElementById('edit-overlay') as { hidden: boolean }; overlay.hidden = !value; } });
    expect(ignored.at(-1)).toBe(false);
    eventHandlers['compact://edit']?.(); await Promise.resolve();
    expect(editing).toBe(true);
    recovery.hidden = false;
    nodeHandlers['edit-done:click']?.(); await Promise.resolve(); await Promise.resolve();
    expect(editing).toBe(false);
    expect(ignored.at(-1)).toBe(false);
    cleanup();
  });

  it('does not apply an old poll monitor result after a newer move settles', async () => {
    const oldMonitor = { name: 'stale-small', position: { x: 0, y: 0 }, scaleFactor: 1, workArea: { position: { x: 0, y: 0 }, size: { width: 430, height: 200 } } };
    const delayed = deferred<typeof regular[]>(); let monitorCall = 0;
    h.monitors.mockImplementation(() => { monitorCall += 1; return monitorCall === 3 ? delayed.promise : Promise.resolve([regular]); });
    const cleanup = await startCompactDesktop({ flushSave: vi.fn(), setQuit: vi.fn(), setEditing: vi.fn() });
    await vi.waitFor(() => expect(monitorCall).toBe(3));
    current = { x: 100, y: 100, width: 640, height: 160 };
    eventHandlers.moved?.();
    await vi.advanceTimersByTimeAsync(300);
    const appliedBeforeStale = h.invoke.mock.calls.filter(([command]) => command === 'set_overlay_bounds').length;
    delayed.resolve([oldMonitor]);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const appliedAfterStale = h.invoke.mock.calls.filter(([command]) => command === 'set_overlay_bounds').length;
    expect(appliedAfterStale).toBe(appliedBeforeStale);
    cleanup();
  });

  it('persists native edge resizes and clamps them, while ignoring programmatic size events', async () => {
    const storage = localStorage as unknown as { setItem: ReturnType<typeof vi.fn>; getItem: ReturnType<typeof vi.fn> };
    const cleanup = await startCompactDesktop({ flushSave: vi.fn(), setQuit: vi.fn(), setEditing: vi.fn() });
    h.invoke.mockImplementation(async (command: string, args?: { bounds?: { x: number; y: number; width: number; height: number } }) => {
      if (command === 'set_overlay_bounds' && args?.bounds) current = { ...args.bounds };
      return command === 'shell_mode' ? 'overlay' : undefined;
    });
    const storedWidth = (): number => JSON.parse(storage.setItem.mock.calls.at(-1)?.[1] ?? '{"sourceWidth":640}').sourceWidth;
    const finishResize = async (width: number): Promise<void> => { current = { ...current, width }; eventHandlers.resized?.(); await vi.advanceTimersByTimeAsync(300); await Promise.resolve(); };

    await finishResize(800);
    expect(storedWidth()).toBe(800);
    await finishResize(400);
    expect(storedWidth()).toBe(480);
    expect(current.width).toBe(480);
    await finishResize(1500);
    expect(storedWidth()).toBe(1280);
    expect(current.width).toBe(1280);

    // Mimic an application-owned size application and its native resize notification.
    h.invoke.mockImplementation(async (command: string, args?: { bounds?: { x: number; y: number; width: number; height: number } }) => {
      if (command === 'set_overlay_bounds' && args?.bounds) { current = { ...args.bounds }; queueMicrotask(() => eventHandlers.resized?.()); }
      return command === 'shell_mode' ? 'overlay' : undefined;
    });
    eventHandlers['compact://reset-size']?.();
    await vi.advanceTimersByTimeAsync(300); await Promise.resolve(); await Promise.resolve();
    expect(current.width).toBe(640);
    expect(storedWidth()).toBe(640);
    cleanup();
  });

  it.each(['resize-first', 'scale-first'] as const)('preserves preferred size across DPI transition when %s', async order => {
    let active = regular;
    h.monitors.mockImplementation(async () => [active]);
    h.currentMonitor.mockImplementation(async () => active);
    h.invoke.mockImplementation(async (command: string, args?: { bounds?: { x: number; y: number; width: number; height: number } }) => {
      if (command === 'set_overlay_bounds' && args?.bounds) current = { ...args.bounds };
      return command === 'shell_mode' ? 'overlay' : undefined;
    });
    const cleanup = await startCompactDesktop({ flushSave: vi.fn(), setQuit: vi.fn(), setEditing: vi.fn() });
    active = { ...regular, scaleFactor: 1.5 };
    current = { ...current, width: 960 };
    if (order === 'resize-first') { eventHandlers.resized?.(); eventHandlers.scale?.(); }
    else { eventHandlers.scale?.(); eventHandlers.resized?.(); }
    await vi.advanceTimersByTimeAsync(300); await Promise.resolve(); await Promise.resolve();
    const storage = localStorage as unknown as { setItem: ReturnType<typeof vi.fn> };
    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)?.[1] ?? '{"sourceWidth":640}');
    expect(saved.sourceWidth).toBe(640);
    expect(current.width).toBe(640);
    cleanup();
  });

  it('retains preferred size through a 500px monitor constraint and restores it on a larger monitor', async () => {
    let active = { ...regular, workArea: { position: { x: 0, y: 0 }, size: { width: 500, height: 700 } } };
    h.monitors.mockImplementation(async () => [active]);
    h.currentMonitor.mockImplementation(async () => active);
    h.invoke.mockImplementation(async (command: string, args?: { bounds?: { x: number; y: number; width: number; height: number } }) => {
      if (command === 'set_overlay_bounds' && args?.bounds) current = { ...args.bounds };
      return command === 'shell_mode' ? 'overlay' : undefined;
    });
    const cleanup = await startCompactDesktop({ flushSave: vi.fn(), setQuit: vi.fn(), setEditing: vi.fn() });
    expect(current.width).toBe(500);
    active = regular;
    eventHandlers.scale?.();
    await vi.waitFor(() => expect(current.width).toBe(640));
    cleanup();
  });

  it.each(['resize-then-move', 'move-then-resize'] as const)('retains user resize intent across %s native events', async order => {
    const storage = localStorage as unknown as { setItem: ReturnType<typeof vi.fn> };
    const cleanup = await startCompactDesktop({ flushSave: vi.fn(), setQuit: vi.fn(), setEditing: vi.fn() });
    current = { ...current, x: 180, width: 800 };
    if (order === 'resize-then-move') { eventHandlers.resized?.(); eventHandlers.moved?.(); }
    else { eventHandlers.moved?.(); eventHandlers.resized?.(); }
    await vi.advanceTimersByTimeAsync(300);
    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)?.[1] ?? '{"sourceWidth":640}');
    expect(saved.sourceWidth).toBe(800);
    expect(current).toMatchObject({ x: 180, width: 800 });
    cleanup();
  });

  it('does not apply stale control placement after its delayed size query resolves', async () => {
    const oldSize = deferred<{ width: number; height: number }>();
    const cleanup = await startCompactDesktop({ flushSave: vi.fn(), setQuit: vi.fn(), setEditing: vi.fn() });
    controlWebview.innerSize.mockImplementationOnce(() => oldSize.promise);
    eventHandlers.moved?.();
    await vi.advanceTimersByTimeAsync(300);
    await Promise.resolve();
    const oldControlCalls = h.invoke.mock.calls.filter(([command]) => command === 'set_control_bounds').length;
    current = { ...current, x: 300, width: 800 };
    eventHandlers.resized?.();
    await vi.advanceTimersByTimeAsync(300);
    const newControlCalls = h.invoke.mock.calls.filter(([command]) => command === 'set_control_bounds').length;
    expect(newControlCalls).toBe(oldControlCalls + 1);
    oldSize.resolve({ width: 136, height: 36 });
    await Promise.resolve(); await Promise.resolve();
    expect(h.invoke.mock.calls.filter(([command]) => command === 'set_control_bounds').length).toBe(newControlCalls);
    cleanup();
  });
});
