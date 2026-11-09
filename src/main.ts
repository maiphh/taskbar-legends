import './style.css';
import { CONFIG, TICK_MS, activeV14Rules, setV14Rules, v14RuleSchema } from './config';
import { audio } from './audio';
import { cheapestEquippedUpgrade } from './core/economy';
import { createState, input, load, snapshot, statusText, step } from './core/game';
import { cloneState, parseAction } from './core/model';
import { bindInput } from './input';
import { applyOffline, resumeSave } from './core/save';
import type { WelcomeData } from './pixel-ui';
import { raritySchema } from './config';
import { localSaveStore } from './platform/storage';
import { Renderer } from './renderer';
import type { GameDebug } from './debug';
import { startDesktop } from './platform/desktop/tauri';

function element(id: string): HTMLElement {
  const value = document.getElementById(id); if (!value) throw new Error(`Missing UI element ${id}`); return value;
}
// v1.4 preview: `?v14=chestChoice,farmChest` (or `?v14=all`) switches implemented v1.4 rules on for this page. Off by default (1.3.0).
const v14Param = new URLSearchParams(location.search).get('v14');
if (v14Param) setV14Rules(v14Param === 'all' ? v14RuleSchema.options : v14Param.split(',').filter(rule => v14RuleSchema.safeParse(rule).success).map(rule => v14RuleSchema.parse(rule)));
const canvas = element('game'); if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing canvas');
const notice = element('notice'), liveStatus = element('live-status');
const renderer = new Renderer(canvas, element('controls'));
let state = createState(1), paused = false, accumulatorMs = 0, hidden = document.hidden;
let lastFrame = performance.now(), lastSave = lastFrame, noticeUntil = 0;
const showNotice = (message: string): void => { notice.textContent = message; noticeUntil = performance.now() + 7000; };
const store = localSaveStore();
let restoring = false;
async function restore(): Promise<void> {
  restoring = true;
  try {
    const data = await store.load();
    if (data) { const saved = resumeSave(data, Date.now()); state = saved.state; accumulatorMs = saved.remainderMs;
      if (saved.seconds >= 1) { renderer.ui.showWelcome(welcomeData(saved, data.state.eventSeq));
        if (!renderer.ui.welcome) showNotice(`Away ${Math.floor(saved.seconds / 60)}m · +${saved.gold} gold · ${saved.clears} clears${saved.capped ? ' (8h cap)' : ''}`); }
    }
  } catch { showNotice('Save unavailable or incompatible. Started fresh; old save retained until next save.'); }
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
  if (restoring) return;
  store.save({ state, savedAtMs: Date.now(), remainderMs: accumulatorMs })
    .catch(() => { showNotice('Save failed: storage unavailable/full. Export __game.snapshot().'); });
}
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
function action(value: unknown): void { input(state, parseAction(value)); render(); }
function togglePause(): void { paused = !paused; lastFrame = performance.now(); render(); }
function resize(): void { renderer.resize(window.innerWidth); render(); }
renderer.ui.onAction = action; renderer.ui.onPause = togglePause; renderer.ui.onLayoutChange = resize; renderer.ui.onRedraw = render;
renderer.ui.onCue = key => { audio.play(key); };
renderer.ui.audio = audio.settings();
renderer.ui.onAudio = change => { audio.set(change); renderer.ui.audio = audio.settings(); render(); };
bindInput({ action, togglePause, cheapestUpgrade: () => { const item = cheapestEquippedUpgrade(state); if (item) action({ type: 'upgrade', gearId: item.id }); } });
window.addEventListener('resize', resize); resize();
window.addEventListener('pagehide', () => { if (!hidden) save(); audio.dispose(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); else void restore(); hidden = document.hidden; lastFrame = performance.now(); render(); });
const debug: GameDebug = {
  getState: () => cloneState(state),
  step: (ticks = 1) => { if (!paused) throw new Error('Pause before stepping'); step(state, ticks); render(); return cloneState(state); },
  pause: () => { paused = true; render(); }, resume: () => { paused = false; lastFrame = performance.now(); render(); }, isPaused: () => paused,
  input: value => { action(value); return cloneState(state); },
  setSeed: seed => { state = createState(seed); renderer.ui.resetHistory(); accumulatorMs = 0; paused = true; render(); return cloneState(state); },
  snapshot: () => snapshot(state),
  load: value => { state = load(value); renderer.ui.resetHistory(); accumulatorMs = 0; lastFrame = performance.now(); render(); return cloneState(state); },
  getEvents: () => structuredClone(state.events), getHitRegions: () => renderer.getHitRegions(), getLayout: () => renderer.getLayout(),
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
void startDesktop(debug, resize, { flushSave: () => { if (!hidden) save(); }, setQuit: handler => renderer.ui.setQuitHandler(handler) }).catch(error => showNotice(`Desktop shell failed: ${String(error)}`));
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
