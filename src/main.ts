import './style.css';
import { CONFIG, TICK_MS, activeSalvageRules, activeV14Rules, parseV14Flag, setSalvageRules, setV14Rules } from './config';
import { audio } from './audio';
import { cheapestEquippedUpgrade } from './core/economy';
import { salvageToast } from './salvage-copy';
import { createState, load, snapshot, statusText, step } from './core/game';
import { cloneState } from './core/model';
import { bindInput } from './input';
import { applyOffline } from './core/save';
import { RestoreCoordinator, RestorePhaseError } from './core/restore-coordinator';
import { SaveTimestamp } from './core/save-timestamp';
import type { WelcomeData } from './pixel-ui';
import { raritySchema } from './config';
import { localSaveStore } from './platform/storage';
import { Renderer } from './renderer';
import type { GameDebug } from './debug';
import type { HitRegion } from './renderer';
import type { Action } from './core/model';
import { startDesktop } from './platform/desktop/tauri';
import { ManagementAuthority } from './management/authority';
import { ManagementView } from './management/view';
import type { ManagementClient } from './management/view';
import { readCompactPrefs, writeCompactPrefs } from './platform/compact-prefs';
import { parseCompactPrefs } from './platform/desktop/compact-geometry';
import type { CompactPrefs } from './platform/desktop/compact-geometry';
import { startManagementBridge } from './platform/desktop/management-bridge';

