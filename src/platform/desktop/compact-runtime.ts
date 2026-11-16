import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { availableMonitors, currentMonitor, getCurrentWindow, primaryMonitor } from '@tauri-apps/api/window';
import { getAllWebviewWindows } from '@tauri-apps/api/webviewWindow';
import type { Monitor } from '@tauri-apps/api/window';
import { readCompactPrefs, writeCompactPrefs } from '../compact-prefs';
import { clientRectToFrameRect, clientWorkArea, constrainCompactRect, geometryGenerationCurrent, gestureGeneration, presentationClientBounds, restoreCompactGeometry, settleClientGeometry } from './compact-geometry';
import type { CompactPrefs, FrameInsets, GestureState } from './compact-geometry';
import { monitorSchema } from './math';
import type { DesktopMonitor, PhysicalRect } from './math';
import { CONFIG } from '../../config';
import { createExit } from './lifecycle';

function describe(monitor: Monitor): DesktopMonitor {
  return monitorSchema.parse({ key: `${monitor.name ?? 'display'}:${monitor.position.x},${monitor.position.y}`, scaleFactor: monitor.scaleFactor,
    workArea: { x: monitor.workArea.position.x, y: monitor.workArea.position.y, width: monitor.workArea.size.width, height: monitor.workArea.size.height } });
}
function centerInside(rect: PhysicalRect, work: PhysicalRect): boolean {
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  return x >= work.x && x < work.x + work.width && y >= work.y && y < work.y + work.height;
}
function isContained(rect: PhysicalRect, work: PhysicalRect): boolean {
  return rect.x >= work.x && rect.y >= work.y && rect.x + rect.width <= work.x + work.width && rect.y + rect.height <= work.y + work.height;
}
export function shouldIgnoreCursor(passive: boolean, recoveryVisible: boolean, editing: boolean): boolean {
  return passive && !recoveryVisible && !editing;
}
function safePrefs(): CompactPrefs { return readCompactPrefs(); }

