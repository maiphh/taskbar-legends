import './style.css';
import { CONFIG, TICK_MS, activeV14Rules, setV14Rules, v14RuleSchema } from './config';
import { audio } from './audio';
import { cheapestEquippedUpgrade } from './core/economy';
import { createPartyState, createState, input, load, snapshot, statusText, step } from './core/game';
import { cloneState, parseAction } from './core/model';
import { bindInput } from './input';
import { applyOffline, resumeSave } from './core/save';
import type { WelcomeData } from './pixel-ui';
import { raritySchema } from './config';
import { localSaveStore } from './platform/storage';
import { Renderer } from './renderer';
import type { GameDebug } from './debug';
import type { HitRegion } from './renderer';
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
// v1.4 preview: `?v14=chestChoice,farmChest` (or `?v14=all`) switches implemented v1.4 rules on for this page. Off by default (1.3.0).
const query = new URLSearchParams(location.search);
const partyV2Preview = query.get('combat') === 'party-v2';
const compactPreview = partyV2Preview && query.get('compact') === '1';
/** Shot harness only (`?shot&menu=native`): render the 760×560 native-window variant in the page to compare it with its mockups. */
const nativeMenuShot = compactPreview && query.has('shot') && query.get('menu') === 'native';
const v14Param = query.get('v14');
if (v14Param) setV14Rules(v14Param === 'all' ? v14RuleSchema.options : v14Param.split(',').filter(rule => v14RuleSchema.safeParse(rule).success).map(rule => v14RuleSchema.parse(rule)));
const canvas = element('game'); if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing canvas');
const notice = element('notice'), liveStatus = element('live-status');
const recovery = element('save-recovery'), exportFailed = element('export-failed-save') as HTMLButtonElement, discardFailed = element('discard-failed-save') as HTMLButtonElement;
const recoveryTitle = element('save-recovery-title'), recoveryDescription = element('recovery-description'), recoveryStatus = element('recovery-status');
const renderer = new Renderer(canvas, element('controls'));
let compactPrefs: CompactPrefs | null = compactPreview ? readCompactPrefs() : null;
if (compactPreview && compactPrefs) { document.body.classList.add('compact-preview'); renderer.setCompactViewport(true, compactPrefs.zoom); }
const newSelectedState = (seed = 1) => partyV2Preview ? createPartyState(seed, { starterGear: true }) : createState(seed);
let state = newSelectedState(), paused = false, accumulatorMs = 0, hidden = document.hidden;
const managementAuthority = new ManagementAuthority(state, paused, next => { state = next; render(); });
function replaceSelectedState(next: typeof state): void { managementAuthority.replaceState(next); }
function setCompactSettings(next: CompactPrefs): void {
  if (!compactPreview) return;
  compactPrefs = parseCompactPrefs(next); writeCompactPrefs(compactPrefs);
  renderer.setCompactViewport(true, compactPrefs.zoom); resize();
  window.dispatchEvent(new CustomEvent('compact-prefs-change', { detail: compactPrefs }));
}
const managementRoot = element('management'), compactMenu = element('compact-menu-bar');
let managementView: ManagementView | null = null, internalRequest = 0;
let lastFrame = performance.now(), lastSave = lastFrame, noticeUntil = 0;
const showNotice = (message: string): void => { notice.textContent = message; noticeUntil = performance.now() + 7000; };
const store = localSaveStore(partyV2Preview ? `${CONFIG.runtime.saveKey}:party-v2` : CONFIG.runtime.saveKey);
if (partyV2Preview && !compactPreview) {
  document.title = 'Taskbar Legends — Party v2 Preview';
  canvas.setAttribute('aria-label', 'Party v2 preview: tank, melee damage dealer, and healer approach and fight enemies');
  showNotice('Party v2 preview · isolated save; the normal account is unchanged.');
}
if (compactPreview) {
  compactMenu.hidden = false;
  // #app clips the lane (overflow:hidden); the docked panel sits beside it, so it is hosted on <body>.
  if (!('__TAURI_INTERNALS__' in window)) document.body.append(managementRoot);
  canvas.setAttribute('aria-label', 'Compact party preview: a movable battlefield. Use Menu for management or Edit to move and resize.');
}
function managementClient(): ManagementClient {
  return {
    snapshot: async () => managementAuthority.snapshot(),
    execute: async (value, revision, requestId) => value.type === 'pullMany'
      ? managementAuthority.executeManyPulls({ clientId: `browser:${requestId.split(':')[0] ?? 'view'}`, requestId, expectedRevision: revision, count: value.count })
      : managementAuthority.execute({ clientId: `browser:${requestId.split(':')[0] ?? 'view'}`, requestId, expectedRevision: revision, action: value }),
    compare: async (heroId, gearId) => managementAuthority.compareGear(heroId, gearId),
    pause: async value => { paused = value; managementAuthority.setPaused(value); lastFrame = performance.now(); render(); }, close: () => undefined,
    getAudio: async () => audio.settings(), setAudio: async value => { audio.set(value); renderer.ui.audio = audio.settings(); render(); },
    getCompactPrefs: async () => compactPrefs ?? readCompactPrefs(), setCompactPrefs: async value => setCompactSettings(value),
    cue: key => { audio.play(key); },
  };
}
const MENU_TOKENS = CONFIG.ui.compactMenu.browser;
/**
 * Browser dock (compact-menu.md §5): the PARTY CAMP panel sits 8 px above the lane when the viewport has room for
 * lane + gap + panel (the lane is then bottom-anchored, like the native window at the taskbar), otherwise directly below
 * it. Width is W-16 (624 at W=640), 720 once W ≥ 736; it never overlaps the lane.
 */