function element(id: string): HTMLElement {
  const value = document.getElementById(id); if (!value) throw new Error(`Missing UI element ${id}`); return value;
}
const query = new URLSearchParams(location.search);
setV14Rules(parseV14Flag(query.get('v14')));
setSalvageRules(query.get('salvage') === 'off' ? 'default' : 'design');
/** Shot harness only (`?shot&menu=native`): exercise the native management presentation inside the browser. */
const nativeMenuShot = query.has('shot') && query.get('menu') === 'native';
const canvas = element('game'); if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing canvas');
const notice = element('notice'), liveStatus = element('live-status');
const recovery = element('save-recovery'), exportFailed = element('export-failed-save') as HTMLButtonElement, discardFailed = element('discard-failed-save') as HTMLButtonElement;
const recoveryTitle = element('save-recovery-title'), recoveryDescription = element('recovery-description'), recoveryStatus = element('recovery-status');
const legacyNotice = element('legacy-save-notice'), exportLegacy = element('export-legacy-save') as HTMLButtonElement, legacyExportStatus = element('legacy-export-status');
const renderer = new Renderer(canvas, element('controls'));
let compactPrefs: CompactPrefs = readCompactPrefs();
document.body.classList.add('compact-shell'); renderer.setCompactViewport(true, compactPrefs.zoom);
const newSelectedState = (seed = 1) => createState(seed);
let state = newSelectedState(), paused = false, accumulatorMs = 0, hidden = document.hidden;
let restoring = false, failedSave = false, checkpointBlocked = false, rendering = false;
const managementAuthority = new ManagementAuthority(state, paused, next => { state = next; render(); });
managementAuthority.setAvailable(false);
function replaceSelectedState(next: typeof state): void { managementAuthority.replaceState(next); }
function setCompactSettings(next: CompactPrefs): void {
  compactPrefs = parseCompactPrefs(next); writeCompactPrefs(compactPrefs);
  renderer.setCompactViewport(true, compactPrefs.zoom); resize();
  window.dispatchEvent(new CustomEvent('compact-prefs-change', { detail: compactPrefs }));
}
const managementRoot = element('management'), compactMenu = element('compact-menu-bar');
let managementView: ManagementView | null = null, internalRequest = 0;
let lastFrame = performance.now(), lastSave = lastFrame, noticeUntil = 0;
const showNotice = (message: string): void => { notice.textContent = message; noticeUntil = performance.now() + 7000; };
export const canonicalSaveKey = `${CONFIG.runtime.saveKey}:party-v2`;
const store = localSaveStore(canonicalSaveKey);
const hasCanonicalSave = (() => { try { return localStorage.getItem(canonicalSaveKey) !== null; } catch { return true; } })();
const restoreCoordinator = new RestoreCoordinator(store);
const saveTimestamp = new SaveTimestamp();
try { legacyNotice.hidden = hasCanonicalSave || localStorage.getItem(CONFIG.runtime.saveKey) === null; } catch { legacyNotice.hidden = true; }
exportLegacy.addEventListener('click', () => {
  try {
    const raw = localStorage.getItem(CONFIG.runtime.saveKey);
    if (raw === null) { legacyExportStatus.textContent = 'No previous save is available.'; return; }
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'taskbar-legends-previous-save.json'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000); legacyExportStatus.textContent = 'Previous save exported.';
  } catch { legacyExportStatus.textContent = 'Could not read the previous save; its original key remains unchanged.'; }
});
compactMenu.hidden = false;
if (!('__TAURI_INTERNALS__' in window)) document.body.append(managementRoot);
canvas.setAttribute('aria-label', 'A movable battlefield for your heroes. Use Menu for management or Edit to move and resize.');
function managementClient(): ManagementClient {
  return {
    snapshot: async () => managementAuthority.snapshot(),
    execute: async (value, revision, requestId) => value.type === 'pullMany'
      ? managementAuthority.executeManyPulls({ clientId: `browser:${requestId.split(':')[0] ?? 'view'}`, requestId, expectedRevision: revision, count: value.count })
      : managementAuthority.execute({ clientId: `browser:${requestId.split(':')[0] ?? 'view'}`, requestId, expectedRevision: revision, action: value }),
    compare: async (heroId, gearId) => managementAuthority.compareGear(heroId, gearId),
    pause: async value => { if (hidden || restoring || checkpointBlocked || failedSave) return; paused = value; managementAuthority.setPaused(value); lastFrame = performance.now(); render(); }, close: () => undefined,
    getAudio: async () => audio.settings(), setAudio: async value => { audio.set(value); renderer.ui.audio = audio.settings(); render(); },
    getCompactPrefs: async () => compactPrefs, setCompactPrefs: async value => setCompactSettings(value),
    cue: key => { audio.play(key); },
  };
}
function dockManagement(): void {
  if ('__TAURI_INTERNALS__' in window) return;
  managementRoot.dataset.dock = 'overlay';
  fitManagementOverlay();
}
function fitManagementOverlay(): void {
  if ('__TAURI_INTERNALS__' in window) return;
  const wide = window.innerWidth >= 1280 && window.innerHeight >= 720;
  const width = wide ? 1280 : 960, height = wide ? 720 : Math.min(640, Math.max(600, window.innerHeight));
  const scale = window.innerWidth >= width * 2 && window.innerHeight >= height * 2 ? 2 : 1;
  managementRoot.dataset.preset = wide ? '1280' : '960';
  managementView?.setLayoutPreset(managementRoot.dataset.preset);
  managementRoot.style.setProperty('--px-v2-scale', String(scale));
  managementRoot.style.setProperty('--px-v2-height', `${height}px`);
  managementRoot.style.left = `${Math.floor((window.innerWidth - width * scale) / 2)}px`;
  managementRoot.style.top = `${Math.floor((window.innerHeight - height * scale) / 2)}px`;
}
window.addEventListener('resize', fitManagementOverlay);
fitManagementOverlay();
/** Compact HUD buttons follow the lane's source-pixel scale (zoom / devicePixelRatio). */
function syncCompactScale(): void {
  const z = (compactPrefs?.zoom ?? 1) / (window.devicePixelRatio || 1);
  element('app').style.setProperty('--px-z', String(z));
}
/** DOM controls that receive input in the compact lane (Menu/Edit, edit handles) and the docked panel, in client CSS px. */
function domHitRegions(): HitRegion[] {
  const regions: HitRegion[] = [];
  const add = (node: Element, kind: HitRegion['kind'], id: string) => { const box = node.getBoundingClientRect(); if (box.width > 0 && box.height > 0) regions.push({ kind, id, x: box.left, y: box.top, width: box.width, height: box.height }); };
  for (const node of document.querySelectorAll('#compact-menu-bar:not([hidden]) button, #edit-overlay:not([hidden]) button')) if (!(node as HTMLElement).hidden) add(node, 'hud', node.id);
  if (!managementRoot.hidden) add(managementRoot, 'panel', 'management');
  return regions;
}
function openManagement(tab: 'home' | 'heroes' | 'formation' | 'gear' | 'recruit' | 'stages' | 'settings' | 'party' | 'stash' | 'upgrades' = 'home'): void {
  if (!managementView) managementView = new ManagementView(managementRoot, managementClient(), () => { managementRoot.hidden = true; element('compact-menu-button').setAttribute('aria-expanded', 'false'); element('compact-menu-button').focus(); }, { variant: nativeMenuShot ? 'native' : 'browser', atlas: renderer.atlases, clock: () => renderer.ui.clock() });
  const destination = tab === 'party' ? 'heroes' : tab === 'stash' || tab === 'upgrades' ? 'gear' : tab;
  dockManagement(); managementRoot.hidden = false; element('compact-menu-button').setAttribute('aria-expanded', 'true'); void managementView.open(destination);
}
renderer.ui.onPanelRequest = tab => openManagement(tab === 'heroes' ? 'heroes' : tab === 'gear' ? 'gear' : tab === 'recruit' ? 'recruit' : 'home');
function setEditing(value: boolean): void {
  const overlay = document.getElementById('edit-overlay'); if (overlay) overlay.toggleAttribute('hidden', !value);
  // Done takes Edit's rect while editing (compact-menu.md §2.3); the lane draws the gold/ink HUD-band frame.
  element('compact-edit-button').hidden = value; element('compact-edit-button').setAttribute('aria-pressed', String(value));
  renderer.ui.compactEditing = value; render();
  if (!value && document.activeElement?.closest('#edit-overlay')) element('compact-edit-button').focus();
}
element('compact-menu-button').addEventListener('click', () => openManagement());
element('compact-edit-button').addEventListener('click', () => setEditing(document.getElementById('edit-overlay')?.hasAttribute('hidden') ?? false));
element('edit-done').addEventListener('click', () => setEditing(false));
let restoreTask: Promise<void> | null = null;
function restore(): Promise<void> {
  if (hidden || checkpointBlocked) return Promise.resolve();
  if (restoreTask) { void restoreCoordinator.restore(() => !hidden && !checkpointBlocked); return restoreTask; }
  restoring = true; managementAuthority.setAvailable(false); render();
  const task = (async () => {
    try {
      const outcome = await restoreCoordinator.restore(() => !hidden && !checkpointBlocked);
      if (outcome.kind !== 'restored' || hidden || checkpointBlocked) return;
      const { data, saved } = outcome;
      saveTimestamp.observe(outcome.timestamp, data?.savedAtMs ?? 0);
      if (data && saved) {
        if (data.state.combatRules !== 'party-v2') throw new Error(`The current save at ${canonicalSaveKey} is incompatible and has been preserved for export. It was not overwritten.`);
        // RestoreCoordinator wrote the new state, remainder, and consumed timestamp before it can be exposed here.
        replaceSelectedState(saved.state); accumulatorMs = saved.remainderMs;
        if (saved.seconds >= 1) { renderer.ui.showWelcome(welcomeData(saved, data.state.eventSeq));
          if (!renderer.ui.welcome) showNotice(`Away ${Math.floor(saved.seconds / 60)}m · +${saved.gold} gold · ${saved.clears} clears · ${Math.round(saved.partialClears * 100)}% toward next clear${saved.capped ? ' (8h cap)' : ''}`); }
      }
      if (failedSave) {
        failedSave = false; recovery.hidden = true;
        recoveryTitle.textContent = 'Save could not be loaded';
        recoveryDescription.textContent = 'The original save is preserved when readable. Export it for recovery, or discard it to start fresh. Autosaving is paused until you choose.';
        recoveryStatus.textContent = '';
      }
    } catch (error) {
      if (hidden) return;
      if (error instanceof RestorePhaseError && error.phase === 'checkpoint') {
        checkpointBlocked = true; paused = true; managementAuthority.setPaused(true); managementAuthority.setAvailable(false);
        notice.textContent = 'Idle return could not be saved. Original save is preserved; free storage, then close and reopen the game.'; noticeUntil = Infinity;
      } else {
        failedSave = true;
        recoveryTitle.textContent = 'Save could not be loaded';
        recoveryDescription.textContent = 'The original save is preserved when readable. Export it for recovery, or discard it to start fresh. Autosaving is paused until you choose.';
        recoveryStatus.textContent = '';
        exportFailed.disabled = false; discardFailed.textContent = 'Discard save and start fresh'; recovery.hidden = false;
        showNotice(`Save unavailable or incompatible. Autosaving paused; ${error instanceof Error ? error.message : 'use the save recovery controls.'}`);
      }
    } finally {
      restoring = false;
      managementAuthority.setAvailable(!hidden && !failedSave && !checkpointBlocked);
      lastFrame = performance.now();
      if (!hidden && !failedSave && !checkpointBlocked) lastSave = lastFrame;
      render();
    }
  })();
  restoreTask = task;
  void task.then(() => { if (restoreTask === task) restoreTask = null; }, () => { if (restoreTask === task) restoreTask = null; });
  return task;
}
void restore();
/** Welcome-back data: the offline result plus the farm stage, the best item rolled and the choices waiting. */
function welcomeData(result: ReturnType<typeof applyOffline>, beforeSeq: number): WelcomeData {
  let best: WelcomeData['best'] = null;
  const consider = (rarity: (typeof raritySchema.options)[number], slot: string): void => { if (!best || raritySchema.options.indexOf(rarity) > raritySchema.options.indexOf(best.rarity)) best = { rarity, slot }; };
  for (const event of state.events) if (event.seq > beforeSeq && event.data.type === 'gear') consider(event.data.rarity, event.data.slot);
  for (const pair of state.pendingChoice ?? []) for (const item of pair) if (item.acquiredAt.tick === state.tick) consider(item.rarity, item.slot);
  return { ...result, stage: result.stage, partialClears: result.partialClears, best, choices: activeV14Rules().includes('chestChoice') && result.chests ? state.pendingChoice?.length ?? 0 : 0 };
}
function save(): void {
  if (restoring || failedSave || checkpointBlocked || hidden) return;
  store.save({ state, savedAtMs: saveTimestamp.next(Date.now()), remainderMs: accumulatorMs })
    .catch(() => { showNotice('Save failed: storage unavailable/full. Export __game.snapshot().'); });
}
/** Consume the final visible frame into a durable timestamp before the browser freezes the page. */
function checkpointVisibleTime(): void {
  if (restoring || failedSave || checkpointBlocked) return;
  const now = performance.now();
  if (!paused) {
    accumulatorMs += Math.min(Math.max(0, now - lastFrame), CONFIG.idle.offlineCapHours * 3_600_000);
    const ticks = Math.floor(accumulatorMs / TICK_MS);
    if (ticks > 0) { step(state, ticks); accumulatorMs -= ticks * TICK_MS; }
  }
  lastFrame = now; lastSave = now;
  store.save({ state, savedAtMs: saveTimestamp.next(Date.now()), remainderMs: accumulatorMs }).catch(() => {
    checkpointBlocked = true; paused = true; managementAuthority.setPaused(true); managementAuthority.setAvailable(false);
    notice.textContent = 'Idle return could not be saved. Original save is preserved; free storage, then close and reopen the game.'; noticeUntil = Infinity; render();
  });
}
exportFailed.addEventListener('click', () => {
  try {
    const raw = store.failedRaw();
    if (raw === null) { recoveryStatus.textContent = 'No failed save copy is available to export.'; return; }
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'taskbar-legends-failed-save.json'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    recoveryStatus.textContent = 'Original save exported.';
  } catch { recoveryStatus.textContent = 'Could not read the failed save copy. Storage access is unavailable; its original key remains protected.'; }
});
discardFailed.addEventListener('click', () => {
  void store.discardFailed().then(() => {
    failedSave = false; recovery.hidden = true; replaceSelectedState(newSelectedState()); accumulatorMs = 0; save();
    managementAuthority.setAvailable(!hidden && !checkpointBlocked);
    showNotice('Failed save discarded. A fresh save has started.'); render();
  }).catch(() => { recoveryStatus.textContent = 'Could not discard the failed save; it remains protected.'; });
});
function render(): void {
  if (rendering) return;
  rendering = true;
  try {
  renderer.render(state, paused);
  const status = statusText(state); if (liveStatus.textContent !== status) liveStatus.textContent = status;
  if (performance.now() > noticeUntil) notice.textContent = '';
  } finally { rendering = false; }
}
function action(value: unknown): void {
  if (hidden || restoring || checkpointBlocked || failedSave) return;
  const before = state.eventSeq;
  const reply = managementAuthority.execute({ clientId: 'battlefield-keyboard', requestId: `key:${++internalRequest}`, expectedRevision: managementAuthority.snapshot().revision, action: value as Action });
  if (!reply.accepted) showNotice(reply.reason ?? 'Action unavailable.');
  state = managementAuthority.getState();
  for (const event of state.events) if (event.seq > before && event.data.type === 'salvage') showNotice(salvageToast(event.data));
  render();
}
function togglePause(): void { if (hidden || restoring || checkpointBlocked || failedSave) return; paused = !paused; managementAuthority.setPaused(paused); lastFrame = performance.now(); render(); }
let lastCompactPresentationKey = '';
function announceCompactPresentation(): void {
  const detail = { welcomeOpen: renderer.ui.welcome !== null, sourceHeight: renderer.ui.height() };
  const key = `${detail.welcomeOpen}:${detail.sourceHeight}`;
  if (key === lastCompactPresentationKey) return;
  lastCompactPresentationKey = key;
  window.dispatchEvent(new CustomEvent('compact-presentation-change', { detail }));
}
function resize(): void {
  const native = '__TAURI_INTERNALS__' in window;
  const cssWidth = !native ? compactPrefs.sourceWidth * compactPrefs.zoom / (window.devicePixelRatio || 1) : window.innerWidth;
  if (!native) document.getElementById('app')!.style.width = `${cssWidth}px`;
  renderer.resize(cssWidth); syncCompactScale(); dockManagement(); render(); announceCompactPresentation();
}
renderer.ui.onAction = action; renderer.ui.onPause = togglePause; renderer.ui.onLayoutChange = resize; renderer.ui.onRedraw = render;
renderer.ui.onCue = key => { audio.play(key); };
renderer.ui.audio = audio.settings();
renderer.ui.onAudio = change => { audio.set(change); renderer.ui.audio = audio.settings(); render(); };
bindInput({ action, togglePause, cheapestUpgrade: () => { const item = cheapestEquippedUpgrade(state); if (item) action({ type: 'upgrade', gearId: item.id }); } });
void startManagementBridge(managementAuthority, {
  audio: () => audio.settings(),
  setAudio: value => { audio.set(value); renderer.ui.audio = audio.settings(); render(); },
  setPaused: value => { if (hidden || restoring || checkpointBlocked || failedSave) return; paused = value; managementAuthority.setPaused(value); lastFrame = performance.now(); render(); },
  compactPrefs: () => compactPrefs ?? readCompactPrefs(), setCompactPrefs: value => setCompactSettings(parseCompactPrefs(value)),
}).then(stop => window.addEventListener('pagehide', stop, { once: true })).catch(error => showNotice(`Management bridge unavailable: ${String(error)}`));
window.addEventListener('resize', resize); resize();
window.addEventListener('pagehide', () => { if (!hidden) save(); audio.dispose(); managementView?.dispose(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !hidden) {
    // Freeze authority before saving: a management poll/action must not commit
    // against a state snapshot that is about to be replaced on foreground.
    hidden = true; managementAuthority.setAvailable(false);
    checkpointVisibleTime(); restoreCoordinator.invalidate();
  } else if (!document.hidden && hidden) {
    hidden = false; lastFrame = performance.now(); if (!checkpointBlocked && !failedSave) void restore();
  }
  render();
});
const debug: GameDebug = {
  getState: () => cloneState(state),
  step: (ticks = 1) => { if (hidden || restoring || checkpointBlocked || failedSave) throw new Error('Hidden state or save restoration blocks simulation input'); if (!paused) throw new Error('Pause before stepping'); step(state, ticks); render(); return cloneState(state); },
  pause: () => { if (hidden || restoring || checkpointBlocked || failedSave) return; paused = true; managementAuthority.setPaused(true); render(); }, resume: () => { if (hidden || restoring || checkpointBlocked || failedSave) return; paused = false; managementAuthority.setPaused(false); lastFrame = performance.now(); render(); }, isPaused: () => paused,
  input: value => { action(value); return cloneState(state); },
  setSeed: seed => { if (hidden || restoring || checkpointBlocked || failedSave) throw new Error('Hidden state or save restoration blocks state changes'); replaceSelectedState(newSelectedState(seed)); renderer.ui.resetHistory(); accumulatorMs = 0; paused = true; managementAuthority.setPaused(true); render(); return cloneState(state); },
  snapshot: () => snapshot(state),
  load: value => {
    if (hidden || restoring || checkpointBlocked || failedSave) throw new Error('Hidden state or save restoration blocks state changes');
    const next = load(value);
    if (next.combatRules !== 'party-v2') throw new Error('Snapshot is not a current party save; it was not loaded.');
    replaceSelectedState(next); renderer.ui.resetHistory(); accumulatorMs = 0; lastFrame = performance.now(); render(); return cloneState(state);
  },
  getEvents: () => structuredClone(state.events), getHitRegions: () => [...renderer.getHitRegions(), ...domHitRegions()], getManagementReveal: () => managementView?.revealState() ?? null, getLayout: () => renderer.getLayout(),
  getCombatProjection: (source = state) => renderer.getCombatProjection(source),
  openPanel: tab => { if (tab) openManagement(tab === 'heroes' ? 'heroes' : tab === 'gear' ? 'gear' : tab === 'recruit' ? 'recruit' : tab === 'formation' ? 'formation' : tab === 'stages' ? 'stages' : tab === 'settings' ? 'settings' : 'home'); else managementView?.close(); },
  whenReady: () => Promise.all([renderer.atlases.ready, renderer.ui.ready]).then(() => { render(); }),
  getAssetErrors: () => [...renderer.atlases.errors, ...renderer.ui.errors],
  setV14Rules: rules => { setV14Rules(rules); render(); return activeV14Rules(); }, getV14Rules: () => activeV14Rules(),
  setSalvageRules: rules => { const next = setSalvageRules(rules); render(); return next; }, getSalvageRules: () => activeSalvageRules(),
  // M3 presentation hooks for shots/tests: freeze the reveal/welcome clock, read audio state, simulate an absence.
  freezeClock: ms => { renderer.ui.clock = ms === null ? () => performance.now() : () => ms; render(); },
  getAudio: () => audio.debug(),
  away: ms => { if (hidden || restoring || checkpointBlocked || failedSave) throw new Error('Hidden state or save restoration blocks state changes'); const beforeSeq = state.eventSeq, result = applyOffline(state, ms); renderer.ui.showWelcome(welcomeData(result, beforeSeq)); render(); return { ...result }; },
};
window.__game = debug;
if (import.meta.env.DEV) window.__management = {
  snapshot: () => managementAuthority.snapshot(),
  execute: (value: unknown) => managementAuthority.execute(value),
  compare: (heroId: string, gearId: string) => managementAuthority.compareGear(heroId, gearId),
  freezeAnimation: (frozen: boolean) => managementView?.freezeAnimation(frozen),
};
void startDesktop({ flushSave: () => { if (!hidden) save(); }, setQuit: handler => renderer.ui.setQuitHandler(handler),
  presentationState: () => ({ welcomeOpen: renderer.ui.welcome !== null, sourceHeight: renderer.ui.height() }) }, {
  setEditing,
}).catch(error => showNotice(`Desktop shell failed: ${String(error)}`));
if (new URLSearchParams(location.search).has('shot')) document.body.classList.add('shot');
void debug.whenReady().then(() => { if (debug.getAssetErrors().length) showNotice('Some UI/art unavailable; see __game.getAssetErrors().'); });
function frame(now: number): void {
  if (!paused && !hidden && !restoring && !failedSave && !checkpointBlocked) {
    accumulatorMs += Math.min(Math.max(0, now - lastFrame), CONFIG.idle.offlineCapHours * 3_600_000);
    const ticks = Math.floor(accumulatorMs / TICK_MS); if (ticks > 0) { step(state, ticks); accumulatorMs -= ticks * TICK_MS; }
  }
  lastFrame = now; audio.consume(state.events); render();
  if (!hidden && now - lastSave >= CONFIG.runtime.autosaveSeconds * 1000) { save(); lastSave = now; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

declare global { interface Window { __management?: { snapshot(): ReturnType<typeof managementAuthority.snapshot>; execute(value: unknown): ReturnType<typeof managementAuthority.execute>; compare(heroId: string, gearId: string): ReturnType<typeof managementAuthority.compareGear>; freezeAnimation(frozen: boolean): void } } }
