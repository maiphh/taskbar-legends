import './style.css';
import { CONFIG, TICK_MS } from './config';
import { audio } from './audio';
import { cheapestEquippedUpgrade } from './core/economy';
import { createState, input, load, snapshot, statusText, step } from './core/game';
import { cloneState, parseAction } from './core/model';
import { bindInput } from './input';
import { resumeSave } from './core/save';
import { localSaveStore } from './platform/storage';
import { Renderer } from './renderer';
import type { GameDebug } from './debug';

function element(id: string): HTMLElement {
  const value = document.getElementById(id); if (!value) throw new Error(`Missing UI element ${id}`); return value;
}
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
      if (saved.seconds >= 1) showNotice(`Away ${Math.floor(saved.seconds / 60)}m · +${saved.gold} gold · ${saved.clears} clears${saved.capped ? ' (8h cap)' : ''}`);
    }
  } catch { showNotice('Save unavailable or incompatible. Started fresh; old save retained until next save.'); }
  finally { restoring = false; render(); }
}
void restore();
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
};
window.__game = debug;
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