function dockManagement(): void {
  if (!compactPreview || '__TAURI_INTERNALS__' in window) return;
  if (nativeMenuShot) { managementRoot.style.left = '0px'; managementRoot.style.top = '0px'; return; }
  const app = element('app'), laneHeight = app.getBoundingClientRect().height, [, , , panelHeight = 400] = MENU_TOKENS.panel, gap = MENU_TOKENS.gapPx;
  // The side is chosen once per open (§5: the window resizes once; switching tabs or the one-shot growth never re-docks).
  const above = openDock?.above ?? window.innerHeight >= laneHeight + gap + panelHeight;
  document.body.classList.toggle('compact-dock-above', above);
  // W is the page viewport (the browser stand-in for the compact window): 624 at 640, 720 from 736 up.
  const lane = app.getBoundingClientRect(), width = window.innerWidth >= 736 ? 720 : Math.max(MENU_TOKENS.panelSize[0] ?? 624, window.innerWidth - 16);
  // Below keeps the 8 px gap (window 640×568, top edge fixed, bottom grows — see growForDock); never collapse the gap.
  const top = above ? lane.top - gap - panelHeight : lane.bottom + gap;
  managementRoot.style.setProperty('--px-panel-w', `${width}px`);
  // Document coordinates (the panel lives on <body>): a viewport too short for lane + panel scrolls instead of overlapping.
  managementRoot.style.left = `${Math.round(window.scrollX + Math.max(0, Math.min(lane.left + 8, window.innerWidth - width - 8)))}px`; managementRoot.style.top = `${Math.round(window.scrollY + top)}px`;
  managementRoot.dataset.dock = above ? 'above' : 'below';
}
/** Dock side and one-shot window growth for the open panel; null while the panel is closed. */
let openDock: { above: boolean; grewBy: number } | null = null;
/**
 * Window on open is lane + 8 + panel (640×568, compact-menu.md §5). Docked below, the top edge stays fixed and the bottom
 * grows once by the shortfall, so the page never scrolls; close restores it once. `resizeBy` is honoured by standalone /
 * script-opened windows; `data-window-height` publishes the requested client height for hosts (and the shot harness)
 * that size the window themselves.
 */