/** Party-preview native placement. Geometry in this module is always physical client-area geometry. */
export interface CompactPresentationState { welcomeOpen: boolean; sourceHeight: number }
export interface CompactRuntimeHooks { flushSave(): void; setQuit(handler: (() => void) | null): void; setEditing(value: boolean): void; presentationState?(): CompactPresentationState }
export async function startCompactDesktop(hooks: CompactRuntimeHooks): Promise<() => void> {
  const win = getCurrentWindow(), views = await getAllWebviewWindows(), controls = views.find(value => value.label === 'controls');
  if (!controls) throw new Error('Native compact control surface is not configured.');
  let prefs = safePrefs(), gesture: GestureState = 'idle', generation = 0, stopped = false, settleTimer = 0, pollTimer = 0, pendingNativeResize = false;
  let presentation: CompactPresentationState = hooks.presentationState?.() ?? { welcomeOpen: false, sourceHeight: prefs.sourceHeight };
  let currentMonitorValue: DesktopMonitor | undefined;
  let acceptedSize: { width: number; height: number } | undefined, acceptedEnvironment = '';
  let programmaticSize: { width: number; height: number } | undefined, presentationBoundsTarget: PhysicalRect | null = null;
  let boundsQueue: Promise<void> = Promise.resolve(), boundsPending = 0;
  const cleanups: (() => void)[] = [];
  const monitors = async (): Promise<DesktopMonitor[]> => (await availableMonitors()).map(describe);
  const frameInsets = async (): Promise<FrameInsets> => {
    const [innerPosition, outerPosition, innerSize, outerSize] = await Promise.all([win.innerPosition(), win.outerPosition(), win.innerSize(), win.outerSize()]);
    const left = innerPosition.x - outerPosition.x, top = innerPosition.y - outerPosition.y;
    return { left: Math.max(0, left), top: Math.max(0, top), right: Math.max(0, outerSize.width - innerSize.width - left), bottom: Math.max(0, outerSize.height - innerSize.height - top) };
  };
  const chooseMonitor = async (rect?: PhysicalRect): Promise<DesktopMonitor> => {
    const all = await monitors();
    const found = rect ? all.find(monitor => centerInside(rect, monitor.workArea)) : undefined;
    if (found) return found;
    const requested = all.find(monitor => monitor.key === prefs.monitorKey);
    if (requested) return requested;
    const active = await currentMonitor(); if (active) return describe(active);
    const primary = await primaryMonitor(); if (primary) return describe(primary);
    if (!all[0]) throw new Error('No monitor work area is available');
    return all[0];
  };
  const bounds = async (): Promise<PhysicalRect> => {
    const [position, size] = await Promise.all([win.innerPosition(), win.innerSize()]);
    return { x: position.x, y: position.y, width: size.width, height: size.height };
  };
  const isCurrent = (observed: number): boolean => !stopped && geometryGenerationCurrent(generation, observed);
  const placeControl = async (clientRect: PhysicalRect, observed: number): Promise<boolean> => {
    const size = await controls.innerSize();
    if (!isCurrent(observed)) return false;
    const x = Math.round(clientRect.x + clientRect.width - size.width - 8), y = Math.round(clientRect.y + 4);
    if (!isCurrent(observed)) return false;
    await invoke('set_control_bounds', { bounds: { x, y, width: size.width, height: size.height } });
    return isCurrent(observed);
  };
  const environmentKey = (monitor: DesktopMonitor): string => `${monitor.key}|${monitor.scaleFactor}|${monitor.workArea.x},${monitor.workArea.y},${monitor.workArea.width},${monitor.workArea.height}`;
  const rememberAccepted = (rect: PhysicalRect, monitor: DesktopMonitor): void => {
    acceptedSize = { width: rect.width, height: rect.height }; acceptedEnvironment = environmentKey(monitor);
  };
  const applyClientBounds = async (rect: PhysicalRect, monitor: DesktopMonitor, observed: number): Promise<void> => {
    if (!isCurrent(observed)) return;
    boundsPending += 1;
    const request = boundsQueue.then(async () => {
      if (!isCurrent(observed)) return;
      presentationBoundsTarget = { ...rect };
      programmaticSize = { width: rect.width, height: rect.height };
      await invoke('set_overlay_bounds', { bounds: rect });
      if (isCurrent(observed)) rememberAccepted(rect, monitor);
    });
    boundsQueue = request.catch(() => undefined);
    try { await request; } finally { boundsPending = Math.max(0, boundsPending - 1); }
  };
  const targetBounds = (source: CompactPrefs, monitor: DesktopMonitor, insets: FrameInsets): { rect: PhysicalRect; constrained: boolean } => presentation.welcomeOpen
    ? presentationClientBounds(source, monitor, insets, presentation.sourceHeight)
    : { rect: restoreCompactGeometry(source, clientWorkArea(monitor, insets)).rect, constrained: false };
  const applyPreferences = async (next: CompactPrefs, save: boolean): Promise<void> => {
    const observed = ++generation;
    clearTimeout(settleTimer); pendingNativeResize = false; gesture = 'idle'; prefs = next;
    if (save) writeCompactPrefs(prefs);
    const initialBounds = await bounds(); if (!isCurrent(observed)) return;
    const insets = await frameInsets(); if (!isCurrent(observed)) return;
    const active = currentMonitorValue ?? await chooseMonitor(clientRectToFrameRect(initialBounds, insets)); if (!isCurrent(observed)) return;
    currentMonitorValue = active;
    const targetState = targetBounds(prefs, active, insets), target = targetState.rect;
    document.body.classList.toggle('native-welcome-scroll', presentation.welcomeOpen && targetState.constrained);
    if (presentation.welcomeOpen) await controls.hide();
    if (!await placeControl(target, observed) || !isCurrent(observed)) return;
    await applyClientBounds(target, active, observed);
  };
  const settle = (): void => {
    if (presentation.welcomeOpen) { void applyPresentationState(presentation).catch(() => undefined); return; }
    const observed = ++generation; clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => { void (async () => {
      if (!isCurrent(observed)) return;
      const rect = await bounds(); if (!isCurrent(observed)) return;
      const insets = await frameInsets(); if (!isCurrent(observed)) return;
      const active = await chooseMonitor(clientRectToFrameRect(rect, insets)); if (!isCurrent(observed)) return;
      currentMonitorValue = active;
      if (presentationBoundsTarget && rect.x === presentationBoundsTarget.x && rect.y === presentationBoundsTarget.y && rect.width === presentationBoundsTarget.width && rect.height === presentationBoundsTarget.height) {
        presentationBoundsTarget = null; programmaticSize = undefined; rememberAccepted(rect, active); pendingNativeResize = false; return;
      }
      const changedFromAccepted = !acceptedSize || rect.width !== acceptedSize.width || rect.height !== acceptedSize.height;
      const expectedProgrammaticSize = programmaticSize?.width === rect.width && programmaticSize.height === rect.height;
      const environmentChanged = acceptedEnvironment !== '' && acceptedEnvironment !== environmentKey(active);
      const nativeUserResize = pendingNativeResize && changedFromAccepted && !expectedProgrammaticSize && !environmentChanged;
      const settleGesture: GestureState = gesture === 'resizing' || nativeUserResize ? 'resizing' : gesture;
      const clientMonitor = clientWorkArea(active, insets), settled = settleClientGeometry(prefs, rect, clientMonitor, settleGesture), target = settled.rect;
      prefs = settled.prefs; writeCompactPrefs(prefs);
      if (!await placeControl(target, observed) || !isCurrent(observed)) return;
      gesture = 'idle';
      if (target.x !== rect.x || target.y !== rect.y || target.width !== rect.width || target.height !== rect.height) await applyClientBounds(target, active, observed);
      else rememberAccepted(target, active);
      if (!isCurrent(observed)) return;
      pendingNativeResize = false;
      if (expectedProgrammaticSize || environmentChanged || nativeUserResize) programmaticSize = undefined;
    })().catch(() => undefined); }, 300);
  };
  const begin = (next: Exclude<GestureState, 'idle'>): void => { const update = gestureGeneration(generation, next); generation = update.generation; gesture = update.state; clearTimeout(settleTimer); };
  const mode = await invoke<'overlay' | 'window'>('shell_mode'), passive = mode === 'overlay';
  const exit = createExit(() => hooks.flushSave(), command => invoke(command));
  const recovery = document.getElementById('save-recovery'), legacyNotice = document.getElementById('legacy-save-notice'), editOverlay = document.getElementById('edit-overlay');
  const updateInputPolicy = async (editing = !(editOverlay?.hidden ?? true)): Promise<void> => {
    await setIgnore(shouldIgnoreCursor(passive, presentation.welcomeOpen || !(recovery?.hidden ?? true) || !(legacyNotice?.hidden ?? true), editing));
  };
  const setIgnore = (ignore: boolean): Promise<void> => passive ? win.setIgnoreCursorEvents(ignore) : Promise.resolve();
  const applyPresentationState = async (next: CompactPresentationState): Promise<void> => {
    const observed = ++generation; clearTimeout(settleTimer); pendingNativeResize = false; gesture = 'idle';
    presentation = { welcomeOpen: next.welcomeOpen, sourceHeight: Math.max(CONFIG.ui.closed.height, Math.floor(next.sourceHeight)) };
    if (presentation.welcomeOpen && !(editOverlay?.hidden ?? true)) hooks.setEditing(false);
    const initial = await bounds(); if (!isCurrent(observed)) return;
    const insets = await frameInsets(); if (!isCurrent(observed)) return;
    const active = currentMonitorValue ?? await chooseMonitor(clientRectToFrameRect(initial, insets)); if (!isCurrent(observed)) return;
    currentMonitorValue = active;
    const target = targetBounds(prefs, active, insets);
    document.body.classList.toggle('native-welcome-scroll', presentation.welcomeOpen && target.constrained);
    if (presentation.welcomeOpen) await controls.hide();
    else if (!await placeControl(target.rect, observed) || !isCurrent(observed)) return;
    const sameBounds = initial.x === target.rect.x && initial.y === target.rect.y && initial.width === target.rect.width && initial.height === target.rect.height;
    if (!sameBounds || (!presentation.welcomeOpen && boundsPending > 0)) await applyClientBounds(target.rect, active, observed);
    else presentationBoundsTarget = null;
    if (!presentation.welcomeOpen) await controls.show();
    await updateInputPolicy();
  };
  const onPresentationChange = (event: Event): void => {
    const next = (event as CustomEvent<CompactPresentationState>).detail;
    if (next) void applyPresentationState(next).catch(() => undefined);
  };
  window.addEventListener('compact-presentation-change', onPresentationChange); cleanups.push(() => window.removeEventListener('compact-presentation-change', onPresentationChange));
  const showEdit = async (): Promise<void> => { if (presentation.welcomeOpen) return; await setIgnore(shouldIgnoreCursor(passive, !(recovery?.hidden ?? true), true)); hooks.setEditing(true); gesture = 'idle'; };
  const exitEdit = async (): Promise<void> => { hooks.setEditing(false); await updateInputPolicy(false); gesture = 'idle'; };

  const drag = document.getElementById('drag-handle'), resize = document.getElementById('resize-handle'), done = document.getElementById('edit-done');
  drag?.addEventListener('pointerdown', event => { if (document.getElementById('edit-overlay')?.hidden) return; event.preventDefault(); begin('moving'); void win.startDragging().then(() => settle()); });
  resize?.addEventListener('pointerdown', event => { if (document.getElementById('edit-overlay')?.hidden) return; event.preventDefault(); begin('resizing'); void win.startResizeDragging('SouthEast').then(() => settle()); });
  done?.addEventListener('click', () => { void exitEdit(); });
  const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !document.getElementById('edit-overlay')?.hidden) { event.preventDefault(); void exitEdit(); } };
  window.addEventListener('keydown', onKey);
  cleanups.push(() => window.removeEventListener('keydown', onKey));
  const onMoved = await win.onMoved(() => settle()), onResized = await win.onResized(() => { if (presentation.welcomeOpen) { void applyPresentationState(presentation).catch(() => undefined); return; } pendingNativeResize = true; settle(); }), onScale = await win.onScaleChanged(() => {
    if (gesture !== 'idle') return;
    if (presentation.welcomeOpen) { void applyPresentationState(presentation).catch(() => undefined); return; }
    const observed = ++generation; clearTimeout(settleTimer); pendingNativeResize = false;
    void (async () => {
      const rect = await bounds(); if (!isCurrent(observed)) return;
      const insets = await frameInsets(); if (!isCurrent(observed)) return;
      const active = await chooseMonitor(clientRectToFrameRect(rect, insets)); if (!isCurrent(observed)) return;
      currentMonitorValue = active;
      const target = targetBounds(prefs, active, insets).rect;
      if (!await placeControl(target, observed) || !isCurrent(observed)) return;
      await applyClientBounds(target, active, observed);
    })().catch(() => undefined);
  });
  cleanups.push(onMoved, onResized, onScale);
  const onControlEdit = await listen('compact://edit', () => { void showEdit(); });
  const onResetPosition = await listen('compact://reset-position', () => { void (async () => {
    const observed = ++generation, active = await chooseMonitor(); if (!isCurrent(observed)) return;
    currentMonitorValue = active;
    await applyPreferences({ ...prefs, monitorKey: active.key, anchorX: 1, anchorY: 1, placement: 'snapped', snapEdge: 'bottom' }, true);
  })().catch(() => undefined); });
  const onResetSize = await listen('compact://reset-size', () => { void applyPreferences({ ...prefs, sourceWidth: 640, sourceHeight: 160 }, true).catch(() => undefined); });
  const onQuit = await listen('shell://quit', () => { void exit('quit_app'); }), onRelaunch = await listen('shell://relaunch', () => { void exit('relaunch_app'); });
  cleanups.push(onControlEdit, onResetPosition, onResetSize, onQuit, onRelaunch);
  const onPrefs = (event: Event): void => { const detail = (event as CustomEvent<CompactPrefs>).detail; if (detail) void applyPreferences(detail, true).catch(() => undefined); };
  window.addEventListener('compact-prefs-change', onPrefs); cleanups.push(() => window.removeEventListener('compact-prefs-change', onPrefs));
  const recoveryObserver = recovery || legacyNotice ? new MutationObserver(() => { void updateInputPolicy(); }) : undefined;
  recoveryObserver?.observe(recovery!, { attributes: true, attributeFilter: ['hidden'] });
  if (legacyNotice) recoveryObserver?.observe(legacyNotice, { attributes: true, attributeFilter: ['hidden'] });
  if (recoveryObserver) cleanups.push(() => recoveryObserver.disconnect());
  hooks.setQuit(() => { void exit('quit_app'); });
  await updateInputPolicy();
  const initialRect = await bounds(), initialInsets = await frameInsets();
  currentMonitorValue = await chooseMonitor(clientRectToFrameRect(initialRect, initialInsets));
  const allMonitors = await monitors();
  const savedMonitor = allMonitors.find(monitor => monitor.key === prefs.monitorKey);
  if (savedMonitor) currentMonitorValue = savedMonitor;
  await applyPreferences(prefs, false);
  if (presentation.welcomeOpen) await applyPresentationState(presentation);
  await win.show(); if (!presentation.welcomeOpen) await controls.show();
  async function poll(): Promise<void> {
    if (stopped) return;
    const observed = generation;
    try {
      if (gesture !== 'idle') throw new Error('gesture active');
      const rect = await bounds(); if (!isCurrent(observed) || gesture !== 'idle') return schedulePoll();
      const insets = await frameInsets(); if (!isCurrent(observed) || gesture !== 'idle') return schedulePoll();
      const frameRect = clientRectToFrameRect(rect, insets), active = await chooseMonitor(frameRect);
      if (!isCurrent(observed) || gesture !== 'idle') return schedulePoll();
      currentMonitorValue = active;
      if (presentation.welcomeOpen && acceptedEnvironment !== environmentKey(active)) {
        void applyPresentationState(presentation).catch(() => undefined); return schedulePoll();
      }
      const area = clientWorkArea(active, insets);
      if (!isContained(frameRect, active.workArea)) {
        const constrained = constrainCompactRect(rect, area);
        if (!await placeControl(constrained, observed) || !isCurrent(observed) || gesture !== 'idle') return schedulePoll();
        await applyClientBounds(constrained, active, observed);
      }
      schedulePoll();
    } catch { schedulePoll(); }
  }
  function schedulePoll(): void { if (!stopped) pollTimer = window.setTimeout(() => { void poll(); }, Math.max(500, CONFIG.desktop.monitorPollMs * 2)); }
  void poll();
  return () => { stopped = true; generation += 1; clearTimeout(settleTimer); clearTimeout(pollTimer); hooks.setQuit(null); for (const off of cleanups) off(); };
}