function growForDock(): void {
  if (!compactPreview || '__TAURI_INTERNALS__' in window || nativeMenuShot || openDock) return;
  const laneHeight = element('app').getBoundingClientRect().height, [, , , panelHeight = 400] = MENU_TOKENS.panel, need = Math.ceil(laneHeight + MENU_TOKENS.gapPx + panelHeight);
  const above = window.innerHeight >= need, grewBy = above ? 0 : Math.max(0, need - window.innerHeight);
  openDock = { above, grewBy };
  if (grewBy > 0) { try { window.resizeBy(0, grewBy); } catch { /* not resizable from script */ } managementRoot.dataset.windowHeight = String(need); }
}
function shrinkAfterDock(): void {
  if (!openDock) return;
  const { grewBy } = openDock; openDock = null; delete managementRoot.dataset.windowHeight;
  if (grewBy > 0) { try { window.resizeBy(0, -grewBy); } catch { /* not resizable from script */ } }
}
/** Compact HUD buttons follow the lane's source-pixel scale (zoom / devicePixelRatio). */
function syncCompactScale(): void {
  if (!compactPreview) return;
  const z = (compactPrefs?.zoom ?? 1) / (window.devicePixelRatio || 1);
  element('app').style.setProperty('--px-z', String(z));
}
/** DOM controls that receive input in the compact lane (Menu/Edit, edit handles) and the docked panel, in client CSS px. */
function domHitRegions(): HitRegion[] {
  if (!compactPreview) return [];
  const regions: HitRegion[] = [];
  const add = (node: Element, kind: HitRegion['kind'], id: string) => { const box = node.getBoundingClientRect(); if (box.width > 0 && box.height > 0) regions.push({ kind, id, x: box.left, y: box.top, width: box.width, height: box.height }); };
  for (const node of document.querySelectorAll('#compact-menu-bar:not([hidden]) button, #edit-overlay:not([hidden]) button')) if (!(node as HTMLElement).hidden) add(node, 'hud', node.id);
  if (!managementRoot.hidden) add(managementRoot, 'panel', 'management');
  return regions;
}
function openManagement(): void {
  if (!compactPreview) { renderer.ui.setPanel('heroes'); return; }
  if (!managementView) managementView = new ManagementView(managementRoot, managementClient(), () => { managementRoot.hidden = true; shrinkAfterDock(); element('compact-menu-button').setAttribute('aria-expanded', 'false'); element('compact-menu-button').focus(); }, { variant: nativeMenuShot ? 'native' : 'browser', atlas: renderer.atlases, clock: () => renderer.ui.clock() });
  if (managementRoot.hidden) growForDock();
  dockManagement(); managementRoot.hidden = false; element('compact-menu-button').setAttribute('aria-expanded', 'true'); void managementView.open();
}
function setEditing(value: boolean): void {
  const overlay = document.getElementById('edit-overlay'); if (overlay) overlay.toggleAttribute('hidden', !value);
  // Done takes Edit's rect while editing (compact-menu.md §2.3); the lane draws the gold/ink HUD-band frame.
  element('compact-edit-button').hidden = value; element('compact-edit-button').setAttribute('aria-pressed', String(value));
  renderer.ui.compactEditing = value; render();
  if (!value && document.activeElement?.closest('#edit-overlay')) element('compact-edit-button').focus();
}
element('compact-menu-button').addEventListener('click', openManagement);
element('compact-edit-button').addEventListener('click', () => setEditing(document.getElementById('edit-overlay')?.hasAttribute('hidden') ?? false));
element('edit-done').addEventListener('click', () => setEditing(false));
let restoring = false;
let failedSave = false;
async function restore(): Promise<void> {
  restoring = true;
  try {
    const data = await store.load();
    if (data && (data.state.combatRules ?? 'legacy') !== (partyV2Preview ? 'party-v2' : 'legacy')) {
      throw new Error(`This save uses ${data.state.combatRules ?? 'legacy'} rules; open the matching gameplay URL to load it.`);
    }
    if (data) { const saved = resumeSave(data, Date.now()); replaceSelectedState(saved.state); accumulatorMs = saved.remainderMs;
      if (saved.seconds >= 1) { renderer.ui.showWelcome(welcomeData(saved, data.state.eventSeq));
        if (!renderer.ui.welcome) showNotice(`Away ${Math.floor(saved.seconds / 60)}m · +${saved.gold} gold · ${saved.clears} clears${saved.capped ? ' (8h cap)' : ''}`); }
    }
    if (failedSave) {
      // A transient read failure is recoverable only after a full successful decode/resume. Keep the loaded state intact.
      failedSave = false; recovery.hidden = true;
      recoveryTitle.textContent = 'Save could not be loaded';
      recoveryDescription.textContent = 'The original save is preserved when readable. Export it for recovery, or discard it to start fresh. Autosaving is paused until you choose.';
      recoveryStatus.textContent = '';
    }
  } catch (error) {
    failedSave = true;
    recoveryTitle.textContent = 'Save could not be loaded';
    recoveryDescription.textContent = 'The original save is preserved when readable. Export it for recovery, or discard it to start fresh. Autosaving is paused until you choose.';
    recoveryStatus.textContent = '';
    exportFailed.disabled = false;
    discardFailed.textContent = 'Discard save and start fresh';
    recovery.hidden = false;
    showNotice(`Save unavailable or incompatible. Autosaving paused; ${error instanceof Error ? error.message : 'use the save recovery controls.'}`);
  }
  finally { restoring = false; render(); }
}
void restore();
/** Welcome-back data: the offline result plus the farm stage, the best item rolled and the choices waiting. */
function welcomeData(result: ReturnType<typeof applyOffline>, beforeSeq: number): WelcomeData {
  let best: WelcomeData['best'] = null;
  const consider = (rarity: (typeof raritySchema.options)[number], slot: string): void => { if (!best || raritySchema.options.indexOf(rarity) > raritySchema.options.indexOf(best.rarity)) best = { rarity, slot }; };
  for (const event of state.events) if (event.seq > beforeSeq && event.data.type === 'gear') consider(event.data.rarity, event.data.slot);
  for (const pair of state.pendingChoice ?? []) for (const item of pair) if (item.acquiredAt.tick === state.tick) consider(item.rarity, item.slot);
  return { ...result, stage: Math.max(1, state.highestCleared), best, choices: activeV14Rules().includes('chestChoice') && result.chests ? state.pendingChoice?.length ?? 0 : 0 };
}
function save(): void {
  if (restoring || failedSave) return;
  store.save({ state, savedAtMs: Date.now(), remainderMs: accumulatorMs })
    .catch(() => { showNotice('Save failed: storage unavailable/full. Export __game.snapshot().'); });
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
    showNotice('Failed save discarded. A fresh save has started.'); render();
  }).catch(() => { recoveryStatus.textContent = 'Could not discard the failed save; it remains protected.'; });
});
let rendering = false;
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
  if (compactPreview) {
    const reply = managementAuthority.execute({ clientId: 'battlefield-keyboard', requestId: `key:${++internalRequest}`, expectedRevision: managementAuthority.snapshot().revision, action: value });
    if (!reply.accepted) showNotice(reply.reason ?? 'Action unavailable.');
    state = managementAuthority.getState(); render(); return;
  }
  input(state, parseAction(value)); render();
}
function togglePause(): void { paused = !paused; managementAuthority.setPaused(paused); lastFrame = performance.now(); render(); }
function resize(): void {
  const native = '__TAURI_INTERNALS__' in window;
  const cssWidth = compactPreview && !native && compactPrefs ? compactPrefs.sourceWidth * compactPrefs.zoom / (window.devicePixelRatio || 1) : window.innerWidth;
  if (compactPreview && !native && compactPrefs) document.getElementById('app')!.style.width = `${cssWidth}px`;
  renderer.resize(cssWidth); syncCompactScale(); dockManagement(); render();
}
renderer.ui.onAction = action; renderer.ui.onPause = togglePause; renderer.ui.onLayoutChange = resize; renderer.ui.onRedraw = render;
renderer.ui.onCue = key => { audio.play(key); };
renderer.ui.audio = audio.settings();
renderer.ui.onAudio = change => { audio.set(change); renderer.ui.audio = audio.settings(); render(); };
bindInput({ action, togglePause, cheapestUpgrade: () => { const item = cheapestEquippedUpgrade(state); if (item) action({ type: 'upgrade', gearId: item.id }); } });
void startManagementBridge(managementAuthority, {
  audio: () => audio.settings(),
  setAudio: value => { audio.set(value); renderer.ui.audio = audio.settings(); render(); },
  setPaused: value => { paused = value; managementAuthority.setPaused(value); lastFrame = performance.now(); render(); },
  compactPrefs: () => compactPrefs ?? readCompactPrefs(), setCompactPrefs: value => setCompactSettings(parseCompactPrefs(value)),
}).then(stop => window.addEventListener('pagehide', stop, { once: true })).catch(error => showNotice(`Management bridge unavailable: ${String(error)}`));
window.addEventListener('resize', resize); resize();
window.addEventListener('pagehide', () => { if (!hidden) save(); audio.dispose(); managementView?.dispose(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); else void restore(); hidden = document.hidden; lastFrame = performance.now(); render(); });
const debug: GameDebug = {
  getState: () => cloneState(state),
  step: (ticks = 1) => { if (!paused) throw new Error('Pause before stepping'); step(state, ticks); render(); return cloneState(state); },
  pause: () => { paused = true; managementAuthority.setPaused(true); render(); }, resume: () => { paused = false; managementAuthority.setPaused(false); lastFrame = performance.now(); render(); }, isPaused: () => paused,
  input: value => { action(value); return cloneState(state); },
  setSeed: seed => { replaceSelectedState(newSelectedState(seed)); renderer.ui.resetHistory(); accumulatorMs = 0; paused = true; managementAuthority.setPaused(true); render(); return cloneState(state); },
  snapshot: () => snapshot(state),
  load: value => {
    const next = load(value), expected = partyV2Preview ? 'party-v2' : undefined;
    if (next.combatRules !== expected) throw new Error(`Snapshot rules mismatch: expected ${expected ?? 'legacy'}; got ${next.combatRules ?? 'legacy'}.`);
    replaceSelectedState(next); renderer.ui.resetHistory(); accumulatorMs = 0; lastFrame = performance.now(); render(); return cloneState(state);
  },
  getEvents: () => structuredClone(state.events), getHitRegions: () => [...renderer.getHitRegions(), ...domHitRegions()], getManagementReveal: () => managementView?.revealState() ?? null, getLayout: () => renderer.getLayout(),
  getCombatProjection: (source = state) => renderer.getCombatProjection(source),
  openPanel: tab => renderer.ui.setPanel(tab),
  whenReady: () => Promise.all([renderer.atlases.ready, renderer.ui.ready]).then(() => { render(); }),
  getAssetErrors: () => [...renderer.atlases.errors, ...renderer.ui.errors],
  setV14Rules: rules => { setV14Rules(rules); render(); return activeV14Rules(); }, getV14Rules: () => activeV14Rules(),
  // M3 presentation hooks for shots/tests: freeze the reveal/welcome clock, read audio state, simulate an absence.
  freezeClock: ms => { renderer.ui.clock = ms === null ? () => performance.now() : () => ms; render(); },
  getAudio: () => audio.debug(),
  away: ms => { const beforeSeq = state.eventSeq, result = applyOffline(state, ms); renderer.ui.showWelcome(welcomeData(result, beforeSeq)); render(); return { ...result }; },
};
window.__game = debug;
if (import.meta.env.DEV) window.__management = {
  snapshot: () => managementAuthority.snapshot(),
  execute: (value: unknown) => managementAuthority.execute(value),
  compare: (heroId: string, gearId: string) => managementAuthority.compareGear(heroId, gearId),
};
void startDesktop(debug, resize, { flushSave: () => { if (!hidden) save(); }, setQuit: handler => renderer.ui.setQuitHandler(handler) }, {
  compact: compactPreview, setEditing,
}).catch(error => showNotice(`Desktop shell failed: ${String(error)}`));
if (new URLSearchParams(location.search).has('shot')) document.body.classList.add('shot');
void debug.whenReady().then(() => { if (debug.getAssetErrors().length) showNotice('Some UI/art unavailable; see __game.getAssetErrors().'); });
function frame(now: number): void {
  if (!paused && !hidden) {
    accumulatorMs += Math.min(Math.max(0, now - lastFrame), CONFIG.idle.offlineCapHours * 3_600_000);
    const ticks = Math.floor(accumulatorMs / TICK_MS); if (ticks > 0) { step(state, ticks); accumulatorMs -= ticks * TICK_MS; }
  }
  lastFrame = now; audio.consume(state.events); render();
  if (!hidden && now - lastSave >= CONFIG.runtime.autosaveSeconds * 1000) { save(); lastSave = now; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

declare global { interface Window { __management?: { snapshot(): ReturnType<typeof managementAuthority.snapshot>; execute(value: unknown): ReturnType<typeof managementAuthority.execute>; compare(heroId: string, gearId: string): ReturnType<typeof managementAuthority.compareGear> } } }
