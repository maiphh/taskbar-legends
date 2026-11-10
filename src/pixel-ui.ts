import { CONFIG, TICK_MS, heroConfig, raritySchema, slotSchema, stageConfig } from './config';
import type { Rarity } from './config';
import { pulseGrowPx } from './motion';
import { FlashLimiter, awayLabel, burstCue, burstStartMs, chestSlot, countUp, highestCard, motes, particles, rewardLabel, singleFrame, tenFrame, welcomeDoneMs } from './reveal-timeline';
import type { CardFace } from './reveal-timeline';
import { BODY, FONT_FILES, HEADING, LINE_BOX, fitSize, fontFor, slotOffsetY } from './font';
import type { AtlasLibrary } from './atlas';
import { bestChoice, cheapestEquippedUpgrade, fortuneMeter, gearScore, heroStats, recruitMeters, upgradeCost } from './core/economy';
import { bossSecondsRemaining, statusText } from './core/game';
import { affordability } from './core/selectors';
import type { Action, GameState, Gear, ItemId } from './core/model';

export type PanelTab = 'heroes' | 'gear' | 'recruit';
const AVAILABLE: Record<PanelTab, string> = { heroes: ': gear upgrade affordable', gear: ': upgrade, better gear or a chest choice available', recruit: ': ticket ready to pull' };
export interface Rect { x: number; y: number; width: number; height: number }
/** Standalone reveal canvas: the expanded Recruit panel size (ui.md §4). */
export const REVEAL_STAGE = { width: CONFIG.ui.expanded.panelWidth, height: CONFIG.ui.expanded.panelHeight, top: 72 } as const;
export interface SourceHitRegion extends Rect { kind: 'hud' | 'panel'; id: string }
interface Control extends Rect { id: string; label: string; disabled: boolean; click(): void; tooltip: string; cardIndex?: number; layer?: number }
/** One recruit result as the reveal shows it (gacha.md §9: badge kind from the post-pull star count, pity from the event). */
export interface RevealPull { heroId: string; rarity: Rarity; pity: boolean; badge: 'new' | 'star' | 'gold'; gold: number }
interface Reveal { count: 1 | 10; pulls: RevealPull[]; startedAt: number; skipped: boolean; cued: boolean; flash: boolean | null }
/** What the welcome-back panel shows: the offline result (already credited) plus the farm stage and best item. */
export interface WelcomeData { seconds: number; rawSeconds: number; capped: boolean; clears: number; gold: number; xp: number; chests: number;
  heroes: readonly { id: string; levelBefore: number; levelAfter: number }[]; expeditionChests?: number; tickets?: number; stage: number;
  best: { rarity: Rarity; slot: string } | null; choices: number }
export interface AudioControls { muted: boolean; volume: number }
const palette = CONFIG.ui.palette;
const feedback = CONFIG.ui.coreLoopFeedback;
/** Text options: `exactY` for specs that give the real Galmuri draw y (otherwise y is a Pixel Operator-era layout slot). */
export interface TextOptions { exactY?: boolean }
const rootUrl = (): URL => new URL(`${import.meta.env.BASE_URL}ui/`, window.location.href);
function short(value: number): string { return value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e4 ? `${(value / 1e3).toFixed(1)}K` : value.toLocaleString('en-US'); }
/** Round half to even, as the designer's rect tables do (e.g. banner x 894.5 -> 894, 887.5 -> 888). */
export function roundHalfEven(value: number): number { const floor = Math.floor(value); return value - floor !== 0.5 ? Math.round(value) : floor % 2 === 0 ? floor : floor + 1; }
function hasPoint(rect: Rect, x: number, y: number): boolean { return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height; }
export class PixelUI {
  panel: PanelTab | null = null;
  private coreY = 0;
  selectedHero = CONFIG.heroes[0]?.id ?? '';
  selectedGear: ItemId | null = null;
  targetSlot = 0;
  private heroRow = 0;
  private gearRow = 0;
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly textCache = new Map<string, HTMLCanvasElement>();
  private measureContext: CanvasRenderingContext2D | null = null;
  private readonly badgeMemory = new Map<string, { on: boolean; pulseTick: number; seen: boolean }>();
  private readonly badgesDrawn = new Set<string>();
  readonly reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly surfaces = new Map<string, HTMLDivElement>();
  private pressed = '';
  private controls = new Map<string, Control>();
  private current: GameState | null = null;
  private width = CONFIG.view.defaultWidth;
  private compactMode = false;
  private sourceHeight = CONFIG.ui.closed.height;
  private scaleToCss = 1;
  private hovered = '';
  private focused = '';
  private hoverAt = 0;
  private pointer = { x: 0, y: 0 };
  private readyFlag = false;
  private pending = false;
  private recruitHistoryOpen = false;
  /** M3: gacha reveal and welcome-back panel (renderer memory only; results are already in the state). */
  private reveal: Reveal | null = null;
  /** Standalone reveal (the DOM management menu hosts its own PixelUI that only draws the reveal for pulls it committed). */
  private standalone = false;
  onRevealAgain: (count: 1 | 10) => void = () => undefined;
  onRevealClose: () => void = () => undefined;
  welcome: WelcomeData | null = null;
  private welcomeAt = 0;
  private welcomeCloseAt: number | null = null;
  private readonly flashes = new FlashLimiter();
  /** Presentation clock; the debug API can freeze it for shots and tests. */
  clock: () => number = () => performance.now();
  /** Audio cue keys (gacha.md §7, offline-rewards.md); main wires these to the audio engine. */
  onCue: (key: string) => void = () => undefined;
  audio: AudioControls = { muted: false, volume: 0.5 };
  onAudio: (change: AudioControls) => void = () => undefined;
  resetHistory(): void { this.history.length = 0; this.lastPullSeq = 0; }
  private lastPullSeq = 0;
  private readonly history: string[] = [];
  readonly errors: string[] = [];
  readonly ready: Promise<void>;
  onAction: (action: Action) => void = () => undefined;
  onPause: () => void = () => undefined;
  onLayoutChange: () => void = () => undefined;
  onRedraw: () => void = () => undefined;
  /** Desktop shell only; the browser build never shows Quit. */
  private quitHandler: (() => void) | null = null;
  setQuitHandler(handler: (() => void) | null): void { this.quitHandler = handler; this.onRedraw(); }
  private quitRect(coreY: number): Rect { return { x: this.width - 80, y: coreY + 12, width: 28, height: 24 }; }
  constructor(private readonly atlas: AtlasLibrary, private readonly overlay: HTMLElement) {
    this.ready = this.load();
    overlay.addEventListener('wheel', event => {
      if (!this.panel) return;
      const bounds = overlay.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / this.scaleToCss, y = (event.clientY - bounds.top) / this.scaleToCss;
      const panel = this.panelRect();
      const viewport = { x: panel.x + 16, y: this.panel === 'heroes' ? 104 : 112, width: this.panel === 'heroes' ? this.rosterColumns() * 96 + 8 : 392, height: 248 };
      if (!hasPoint(viewport, x, y) || this.panel === 'recruit') return;
      event.preventDefault();
      const delta = event.deltaY > 0 ? 1 : -1;
      if (this.panel === 'heroes') this.heroRow = Math.max(0, Math.min(Math.ceil(CONFIG.heroes.length / this.rosterColumns()) - 3, this.heroRow + delta));
      else this.gearRow = Math.max(0, Math.min(Math.ceil((this.current?.inventory.length ?? 0) / this.gearColumns()) - 5, this.gearRow + delta));
      this.onRedraw();
    }, { passive: false });
    window.addEventListener('keydown', event => {
      if (this.welcome && (event.code === 'Escape' || event.code === 'Enter')) { event.preventDefault(); this.collect(); return; }
      if (this.reveal && (this.panel === 'recruit' || this.standalone) && (event.code === 'Enter' || event.code === 'Space' || event.code === 'NumpadEnter')) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (this.revealMs() < Infinity && !this.revealDone()) this.skipReveal(); else if (event.code !== 'Space') this.finishReveal(true);
        return;
      }
      if (event.code === 'Escape' && this.panel) { event.preventDefault(); this.setPanel(null); }
      if (this.panel !== 'heroes' || !(event.target instanceof HTMLButtonElement) || event.target.dataset.cardIndex === undefined) return;
      const deltas: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -this.rosterColumns(), ArrowDown: this.rosterColumns() };
      const delta = deltas[event.key];
      if (delta === undefined && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      const old = Number(event.target.dataset.cardIndex);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? CONFIG.heroes.length - 1 : Math.max(0, Math.min(CONFIG.heroes.length - 1, old + (delta ?? 0)));
      const hero = CONFIG.heroes[next]; if (!hero) return;
      this.selectedHero = hero.id;
      const row = Math.floor(next / this.rosterColumns());
      if (row < this.heroRow) this.heroRow = row;
      if (row >= this.heroRow + 3) this.heroRow = row - 2;
      this.onRedraw(); this.buttons.get(`hero-${hero.id}`)?.focus();
    });
  }
  private async load(): Promise<void> {
    try {
      await Promise.all(FONT_FILES.map(async ([name, file]) => {
        const font = new FontFace(name, `url(${new URL(`${import.meta.env.BASE_URL}fonts/${file}`, window.location.href).href})`);
        await font.load(); document.fonts.add(font);
      }));
      await document.fonts.ready;
      const files = ['panel-9slice.png', 'button-9slice.png', 'button-hover-9slice.png', 'button-pressed-9slice.png', 'button-disabled-9slice.png', 'icon-sword.png', 'icon-armor.png', 'icon-chest.png', 'icon-potion.png', 'icon-gold.png'];
      await Promise.all(files.map(async file => { const image = new Image(); image.src = new URL(file, rootUrl()).href; await image.decode(); this.images.set(file, image); }));
      this.readyFlag = true;
    } catch (error) { this.errors.push(String(error)); }
  }
  setPanel(tab: PanelTab | null): void {
    const wasOpen = this.isOpen();
    // Closing or switching tabs mid-reveal is an implicit skip (gacha.md §6); results are already saved.
    if (this.reveal && tab !== 'recruit') { if (!this.revealDone()) this.skipReveal(true); this.reveal = null; }
    if (this.panel && !tab) this.onCue(CONFIG.ui.gacha.audio.close); else if (tab && !this.panel) this.onCue(CONFIG.ui.gacha.audio.open);
    if (tab && this.welcome) this.welcome = null;
    this.panel = tab;
    if (wasOpen !== this.isOpen()) this.onLayoutChange(); else this.onRedraw();
  }
  isOpen(): boolean { return this.panel !== null || this.welcome !== null; }
  /** Welcome back (offline-rewards.md): shows when ≥ 60 s away and something was credited; Collect only acknowledges. */
  showWelcome(data: WelcomeData): void {
    const spec = CONFIG.ui.offlineRewards;
    if (data.rawSeconds < spec.minSecondsToShow || (data.gold === 0 && data.xp === 0 && data.chests === 0 && !data.tickets)) return;
    const wasOpen = this.isOpen();
    if (this.reveal) this.reveal = null;
    this.panel = null; this.welcome = data; this.welcomeAt = this.clock(); this.welcomeCloseAt = null; this.onCue(CONFIG.ui.gacha.audio.open);
    if (!wasOpen) this.onLayoutChange(); else this.onRedraw();
  }
  private welcomeMs(): number { return this.clock() - this.welcomeAt; }
  private collect(): void {
    const welcome = this.welcome; if (!welcome || this.welcomeCloseAt !== null) return;
    const ready = this.reducedMotion || this.welcomeMs() >= welcomeDoneMs(welcome.expeditionChests ?? welcome.chests);
    this.onCue(CONFIG.ui.gacha.audio.click);
    if (ready) { this.onCue(CONFIG.ui.gacha.audio.close); this.closeWelcome(); return; }
    // Counting: snap every value to its total, hold 240 ms so the totals are visible, then close.
    this.welcomeAt = this.clock() - 1e9; this.welcomeCloseAt = this.clock() + CONFIG.ui.offlineRewards.countUp.collectSnapHoldMs; this.onRedraw();
  }
  private closeWelcome(): void { this.welcome = null; this.welcomeCloseAt = null; this.onLayoutChange(); }
  /** Starts a recruit reveal from the pull events the sim just emitted (the reveal is presentation only). */
  private startRecruit(count: 1 | 10): void {
    const state = this.current; if (!state || this.reveal && !this.revealDone()) return;
    const before = state.eventSeq, stars = new Map(state.roster.map(hero => [hero.id, hero.stars]));
    this.onCue(CONFIG.ui.gacha.audio.click);
    this.pending = true; for (let i = 0; i < count; i += 1) this.onAction({ type: 'pull' }); this.pending = false;
    const now = this.current ?? state, pulls: RevealPull[] = [];
    for (const event of now.events) {
      const data = event.data; if (event.seq <= before || data.type !== 'pull') continue;
      const had = stars.get(data.heroId), gold = Math.round(CONFIG.runtime.duplicateGold * CONFIG.rarity.statMult[data.rarity]);
      const badge = had === undefined ? 'new' : had < CONFIG.growth.starMax ? 'star' : 'gold';
      stars.set(data.heroId, had === undefined ? 1 : Math.min(CONFIG.growth.starMax, had + 1));
      pulls.push({ heroId: data.heroId, rarity: data.rarity, pity: data.pity !== false && data.pity !== null, badge, gold });
    }
    if (!pulls.length) { this.onRedraw(); return; }
    this.reveal = { count, pulls, startedAt: this.clock(), skipped: false, cued: false, flash: null };
    this.onCue(CONFIG.ui.gacha.audio.pull); this.onRedraw();
  }
  private revealMs(): number { return !this.reveal ? 0 : this.reveal.skipped ? Infinity : this.clock() - this.reveal.startedAt; }
  private revealDone(): boolean {
    const reveal = this.reveal; if (!reveal) return true;
    const ms = this.revealMs(), first = reveal.pulls[0];
    return reveal.count === 1 ? !!first && singleFrame(first.rarity, ms, this.reducedMotion).done : tenFrame(reveal.pulls.map(pull => pull.rarity), ms, this.reducedMotion).done;
  }
  /** The pull that plays the burst cue: the single card, or the highest-rarity card of a 10-pull (ties: first). */
  private cuePull(): RevealPull | undefined { const reveal = this.reveal; return reveal ? reveal.pulls[reveal.count === 1 ? 0 : highestCard(reveal.pulls.map(pull => pull.rarity))] : undefined; }
  private skipReveal(silent = false): void {
    const reveal = this.reveal; if (!reveal || reveal.skipped) return;
    if (this.clock() - reveal.startedAt < CONFIG.ui.gacha.skipGuardMs) return;
    reveal.skipped = true;
    if (!silent) this.onCue(CONFIG.ui.gacha.audio.click);
    // The rarity is still heard once: a skip before the burst plays the deferred burst cue, never the flash or shake.
    const pull = this.cuePull(); if (!reveal.cued && pull) { reveal.cued = true; this.onCue(burstCue(pull.rarity, pull.pity)); }
    this.onRedraw();
  }
  private finishReveal(ok: boolean): void { if (ok) { this.onCue(CONFIG.ui.gacha.audio.click); } this.reveal = null; this.onRedraw(); if (this.standalone) this.onRevealClose(); }
  /** Standalone: play the reveal for pulls the caller already committed (badges from the pre-pull star counts). */
  playReveal(count: 1 | 10, pulls: RevealPull[]): void {
    this.standalone = true; if (!pulls.length) return;
    this.reveal = { count, pulls, startedAt: this.clock(), skipped: false, cued: false, flash: null };
    this.onCue(CONFIG.ui.gacha.audio.pull); this.onRedraw();
  }
  /** Standalone: drop the reveal without cues (tab change, menu close). */
  clearReveal(): void { if (this.reveal && !this.revealDone()) this.skipReveal(true); this.reveal = null; this.syncControls(); }
  revealState(): { count: 1 | 10; done: boolean; pulls: RevealPull[] } | null { const reveal = this.reveal; return reveal ? { count: reveal.count, done: this.revealDone(), pulls: structuredClone(reveal.pulls) } : null; }
  /** Standalone: the 720×400 Recruit panel's reveal (same layout, tokens and timings as the lane panel), drawn from y=72 down. */
  drawRevealStage(ctx: CanvasRenderingContext2D, tickets: number, scaleToCss: number): void {
    this.standalone = true; this.width = REVEAL_STAGE.width; this.scaleToCss = scaleToCss; this.controls.clear();
    ctx.clearRect(0, 0, REVEAL_STAGE.width, REVEAL_STAGE.height);
    if (!this.readyFlag) { this.syncControls(); return; }
    const panel = { x: 0, y: 0, ...REVEAL_STAGE };
    // The host's PARTY CAMP header and tabs stay visible above y=72; the reveal owns the rest of the panel.
    ctx.fillStyle = palette.panel; ctx.fillRect(0, REVEAL_STAGE.top, REVEAL_STAGE.width, REVEAL_STAGE.height - REVEAL_STAGE.top);
    if (this.reveal) this.drawReveal(ctx, tickets, panel, this.reveal);
    this.syncControls();
  }
  private togglePanel(tab: PanelTab): void { this.setPanel(this.panel === tab ? null : tab); }
  /** Compact lane edit mode (compact-menu.md §2.2): the stage heading shifts right of the Move handle. */
  compactEditing = false;
  /** Compact lane HUD (compact-menu.md §2.1, ui-tokens compactMenu.lane): opaque progress and actions islands; Menu/Edit are DOM buttons on top. */
  private drawCompactLane(ctx: CanvasRenderingContext2D, state: GameState, paused: boolean): void {
    const lane = CONFIG.ui.compactMenu.lane, width = this.width, coreY = this.sourceHeight - CONFIG.ui.closed.coreHeight, dy = coreY - CONFIG.ui.closed.coreY, right = width - lane.width;
    const at = (rect: readonly number[], shiftRight = false): Rect => ({ x: (rect[0] ?? 0) + (shiftRight ? right : 0), y: (rect[1] ?? 0) + dy, width: rect[2] ?? 0, height: rect[3] ?? 0 });
    const progressRect = at(lane.progressIsland), actionsRect = at(lane.actionsIsland, true);
    this.frame(ctx, progressRect); this.frame(ctx, actionsRect);
    const progress = state.progress, stage = CONFIG.stages[progress.stage - 1], waves = stage?.waves.length ?? 3;
    const heading = progress.kind === 'BOSS_READY' ? `BOSS ${stageConfig(progress.bossStage).id} READY` : progress.kind === 'BOSS_FIGHT' ? `BOSS ${stage?.id ?? ''}` : `${progress.kind === 'FARMING' ? 'FARM' : 'STAGE'} ${stage?.id ?? ''}`;
    const sub = progress.kind === 'BOSS_READY' ? 'Start it from Menu' : `WAVE ${state.wave}/${waves}`;
    const [hx = 20, hy = 92] = lane.stageText, [wx = 20, wy = 115] = lane.waveText, headX = this.compactEditing ? CONFIG.ui.compactMenu.editMode.headingShiftX : hx;
    this.text(ctx, heading, headX, hy + dy, progress.kind === 'BOSS_READY' || progress.kind === 'BOSS_FIGHT' ? palette.red : palette.gold, BODY, true, progressRect.x + progressRect.width - 8 - headX, { exactY: true });
    this.text(ctx, sub, wx, wy + dy, palette.muted, BODY, false, progressRect.width - 24, { exactY: true });
    const track = { x: wx, y: progressRect.y + 51, width: progressRect.width - 24, height: 4 };
    ctx.fillStyle = palette.ink; ctx.fillRect(track.x, track.y, track.width, track.height);
    ctx.fillStyle = palette.blue; ctx.fillRect(track.x, track.y, Math.round(track.width * Math.min(1, Math.max(0, (state.wave - 1) / waves))), track.height);
    const [px = 432, py = 98, pw = 6, ph = 6] = lane.statusPip, [sx = 442, sy = 92] = lane.statusText;
    ctx.fillStyle = palette.ink; ctx.fillRect(px + right - 1, py + dy - 1, pw + 2, ph + 2);
    ctx.fillStyle = paused ? palette.gold : palette.green; ctx.fillRect(px + right, py + dy, pw, ph);
    this.text(ctx, paused ? 'PAUSED' : 'RUNNING', sx + right, sy + dy, paused ? palette.gold : palette.green, BODY, false, 60, { exactY: true });
    const [gix = 432, giy = 119] = lane.goldIcon, [gtx = 452, gty = 121] = lane.goldText;
    this.icon(ctx, 'gold', gix + right, giy + dy); this.text(ctx, short(state.gold), gtx + right, gty + dy, palette.gold, BODY, true, 56, { exactY: true });
    if (this.compactEditing) {
      ctx.fillStyle = CONFIG.ui.compactMenu.editMode.frameInk; ctx.fillRect(0, coreY, width, 1); ctx.fillRect(0, coreY + 79, width, 1); ctx.fillRect(0, coreY, 1, 80); ctx.fillRect(width - 1, coreY, 1, 80);
      ctx.fillStyle = CONFIG.ui.compactMenu.editMode.frameColor; ctx.fillRect(1, coreY + 1, width - 2, 1); ctx.fillRect(1, coreY + 78, width - 2, 1); ctx.fillRect(1, coreY + 1, 1, 78); ctx.fillRect(width - 2, coreY + 1, 1, 78);
    }
  }
  setCompactMode(value: boolean): void { this.compactMode = value; if (value) this.setPanel(null); this.onLayoutChange(); }
  height(): number { return this.compactMode ? CONFIG.ui.closed.height : this.isOpen() ? CONFIG.ui.expanded.height : CONFIG.ui.closed.height; }
  private rosterColumns(): number { return this.width >= 736 ? 4 : 3; }
  private gearColumns(): number { return this.width >= 736 ? 8 : 6; }
  panelRect(): Rect {
    const width = this.width >= 736 ? CONFIG.ui.expanded.panelWidth : Math.max(608, this.width - 16);
    return { x: Math.max(8, this.width - width - CONFIG.ui.expanded.panelRightInset), y: 0, width, height: CONFIG.ui.expanded.panelHeight };
  }
  sourceRegions(): SourceHitRegion[] {
    if (this.standalone) return [{ kind: 'panel', id: 'reveal-stage', x: 0, y: REVEAL_STAGE.top, width: REVEAL_STAGE.width, height: REVEAL_STAGE.height - REVEAL_STAGE.top }];
    if (this.compactMode) {
      const lane = CONFIG.ui.compactMenu.lane, dy = this.height() - CONFIG.ui.closed.coreHeight - CONFIG.ui.closed.coreY, right = this.width - lane.width;
      const [px = 8, py = 88, pw = 200, ph = 64] = lane.progressIsland, [ax = 424, ay = 88, aw = 208, ah = 64] = lane.actionsIsland;
      return [{ kind: 'hud', id: 'progress', x: px, y: py + dy, width: pw, height: ph }, { kind: 'hud', id: 'actions', x: ax + right, y: ay + dy, width: aw, height: ah }];
    }
    const coreY = this.height() - CONFIG.ui.closed.coreHeight;
    const compact = this.width < 1000;
    const islandWidth = compact ? 200 : 280;
    const regions: SourceHitRegion[] = [{ kind: 'hud', id: 'progress', x: 8, y: coreY + 8, width: islandWidth, height: 64 },
      { kind: 'hud', id: 'actions', x: this.width - islandWidth - 8, y: coreY + 8, width: islandWidth, height: 64 }];
    if (this.quitHandler) regions.push({ ...this.quitRect(coreY), kind: 'hud', id: 'quit' });
    if (this.isOpen()) regions.push({ ...this.panelRect(), kind: 'panel', id: 'management' });
    return regions;
  }
  private frame(ctx: CanvasRenderingContext2D, rect: Rect, file = 'panel-9slice.png'): void {
    const image = this.images.get(file);
    if (!image) { ctx.fillStyle = palette.panel; ctx.fillRect(rect.x, rect.y, rect.width, rect.height); return; }
    const corner = CONFIG.ui.nineSlice.insets.left, source = CONFIG.ui.nineSlice.sourceSize[0] ?? 48;
    const sx = [0, corner, source - corner], sw = [corner, source - 2 * corner, corner];
    const dx = [rect.x, rect.x + corner, rect.x + rect.width - corner], dw = [corner, rect.width - 2 * corner, corner];
    const dy = [rect.y, rect.y + corner, rect.y + rect.height - corner], dh = [corner, rect.height - 2 * corner, corner];
    for (let row = 0; row < 3; row += 1) for (let col = 0; col < 3; col += 1) {
      const x = sx[col], y = sx[row], w = sw[col], h = sw[row], tx = dx[col], ty = dy[row], tw = dw[col], th = dh[row];
      if (x !== undefined && y !== undefined && w && h && tx !== undefined && ty !== undefined && tw && th) ctx.drawImage(image, x, y, w, h, tx, ty, tw, th);
    }
  }
  text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, color = palette.text, size = BODY, bold = false, maxWidth?: number, options: TextOptions = {}): void {
    if (!this.readyFlag) return;
    if (maxWidth !== undefined) size = fitSize(this.measureText(value, size, bold), maxWidth, size);
    const family = fontFor(value, size, bold);
    // textBaseline 'top' at whole pixels; layout slots get the per-size optical offset.
    y = Math.round(y) + (options.exactY ? 0 : slotOffsetY(size, bold));
    const key = `${family}|${size}|${color}|${value}`;
    let raster = this.textCache.get(key);
    if (!raster) {
      raster = document.createElement('canvas'); const measure = raster.getContext('2d', { willReadFrequently: true }); if (!measure) return;
      measure.font = `${size}px ${family}`; raster.width = Math.ceil(measure.measureText(value).width) + 2; raster.height = size + 4;
      measure.font = `${size}px ${family}`; measure.textBaseline = 'top'; measure.fillStyle = color; measure.fillText(value, 0, 0);
      const pixels = measure.getImageData(0, 0, raster.width, raster.height);
      for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = (pixels.data[i] ?? 0) >= 128 ? 255 : 0;
      measure.putImageData(pixels, 0, 0); this.textCache.set(key, raster);
      if (this.textCache.size > CONFIG.runtime.textCacheLimit) { const first = this.textCache.keys().next().value; if (first !== undefined) this.textCache.delete(first); }
    }
    ctx.save();
    if (maxWidth !== undefined) { ctx.beginPath(); ctx.rect(Math.round(x), Math.round(y), maxWidth, size + 5); ctx.clip(); }
    ctx.drawImage(raster, Math.round(x), Math.round(y)); ctx.restore();
  }
  /** Advance width in source pixels (Galmuri advances are whole pixels at native sizes). */
  measureText(value: string, size = BODY, bold = false): number {
    this.measureContext ??= document.createElement('canvas').getContext('2d');
    if (!this.measureContext) return 0;
    this.measureContext.font = `${size}px ${fontFor(value, size, bold)}`;
    return Math.round(this.measureContext.measureText(value).width);
  }
  private icon(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, scale = 1): void {
    const image = this.images.get(`icon-${name}.png`); if (image) ctx.drawImage(image, Math.round(x), Math.round(y), 16 * scale, 16 * scale);
  }
  private button(ctx: CanvasRenderingContext2D, id: string, label: string, rect: Rect, click: () => void, options: { disabled?: boolean; selected?: boolean; icon?: string; tooltip?: string; cardIndex?: number; badge?: 'gold' | 'boss'; labelColor?: string; bold?: boolean; primary?: boolean } = {}): void {
    const disabled = options.disabled ?? false;
    const hover = this.hovered === id, focus = this.focused === id;
    this.controls.set(id, { ...rect, id, label, disabled, click, tooltip: options.tooltip ?? label, ...(options.cardIndex === undefined ? {} : { cardIndex: options.cardIndex }) });
    this.frame(ctx, rect, disabled ? 'button-disabled-9slice.png' : this.pressed === id ? 'button-pressed-9slice.png' : hover ? 'button-hover-9slice.png' : 'button-9slice.png');
    if (options.selected) { ctx.fillStyle = palette.gold; ctx.fillRect(rect.x + 3, rect.y + rect.height - 3, rect.width - 6, 2); }
    if (options.badge) this.badge(ctx, id, rect, options.badge, hover || focus);
    if (options.icon) this.icon(ctx, options.icon, rect.x + 6, rect.y + Math.floor((rect.height - 16) / 2));
    const labelX = options.icon ? feedback.badge.labelTextX.withIcon : feedback.badge.labelTextX.noIcon;
    // Centre the 14 px line box: caps start at row 8 of a 28 px button, row 6 of a 24 px one.
    const color = disabled ? '#82909d' : options.selected || hover || options.primary ? palette.gold : options.labelColor ?? palette.text;
    if (options.primary && !disabled) { ctx.fillStyle = palette.gold; ctx.fillRect(rect.x + 3, rect.y + rect.height - 3, rect.width - 6, 1); }
    this.text(ctx, label, rect.x + labelX, rect.y + Math.floor((rect.height - LINE_BOX) / 2) + (this.pressed === id ? 1 : 0), color, BODY, options.bold ?? false, rect.width - labelX - (options.icon ? 5 : 4), { exactY: true });
    if (focus) { ctx.fillStyle = palette.text; ctx.fillRect(rect.x + 3, rect.y + 3, rect.width - 6, 1); ctx.fillRect(rect.x + 3, rect.y + rect.height - 4, rect.width - 6, 1); ctx.fillRect(rect.x + 3, rect.y + 3, 1, rect.height - 6); ctx.fillRect(rect.x + rect.width - 4, rect.y + 3, 1, rect.height - 6); }
  }
  /** A clickable region drawn by its caller (no 9-slice); still a real button for focus, aria and hit regions. */
  private hotspot(ctx: CanvasRenderingContext2D, id: string, rect: Rect, click: () => void, tooltip: string, layer?: number): void {
    this.controls.set(id, { ...rect, id, label: '', disabled: false, click, tooltip, ...(layer === undefined ? {} : { layer }) });
    if (layer !== undefined) return;
    if (this.focused !== id && this.hovered !== id) return;
    ctx.fillStyle = this.focused === id ? palette.text : palette.gold;
    ctx.fillRect(rect.x, rect.y, rect.width, 1); ctx.fillRect(rect.x, rect.y + rect.height - 1, rect.width, 1); ctx.fillRect(rect.x, rect.y, 1, rect.height); ctx.fillRect(rect.x + rect.width - 1, rect.y, 1, rect.height);
  }
  /**
   * Affordability pip (ui.md §10): 6x6 fill at (x+w-10, y+2) with a 1 px ink rim and a 2x2 highlight; red for the boss.
   * When a pip turns on it grows to 8x8 for 200 ms of each 1000 ms cycle, 3 cycles, then stays static. Hover, focus,
   * click or opening its panel ends the pulse; a pip waits 60 s before it may pulse again. Reduced motion: static.
   * The pulse clock is renderer memory keyed by sim tick, never sim state.
   */
  private badge(ctx: CanvasRenderingContext2D, id: string, rect: Rect, kind: 'gold' | 'boss', seen: boolean): void {
    const spec = feedback.badge, pulse = feedback.badgePulse, tick = this.current?.tick ?? 0;
    this.badgesDrawn.add(id);
    let memory = this.badgeMemory.get(id);
    if (!memory || !memory.on) {
      const cooled = !memory || (tick - memory.pulseTick) * TICK_MS >= pulse.cooldownMs;
      memory = { on: true, pulseTick: cooled ? tick : memory?.pulseTick ?? tick, seen: !cooled || this.reducedMotion };
      this.badgeMemory.set(id, memory);
    }
    if (seen || this.panel === id.replace(/^(open|tab)-/, '')) memory.seen = true;
    const age = (tick - memory.pulseTick) * TICK_MS;
    const grown = memory.seen ? 0 : pulseGrowPx(age);
    const x = rect.x + rect.width - spec.fillOffsetFromButton.right - grown, y = rect.y + spec.fillOffsetFromButton.top - grown, size = spec.sizePx + grown * 2;
    ctx.fillStyle = spec.rim; ctx.fillRect(x - spec.rimPx, y - spec.rimPx, size + spec.rimPx * 2, size + spec.rimPx * 2);
    ctx.fillStyle = kind === 'boss' ? spec.bossFill : spec.fill; ctx.fillRect(x, y, size, size);
    ctx.fillStyle = spec.highlight; ctx.fillRect(x + 1, y + 1, spec.highlightPx, spec.highlightPx);
  }
  /** Centre x of the management button an upgrade popup belongs to when its wearer is not on the field. */
  feedbackAnchorX(tab: 'heroes' | 'gear'): number {
    const button = this.managementRects()[tab === 'heroes' ? 0 : 1];
    return button ? button.x + button.width / 2 : this.width / 2;
  }
  /** Stage-clear / boss-ready plate in the effects ceiling (ui.md §10): panel 9-slice, 24 px tall, sized to the measured label. */
  drawBanner(ctx: CanvasRenderingContext2D, label: string, boss: boolean, centerX: number, y: number): void {
    const spec = feedback.stageBanner, width = this.measureText(label, BODY, true) + spec.padXPx * 2;
    const x = Math.max(spec.clampMarginPx, Math.min(this.width - spec.clampMarginPx - width, roundHalfEven(centerX - width / 2)));
    this.frame(ctx, { x, y, width, height: spec.heightPx });
    this.text(ctx, label, x + spec.padXPx, y + spec.textYOffsetPx, boss ? spec.boss.text : spec.stage.text, BODY, true, undefined, { exactY: true });
    if (boss) { const [rx = 8, ry = -4, rw = -16, rh = 2] = spec.boss.ruleRect; ctx.fillStyle = spec.boss.rule; ctx.fillRect(x + rx, y + spec.heightPx + ry, width + rw, rh); }
  }
  /** Two-colour upgrade label (stat green, DPS blue) with a 1 px 4-neighbour ink outline; returns its width. */
  drawPopupText(ctx: CanvasRenderingContext2D, segments: readonly { text: string; kind: 'stat' | 'dps' }[], x: number, y: number): void {
    const spec = feedback.upgradePopup, gap = this.measureText(' '.repeat(2), BODY, true);
    let cursor = Math.round(x);
    for (const segment of segments) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) this.text(ctx, segment.text, cursor + dx, y + dy, spec.outline, BODY, true, undefined, { exactY: true });
      this.text(ctx, segment.text, cursor, y, segment.kind === 'dps' ? spec.dpsColor : spec.statColor, BODY, true, undefined, { exactY: true });
      cursor += this.measureText(segment.text, BODY, true) + gap;
    }
  }
  popupWidth(segments: readonly { text: string }[]): number {
    return this.measureText(segments.map(segment => segment.text).join('  '), BODY, true);
  }
  /** In-panel upgrade chip: raised fill, 1 px edge, 18 px tall, centred on panel x 620. */
  drawPanelChip(ctx: CanvasRenderingContext2D, segments: readonly { text: string; kind: 'stat' | 'dps' }[], rise: number): void {
    const chip = feedback.upgradePopup.panelChip, panel = this.panelRect(), width = this.popupWidth(segments) + chip.padXPx * 2;
    const x = Math.max(panel.x + 8, Math.min(panel.x + panel.width - 8 - width, roundHalfEven(panel.x + chip.anchorCenterXPanel - width / 2))), y = chip.startYPanel - rise;
    ctx.fillStyle = chip.edge; ctx.fillRect(x, y, width, chip.heightPx);
    ctx.fillStyle = chip.fill; ctx.fillRect(x + 1, y + 1, width - 2, chip.heightPx - 2);
    this.drawPopupText(ctx, segments, x + chip.padXPx, y + chip.textYOffsetPx);
  }
  private managementRects(): Rect[] {
    const compact = this.width < 1000, spec = feedback.managementButtons;
    return (compact ? spec.compactRectsCoreLocal : spec.rectsCoreLocal).map(([x, y, width, height]) => ({ x: this.width - Number(String(x).replace('W-', '')), y: this.coreY + Number(y), width: Number(width), height: Number(height) }));
  }
  private sprite(ctx: CanvasRenderingContext2D, heroId: string, x: number, y: number, tick: number, zoom = 1): void {
    const key = Object.entries(CONFIG.view.heroAssets).find(([id]) => id === heroId)?.[1];
    if (key) this.atlas.draw(ctx, key, 'idle', tick * 1000 / CONFIG.sim.ticksPerSecond, x, y, false, zoom);
  }
  draw(ctx: CanvasRenderingContext2D, state: GameState, width: number, coreY: number, paused: boolean, scaleToCss: number): void {
    this.badgesDrawn.clear();
    this.current = state; this.width = width; this.coreY = coreY; this.sourceHeight = this.height(); this.scaleToCss = scaleToCss; this.controls.clear();
    if (!this.readyFlag) { this.syncControls(); return; }
    for (const event of state.events) if (event.seq > this.lastPullSeq && event.data.type === 'pull') {
      this.history.unshift(`${heroConfig(event.data.heroId).name} · ${event.data.rarity}${event.data.duplicate ? ' · duplicate +star/gold' : ' · NEW'}`);
      if (this.history.length > 10) this.history.pop(); this.lastPullSeq = event.seq;
    }
    if (this.compactMode) { this.drawCompactLane(ctx, state, paused); this.syncControls(); return; }
    const compact = width < 1000, islandWidth = compact ? 200 : 280;
    const right = width - islandWidth - 8;
    this.frame(ctx, { x: 8, y: coreY + 8, width: islandWidth, height: 64 });
    this.frame(ctx, { x: right, y: coreY + 8, width: islandWidth, height: 64 });
    const stage = CONFIG.stages[state.progress.stage - 1];
    const island = feedback.islandText, boss = feedback.bossButton, progress = state.progress, bossReady = progress.kind === 'BOSS_READY';
    // Boss countdown (#3) in the heading row: `BOSS {id}` clipped to leave the timer its fixed slot at islandWidth-80. Galmuri11 Bold 12 px.
    const bossSeconds = bossReady ? null : bossSecondsRemaining(state);
    const heading = progress.kind === 'BOSS_READY' ? boss.heading.replace('{id}', stageConfig(progress.bossStage).id) : bossSeconds !== null ? `BOSS ${stage?.id ?? ''}` : progress.kind === 'PUSHING' ? `GREENWAY / ${stage?.id ?? ''}` : statusText(state).replace(', next try in ', ' / ');
    // CR-14-08 / design.md §16: a pending chest choice takes the heading ("Chest: pick 1 of 2", fallback "Pick 1/2"); a running boss countdown keeps the heading; BOSS_READY keeps its Fight button.
    const choices = state.pendingChoice?.length ?? 0, prompt = choices > 0 && bossSeconds === null;
    if (prompt) {
      const room = islandWidth - 40, full = 'Chest: pick 1 of 2', label = this.measureText(full, BODY, true) <= room ? full : 'Pick 1/2';
      this.text(ctx, label, 20, coreY + island.headingDrawY, palette.gold, BODY, true, room, { exactY: true });
      this.icon(ctx, 'chest', islandWidth - 12, coreY + island.headingDrawY - 2);
      this.hotspot(ctx, 'chest-choice', { x: 16, y: coreY + 10, width: islandWidth - 8, height: 20 }, () => this.setPanel('gear'), `Chest choice: keep 1 of 2 items, the other is salvaged${choices > 1 ? ` (${choices} waiting)` : ''}`);
    } else this.text(ctx, heading, 20, coreY + island.headingDrawY, palette.gold, BODY, true, islandWidth - (bossSeconds !== null ? 100 : 20), { exactY: true });
    if (bossSeconds !== null) this.text(ctx, `TIME ${Math.floor(bossSeconds / 60)}:${String(bossSeconds % 60).padStart(2, '0')}`, islandWidth - 80, coreY + island.headingDrawY, bossSeconds <= CONFIG.view.bossCountdownWarnSec ? palette.red : palette.gold, BODY, true, undefined, { exactY: true });
    if (!bossReady || !boss.hidesWaveLabel) this.text(ctx, `WAVE ${state.wave}/${stage?.waves.length ?? 3}`, 20, coreY + island.row2DrawY, palette.muted, BODY, false, undefined, { exactY: true });
    this.icon(ctx, 'gold', compact ? 108 : 160, coreY + island.coinIconY); this.text(ctx, short(state.gold), compact ? 128 : 182, coreY + island.row2DrawY, palette.gold, BODY, true, compact ? 70 : 96, { exactY: true });
    // CR-14-03 Fortune meter (design.md §16): row 2 right of gold; label → number-only fallback → hidden when it can't fit.
    const fortune = fortuneMeter(state);
    if (fortune) {
      const goldX = compact ? 128 : 182, x = goldX + Math.min(compact ? 70 : 96, this.measureText(short(state.gold), BODY, true)) + 10, room = islandWidth - x;
      const labels = fortune.found ? [`Fortune ${fortune.since}/${fortune.limit}`, `F ${fortune.since}/${fortune.limit}`] : [`Legend in ${fortune.left}`, `L ${fortune.left}`];
      const label = labels.find(value => this.measureText(value) <= room);
      const tooltip = fortune.found ? `Gear Fortune ${fortune.since}/${fortune.limit}: the chest roll that reaches ${fortune.limit} is Legendary` : `First Legendary gear guaranteed within ${fortune.left} chest roll${fortune.left === 1 ? '' : 's'}`;
      if (label) {
        this.text(ctx, label, x, coreY + island.row2DrawY, CONFIG.ui.rarity.legendary.label, BODY, false, room, { exactY: true });
        this.hotspot(ctx, 'fortune-meter', { x: x - 2, y: coreY + island.row2DrawY - 2, width: this.measureText(label) + 4, height: 18 }, () => this.setPanel('gear'), tooltip);
      }
    }
    ctx.fillStyle = palette.ink; ctx.fillRect(20, coreY + 59, islandWidth - 24, 4); ctx.fillStyle = palette.blue; ctx.fillRect(20, coreY + 59, Math.round((islandWidth - 24) * (state.wave - 1) / 3), 4);
    const dps = state.events.reduce((sum, event) => event.data.type === 'hit' && event.data.side === 'enemy' && state.tick - event.tick <= CONFIG.sim.ticksPerSecond * 5 ? sum + event.data.damage : sum, 0) / Math.min(5, Math.max(1, state.tick / CONFIG.sim.ticksPerSecond));
    // CR-14-01/02 recruit meters (design.md §16) take the DPS slot (compact: the status slot); full text, then the fallbacks.
    const meters = recruitMeters(state), statusX = right + (compact ? 12 : this.quitHandler ? 120 : 152);
    if (meters) {
      const x = right + 12, room = (compact ? width - 56 : statusX - 8) - x;
      const epic = `Epic+ in ${meters.epicPlus}`, legend = meters.legendary === null ? '' : ` · Legend in ${meters.legendary}`, fresh = meters.newHero === null ? '' : `New hero in ${meters.newHero}`;
      const short2 = `E+${meters.epicPlus}${meters.legendary === null ? '' : ` L${meters.legendary}`}`;
      const label = [`${epic}${legend}`, `${short2}${meters.newHero === null ? '' : ` N${meters.newHero}`}`, short2].find(value => this.measureText(value, BODY, true) <= room) ?? short2;
      this.text(ctx, label, x, coreY + island.rightRowDrawY, CONFIG.ui.rarity.epic.label, BODY, true, room, { exactY: true });
      this.hotspot(ctx, 'recruit-meter', { x: x - 2, y: coreY + island.rightRowDrawY - 2, width: Math.min(room, this.measureText(label, BODY, true)) + 4, height: 18 }, () => this.setPanel('recruit'), [epic + legend, fresh].filter(Boolean).join(' · '));
    } else if (!compact) this.text(ctx, `DPS ${short(Math.round(dps))}`, right + 12, coreY + island.rightRowDrawY, palette.blue, BODY, true, undefined, { exactY: true });
    if (!(meters && compact)) this.text(ctx, paused ? 'PAUSED' : 'RUNNING', statusX, coreY + island.rightRowDrawY, paused ? palette.gold : palette.green, BODY, false, undefined, { exactY: true });
    this.button(ctx, 'pause', paused ? '>' : 'II', { x: width - 48, y: coreY + 12, width: 28, height: 24 }, () => this.onPause(), { tooltip: paused ? 'Resume simulation (Space)' : 'Pause simulation (Space)' });
    const quit = this.quitHandler;
    if (quit) this.button(ctx, 'quit', 'X', this.quitRect(coreY), quit, { tooltip: 'Save and quit' });
    const ready = affordability(state);
    for (const [index, tab] of (['heroes', 'gear', 'recruit'] satisfies PanelTab[]).entries()) {
      const rect = this.managementRects()[index]; if (!rect) continue;
      this.button(ctx, `open-${tab}`, compact ? ['Hero', 'Gear', 'Pull'][index] ?? tab : ['Heroes', 'Gear', 'Recruit'][index] ?? tab,
        rect, () => this.togglePanel(tab), { selected: this.panel === tab, ...(ready[tab] ? { badge: 'gold' as const } : {}), tooltip: `${['Heroes', 'Gear', 'Recruit'][index] ?? tab}${ready[tab] ? AVAILABLE[tab] : ''}`, ...(compact ? {} : { icon: ['sword', 'armor', 'chest'][index] ?? 'chest' }) });
    }
    if (progress.kind === 'BOSS_READY') {
      const [bx = 16, by = 31, bw = 124, bh = 24] = compact ? boss.compactRectCoreLocal : boss.rectCoreLocal, labels = compact ? boss.compactLabels : boss.labels;
      this.button(ctx, 'boss', (progress.bossLosses ? labels[1] : labels[0]) ?? 'Fight', { x: bx, y: coreY + by, width: bw, height: bh }, () => this.onAction({ type: 'retry' }), { tooltip: statusText(state), badge: 'boss', labelColor: boss.labelColor, bold: true });
    }
    if (this.panel) this.drawPanel(ctx, state, paused);
    else if (this.welcome) this.drawWelcome(ctx, state, this.welcome);
    for (const [id, memory] of this.badgeMemory) if (!this.badgesDrawn.has(id)) memory.on = false;
    this.syncControls();
    const hovered = this.controls.get(this.hovered);
    if (hovered && performance.now() - this.hoverAt >= 300 && hovered.tooltip !== hovered.label) {
      const x = Math.min(this.width - 248, Math.max(8, this.pointer.x + 12)), y = Math.max(8, Math.min(this.sourceHeight - 48, this.pointer.y - 48));
      ctx.fillStyle = palette.ink; ctx.fillRect(x, y, 240, 40); ctx.fillStyle = palette.edge; ctx.fillRect(x, y, 240, 1);
      this.text(ctx, hovered.tooltip, x + 8, y + 8, palette.text, BODY, false, 224);
    }
  }
  private drawPanel(ctx: CanvasRenderingContext2D, state: GameState, paused: boolean): void {
    const panel = this.panelRect(), x = panel.x, w = panel.width, ready = affordability(state);
    this.frame(ctx, panel);
    this.text(ctx, 'PARTY CAMP', x + 16, 9, palette.gold, HEADING, true);
    this.text(ctx, paused ? 'BATTLE PAUSED' : 'BATTLE CONTINUES', x + w - 288, 13, paused ? palette.gold : palette.green, BODY);
    this.button(ctx, 'close-panel', 'X', { x: x + w - 40, y: 8, width: 28, height: 24 }, () => this.setPanel(null), { tooltip: 'Close management (Esc)' });
    for (const [index, tab] of (['heroes', 'gear', 'recruit'] satisfies PanelTab[]).entries()) {
      const widths = [104, 96, 112], offsets = [16, 128, 232];
      this.button(ctx, `tab-${tab}`, ['Heroes', 'Gear', 'Recruit'][index] ?? tab, { x: x + (offsets[index] ?? 16), y: 40, width: widths[index] ?? 104, height: 28 }, () => this.setPanel(tab), { selected: this.panel === tab, ...(ready[tab] ? { badge: 'gold' as const } : {}) });
    }
    this.icon(ctx, 'gold', x + w - 148, 45); this.text(ctx, state.gold.toLocaleString('en-US'), x + w - 128, 45, palette.gold, BODY, true);
    // Audio: mute toggle and volume steps in the tab row (persisted by the audio engine).
    const sound = this.audio, wide = w >= 720, mx = x + (wide ? 360 : 352);
    this.button(ctx, 'sound-toggle', sound.muted ? 'Muted' : 'Sound', { x: mx, y: 40, width: wide ? 72 : 52, height: 28 }, () => this.onAudio({ ...sound, muted: !sound.muted }), { tooltip: sound.muted ? 'Sound off: click to unmute' : `Sound on (${Math.round(sound.volume * 100)}%): click to mute`, ...(sound.muted ? {} : { selected: false }) });
    const vx = mx + (wide ? 76 : 56), step = 0.1, round = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * 10) / 10;
    this.button(ctx, 'volume-down', '-', { x: vx, y: 40, width: 24, height: 28 }, () => this.onAudio({ muted: false, volume: round(sound.volume - step) }), { disabled: sound.volume <= 0, tooltip: `Volume ${Math.round(sound.volume * 100)}%: lower` });
    this.button(ctx, 'volume-up', '+', { x: vx + 28, y: 40, width: 24, height: 28 }, () => this.onAudio({ muted: false, volume: round(sound.volume + step) }), { disabled: sound.volume >= 1, tooltip: `Volume ${Math.round(sound.volume * 100)}%: raise` });
    ctx.fillStyle = palette.edge; ctx.fillRect(x + 16, 357, w - 32, 1);
    if (this.panel === 'heroes') this.drawHeroes(ctx, state, panel);
    if (this.panel === 'gear') this.drawGear(ctx, state, panel);
    if (this.panel === 'recruit') { if (this.reveal) this.drawReveal(ctx, state.tickets, panel, this.reveal); else this.drawRecruit(ctx, state, panel); }
  }
  /** Rarity shape cue (rarity-drops.md §2) centred on (cx, cy), 1 px 4-neighbour ink outline; rare `twinkle` = 3×3 frame. */
  private drawShape(ctx: CanvasRenderingContext2D, tier: Rarity, cx: number, cy: number, twinkle = false): void {
    const shape = CONFIG.ui.rarityDrop.shapes[tier], map: readonly string[] = twinkle && 'twinkleMap' in shape ? shape.twinkleMap : shape.map;
    const colors: Record<string, string> = shape.colors, h = map.length, w = map[0]?.length ?? 0, x0 = Math.round(cx - Math.floor(w / 2)), y0 = Math.round(cy - Math.floor(h / 2));
    const inked = (x: number, y: number): boolean => { const cell = map[y]?.[x]; return cell !== undefined && cell !== '.'; };
    ctx.fillStyle = CONFIG.ui.rarityDrop.outline.color;
    for (let y = -1; y <= h; y += 1) for (let x = -1; x <= w; x += 1) if (!inked(x, y) && (inked(x - 1, y) || inked(x + 1, y) || inked(x, y - 1) || inked(x, y + 1))) ctx.fillRect(x0 + x, y0 + y, 1, 1);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) { const cell = map[y]?.[x]; if (cell && cell !== '.') { ctx.fillStyle = colors[cell] ?? '#ffffff'; ctx.fillRect(x0 + x, y0 + y, 1, 1); } }
  }
  private drawBadge(ctx: CanvasRenderingContext2D, kind: 'new' | 'duplicateStar' | 'duplicateGold' | 'pity', x: number, y: number, gold = 0, alignRight = false): void {
    const spec = CONFIG.ui.badges[kind], label = spec.label.replace('{gold}', String(gold)), width = this.measureText(label, BODY, true) + 8, left = alignRight ? x - width : x;
    ctx.fillStyle = spec.fill; ctx.fillRect(left, y, width, CONFIG.ui.badges.heightPx);
    this.text(ctx, label, left + 4, y + 1, spec.ink, BODY, true, undefined, { exactY: true });
  }
  /** Card face (gacha.md §3): back = raised 9-slice with a "?" plate; front = 2 px rarity frame, fill and 16 px floor band. */
  private drawCard(ctx: CanvasRenderingContext2D, face: CardFace, tier: Rarity, heroId: string, rect: Rect, artHeight: number, floorY: number): void {
    if (rect.width <= 0) return;
    const colors = CONFIG.ui.rarity[tier];
    if (face === 'back') {
      if (rect.width >= 24) this.frame(ctx, rect, 'button-9slice.png'); else { ctx.fillStyle = palette.edge; ctx.fillRect(rect.x, rect.y, rect.width, rect.height); }
      if (rect.width >= 20) { const px = rect.x + Math.floor(rect.width / 2) - 8, py = rect.y + Math.floor(artHeight / 2) - 8; ctx.fillStyle = palette.ink; ctx.fillRect(px, py, 16, 16); this.text(ctx, '?', px + 5, py + 1, palette.gold, BODY, true, undefined, { exactY: true }); }
      return;
    }
    ctx.fillStyle = colors.frame; ctx.fillRect(rect.x, rect.y, rect.width, artHeight);
    ctx.fillStyle = colors.fill; ctx.fillRect(rect.x + 2, rect.y + 2, rect.width - 4, artHeight - 4);
    ctx.fillStyle = colors.floor; ctx.fillRect(rect.x + 2, rect.y + artHeight - 18, rect.width - 4, 16);
    if (rect.width < 64) return;
    ctx.save(); ctx.beginPath(); ctx.rect(rect.x + 2, rect.y + 2, rect.width - 4, artHeight - 4); ctx.clip();
    const key = Object.entries(CONFIG.view.heroAssets).find(([id]) => id === heroId)?.[1], cx = rect.x + Math.floor(rect.width / 2);
    if (key && face === 'silhouette') {
      const mask = document.createElement('canvas'); mask.width = rect.width; mask.height = artHeight;
      const m = mask.getContext('2d');
      if (m) { m.imageSmoothingEnabled = false; this.atlas.draw(m, key, 'idle', 0, Math.floor(rect.width / 2), floorY - rect.y, false, 1, true); m.globalCompositeOperation = 'source-in'; m.fillStyle = colors.frame; m.fillRect(0, 0, mask.width, mask.height); ctx.drawImage(mask, rect.x, rect.y); }
    } else if (key) this.atlas.draw(ctx, key, 'idle', 0, cx, floorY, false, 1);
    ctx.restore();
  }
  private drawRim(ctx: CanvasRenderingContext2D, rect: Rect, color: string, alpha: number): void {
    if (alpha <= 0) return;
    ctx.save(); ctx.globalAlpha = alpha / 255; ctx.fillStyle = color;
    ctx.fillRect(rect.x - 2, rect.y - 2, rect.width + 4, 2); ctx.fillRect(rect.x - 2, rect.y + rect.height, rect.width + 4, 2);
    ctx.fillRect(rect.x - 2, rect.y, 2, rect.height); ctx.fillRect(rect.x + rect.width, rect.y, 2, rect.height); ctx.restore();
  }
  /** Gacha reveal (ui/gacha.md): single at the stage, or the 10-card summary. The legendary beam is PR (5). */
  private drawReveal(ctx: CanvasRenderingContext2D, tickets: number, panel: Rect, reveal: Reveal): void {
    const x = panel.x, ms = this.revealMs(), spec = CONFIG.ui.gacha, done = this.revealDone(), now = this.clock();
    const cue = this.cuePull(), cueAt = reveal.count === 1 ? burstStartMs(cue?.rarity ?? 'common') : tenFrame(reveal.pulls.map(pull => pull.rarity), 0).burstCueAt;
    if (!reveal.cued && cue && ms >= cueAt && !reveal.skipped) { reveal.cued = true; this.onCue(burstCue(cue.rarity, cue.pity)); }
    if (reveal.flash === null && cue?.rarity === 'legendary' && ms >= cueAt && !reveal.skipped && !this.reducedMotion) reveal.flash = this.flashes.request(now);
    if (!done) this.hotspot(ctx, 'reveal-skip', { x: x + 8, y: 72, width: panel.width - 16, height: 320 }, () => this.skipReveal(), 'Click anywhere to skip', 0);
    if (reveal.count === 1) this.drawSingle(ctx, panel, reveal, ms); else this.drawTen(ctx, panel, reveal, ms);
    if (!done) { this.text(ctx, 'Click anywhere to skip', x + 16, 368, palette.muted, BODY); return; }
    const cost = CONFIG.gacha.costTickets * reveal.count, short10 = tickets < cost;
    if (reveal.count === 1) this.text(ctx, 'Click a button or press Enter', x + 16, 368, palette.muted, BODY, false, 370);
    else this.text(ctx, `Tickets ${tickets}${short10 ? ` · Again needs ${cost}` : ''}`, x + 16, 368, palette.muted, BODY, false, 370);
    const [ax = 400, ay = 364, aw = 152, ah = 28] = reveal.count === 1 ? spec.single.againRect : spec.tenPull.againRect, [ox = 560, oy = 364, ow = 144, oh = 28] = reveal.count === 1 ? spec.single.okRect : spec.tenPull.okRect;
    this.button(ctx, 'reveal-again', `Again x${reveal.count}`, { x: x + ax, y: ay, width: aw, height: ah }, () => { this.reveal = null; if (this.standalone) this.onRevealAgain(reveal.count); else this.startRecruit(reveal.count); },
      { icon: 'chest', disabled: short10, tooltip: short10 ? `Need ${cost} ticket${cost === 1 ? '' : 's'}` : `Recruit x${reveal.count} again: ${cost} ticket${cost === 1 ? '' : 's'}` });
    this.button(ctx, 'reveal-ok', 'OK', { x: x + ox, y: oy, width: ow, height: oh }, () => this.finishReveal(true), { primary: true, bold: true, tooltip: 'Back to Recruit (Enter)' });
  }
  private drawSingle(ctx: CanvasRenderingContext2D, panel: Rect, reveal: Reveal, ms: number): void {
    const pull = reveal.pulls[0]; if (!pull) return;
    const x = panel.x, spec = CONFIG.ui.gacha.single, frame = singleFrame(pull.rarity, ms, this.reducedMotion), tier = CONFIG.ui.rarity[pull.rarity];
    const [sx = 176, sy = 84, sw = 368, sh = 212] = spec.stageRect, [cx0 = 312, cy0 = 160, cw = 96, ch = 128] = spec.cardRect;
    this.text(ctx, 'RECRUIT x1', x + 16, 80, palette.text, BODY, true);
    ctx.save(); ctx.translate(frame.flash || frame.shakeX ? (reveal.flash ? frame.shakeX : 0) : 0, 0);
    const stage = { x: x + sx, y: sy, width: sw, height: sh };
    ctx.fillStyle = '#141c26'; ctx.fillRect(stage.x, stage.y, stage.width, stage.height);
    ctx.save(); ctx.beginPath(); ctx.rect(stage.x, stage.y, stage.width, stage.height); ctx.clip();
    const card = { x: x + cx0 + Math.floor((cw - frame.cardWidth) / 2), y: cy0 + frame.dropY, width: frame.cardWidth, height: ch };
    if (frame.motes) { ctx.fillStyle = tier.frame; for (const mote of motes(pull.rarity, ms, cw + 40)) ctx.fillRect(x + cx0 - 20 + mote.x, cy0 + ch - 8 + mote.y, mote.size, mote.size); }
    this.drawRim(ctx, card, frame.flash && reveal.flash ? '#fff0ac' : tier.frame, frame.flash && reveal.flash ? 255 : frame.rimAlpha);
    this.drawCard(ctx, frame.face, pull.rarity, pull.heroId, card, ch, card.y + 112);
    if (frame.burstAge !== null && !this.reducedMotion) for (const dot of particles(pull.rarity, 0, frame.burstAge)) { ctx.fillStyle = dot.color; ctx.fillRect(x + cx0 + cw / 2 + dot.x, cy0 + ch / 2 + dot.y, dot.size, dot.size); }
    ctx.restore();
    if (frame.burstAge !== null || frame.done) {
      const [shx = 360, shy = 152] = spec.shapeSlotCenter;
      this.drawShape(ctx, pull.rarity, x + shx, shy, pull.rarity === 'rare' && !this.reducedMotion && frame.burstAge !== null && frame.burstAge < 40);
      if (pull.pity) this.drawBadge(ctx, 'pity', card.x + 4, card.y + 4);
    }
    const name = heroConfig(pull.heroId).name.replace(' (recolored Wizard)', '');
    if (frame.showName) this.text(ctx, name, x + sx + Math.floor((sw - this.measureText(name, BODY, true)) / 2), spec.nameY, palette.text, BODY, true);
    if (frame.showRarity) { const label = pull.rarity.toUpperCase(); this.text(ctx, label, x + sx + Math.floor((sw - this.measureText(label, BODY, true)) / 2), spec.rarityY, tier.label, BODY, true); }
    ctx.restore();
  }
  private drawTen(ctx: CanvasRenderingContext2D, panel: Rect, reveal: Reveal, ms: number): void {
    const x = panel.x, spec = CONFIG.ui.gacha.tenPull, rarities = reveal.pulls.map(pull => pull.rarity), frame = tenFrame(rarities, ms, this.reducedMotion);
    this.text(ctx, 'RECRUIT x10 RESULTS', x + 16, 80, palette.text, BODY, true);
    const tally = [...raritySchema.options].reverse().map(tier => [tier, rarities.filter(r => r === tier).length] as const).filter(([, n]) => n > 0).map(([tier, n]) => `${n} ${tier.toUpperCase()}`).join(' ');
    if (frame.done) this.text(ctx, tally, x + 704 - this.measureText(tally), 80, palette.muted, BODY);
    ctx.save(); ctx.translate(reveal.flash ? frame.shakeX : 0, 0);
    reveal.pulls.forEach((pull, index) => {
      const [rx = 24, ry = 100, rw = 128, rh = 120] = spec.cardRects[index] ?? [], cardFrame = frame.cards[index]; if (!cardFrame) return;
      const tier = CONFIG.ui.rarity[pull.rarity], rect = { x: x + rx + Math.floor((rw - cardFrame.width) / 2), y: ry + cardFrame.dropY, width: cardFrame.width, height: rh };
      const highlight = index === frame.highlight && (cardFrame.rimAlpha > 0 || frame.done) && ['epic', 'legendary'].includes(pull.rarity);
      if (highlight) this.drawRim(ctx, rect, frame.flash && reveal.flash ? '#fff0ac' : tier.frame, 255);
      if (cardFrame.face === 'back') { this.drawCard(ctx, 'back', pull.rarity, pull.heroId, rect, rh, rect.y + 80); return; }
      this.drawCard(ctx, cardFrame.face, pull.rarity, pull.heroId, { ...rect, height: 84 }, 84, rect.y + 80);
      ctx.fillStyle = palette.ink; ctx.fillRect(rect.x, rect.y + 84, rect.width, 36);
      ctx.fillStyle = tier.fill; ctx.fillRect(rect.x + 1, rect.y + 85, rect.width - 2, 35); ctx.fillStyle = tier.frame; ctx.fillRect(rect.x, rect.y + 84, rect.width, 1);
      if (rect.width < 128) return;
      if (cardFrame.burstAge !== null && !this.reducedMotion) for (const dot of particles(pull.rarity, index, cardFrame.burstAge, 0.25)) { ctx.fillStyle = dot.color; ctx.fillRect(rect.x + 64 + dot.x, rect.y + 42 + dot.y, dot.size, dot.size); }
      let name = heroConfig(pull.heroId).name.replace(' (recolored Wizard)', '');
      while (this.measureText(name) > 124 && name.length > 1) name = `${name.slice(0, -2)}…`;
      this.text(ctx, name, rect.x + Math.floor((128 - this.measureText(name)) / 2), rect.y + 84, palette.text, BODY);
      const label = pull.rarity.toUpperCase(); this.text(ctx, label, rect.x + Math.floor((128 - this.measureText(label, BODY, true)) / 2), rect.y + 101, tier.label, BODY, true);
      this.drawShape(ctx, pull.rarity, rect.x + 12, rect.y + rh - 12);
      if (frame.badges) {
        this.drawBadge(ctx, pull.badge === 'new' ? 'new' : pull.badge === 'star' ? 'duplicateStar' : 'duplicateGold', rect.x + rect.width - 4, rect.y + 5, pull.gold, true);
        if (pull.pity) this.drawBadge(ctx, 'pity', rect.x + 4, rect.y + 5);
      }
    });
    ctx.restore();
  }
  /** Welcome back (ui/offline-rewards.md): rewards are already in the save; Collect acknowledges. */
  private drawWelcome(ctx: CanvasRenderingContext2D, state: GameState, data: WelcomeData): void {
    const panel = this.panelRect(), x = panel.x, layout = CONFIG.ui.offlineRewards.layout, spec = CONFIG.ui.offlineRewards;
    if (this.welcomeCloseAt !== null && this.clock() >= this.welcomeCloseAt) { queueMicrotask(() => this.closeWelcome()); }
    const ms = this.welcomeMs(), rm = this.reducedMotion, closing = this.welcomeCloseAt !== null, capH = spec.capHours;
    this.frame(ctx, panel);
    this.text(ctx, 'WELCOME BACK', x + 16, 9, palette.gold, HEADING, true);
    this.button(ctx, 'welcome-close', 'X', { x: x + 680, y: 8, width: 28, height: 24 }, () => this.collect(), { disabled: closing, tooltip: 'Collect and close (Esc)' });
    this.text(ctx, `Away ${awayLabel(data.rawSeconds)}`, x + 16, 46, palette.text, BODY, true);
    const note = data.capped ? `Rewards capped · max ${capH}h` : `max ${capH}h`;
    this.text(ctx, note, x + 704 - this.measureText(note), 46, data.capped ? palette.gold : palette.muted, BODY);
    const [bx = 16, by = 66, bw = 688, bh = 6] = layout.capBar;
    ctx.fillStyle = palette.ink; ctx.fillRect(x + bx, by, bw, bh);
    ctx.fillStyle = palette.gold; ctx.fillRect(x + bx + 1, by + 1, Math.round((bw - 2) * Math.min(1, data.seconds / (capH * 3600))), bh - 2);
    const row = (rect: readonly number[], icon: string, label: string, value: string, color: string): void => {
      const [rx = 16, ry = 80, rw = 440, rh = 64] = rect; this.frame(ctx, { x: x + rx, y: ry, width: rw, height: rh }, 'button-9slice.png');
      this.icon(ctx, icon, x + rx + 16, ry + 16, 2); this.text(ctx, label, x + rx + 64, ry + 10, palette.muted, BODY);
      this.text(ctx, value, x + rx + 64, ry + 28, color, HEADING, true, rw - 80);
    };
    row(layout.goldRow, 'gold', 'GOLD', rewardLabel(countUp(data.gold, ms, spec.countUp.goldStartMs, rm)), palette.gold);
    row(layout.xpRow, 'potion', 'XP · EACH PARTY HERO', rewardLabel(countUp(data.xp, ms, spec.countUp.xpStartMs, rm)), palette.blue);
    const [cx = 16, cy = 224, cw = 440, chh = 120] = layout.chestRow, expedition = data.expeditionChests !== undefined, max = expedition ? (CONFIG.v14.offline.expeditionChestMax || CONFIG.idle.offlineChestMax) : CONFIG.idle.offlineChestMax;
    this.frame(ctx, { x: x + cx, y: cy, width: cw, height: chh }, 'button-9slice.png');
    const title = expedition ? `EXPEDITION ${data.chests}/${max}` : `CHESTS ${data.chests}/${max}`;
    this.text(ctx, title, x + cx + 16, cy + 8, palette.text, BODY, true);
    const rule = expedition ? `${CONFIG.v14.offline.expeditionChestsPerHour} per hour · max ${max} · best of ${CONFIG.v14.offline.expeditionBestOf}` : `1 per ${CONFIG.idle.offlineChestEveryHours}h · max ${max}`;
    this.text(ctx, rule, x + cx + 16 + this.measureText(title, BODY, true) + 12, cy + 8, palette.muted, BODY, false, cw - 40 - this.measureText(title, BODY, true));
    const slots = Math.max(max, 4), perRow = Math.min(slots, 8), slot = layout.chestSlot;
    for (let i = 0; i < slots; i += 1) {
      // 4 slots: the spec's 40 px at stride 48. Expedition (16): two rows of 8 at 28 px, stride 34, 1× chest icon.
      const dense = slots > 8, stride = dense ? 34 : slot.stride, size = dense ? 28 : slot.size;
      const sxp = x + slot.x + (i % perRow) * stride, syp = (dense ? cy + 26 : slot.y) + Math.floor(i / perRow) * stride;
      const shown = i < data.chests ? chestSlot(i, ms, rm) : { shown: false, pop: false };
      if (!shown.shown) { ctx.fillStyle = palette.edge; ctx.fillRect(sxp, syp, size, 1); ctx.fillRect(sxp, syp + size - 1, size, 1); ctx.fillRect(sxp, syp, 1, size); ctx.fillRect(sxp + size - 1, syp, 1, size); continue; }
      const lift = shown.pop ? -1 : 0, scale = size >= 40 ? 2 : 1; this.frame(ctx, { x: sxp, y: syp + lift, width: size, height: size }, 'button-9slice.png'); this.icon(ctx, 'chest', sxp + Math.floor((size - 16 * scale) / 2), syp + lift + Math.floor((size - 16 * scale) / 2), scale);
    }
    const sent = data.choices > 0 ? `${data.choices} pick-1-of-2 waiting in Gear` : 'Gear sent to inventory';
    if (slots <= 4) this.text(ctx, sent, x + 232, 262, palette.muted, BODY, false, 216);
    else this.text(ctx, sent, x + cx + 16, cy + chh - 22, palette.muted, BODY, false, cw - 32);
    if (data.best && data.chests > 0) {
      const full = `Best: ${data.best.rarity[0]?.toUpperCase()}${data.best.rarity.slice(1)} ${data.best.slot[0]?.toUpperCase()}${data.best.slot.slice(1)}`, room = cw - 48 - this.measureText(sent);
      const best = this.measureText(full) <= room ? full : `Best: ${data.best.rarity.slice(0, 3).toUpperCase()}`;
      this.text(ctx, best, x + cx + cw - 16 - this.measureText(best), slots <= 4 ? cy + 8 : cy + chh - 22, CONFIG.ui.rarity[data.best.rarity].label, BODY);
    }
    // Party panel: hero tiles with level before → after.
    const [px = 464, py = 80, pw = 240, ph = 264] = layout.partyPanel, stageId = stageConfig(Math.max(1, data.stage)).id;
    this.frame(ctx, { x: x + px, y: py, width: pw, height: ph });
    this.text(ctx, `PARTY · FARMED ${stageId}`, x + px + 12, py + 10, palette.text, BODY, true, pw - 24);
    data.heroes.slice(0, 3).forEach((hero, index) => {
      const tx = x + 472 + index * 76, ty = 120;
      ctx.fillStyle = '#141c26'; ctx.fillRect(tx, ty, 64, 80); ctx.fillStyle = palette.edge; ctx.fillRect(tx, ty + 72, 64, 8);
      ctx.save(); ctx.beginPath(); ctx.rect(tx, ty, 64, 80); ctx.clip(); this.sprite(ctx, hero.id, tx + 32, 192, 0); ctx.restore();
      this.text(ctx, `Lv ${hero.levelBefore}`, tx + 4, 206, palette.muted, BODY, false, 60);
      if (hero.levelAfter > hero.levelBefore) this.text(ctx, `> ${hero.levelAfter}`, tx + 4, 224, palette.green, BODY, true, 60);
    });
    const tickets = data.tickets === undefined ? 'No tickets offline' : data.tickets > 0 ? `+${data.tickets} ticket${data.tickets === 1 ? '' : 's'} offline` : 'Ticket progress carried';
    [`${data.clears.toLocaleString('en-US')} clears at ${stageId}`, tickets, 'Progress paused'].forEach((line, index) => this.text(ctx, line, x + px + 12, 252 + index * 18, data.tickets && index === 1 ? palette.green : palette.muted, BODY, false, pw - 24));
    ctx.fillStyle = palette.edge; ctx.fillRect(x + 16, 357, panel.width - 32, 1);
    this.text(ctx, 'Rewards are already in your save', x + 16, 368, palette.muted, BODY);
    const [kx = 536, ky = 364, kw = 168, kh = 28] = layout.collectRect;
    this.button(ctx, 'welcome-collect', 'Collect', { x: x + kx, y: ky, width: kw, height: kh }, () => this.collect(), { icon: 'gold', primary: true, bold: true, disabled: closing, tooltip: 'Collect (Enter): rewards are already in your save' });
    void state;
  }
  private drawHeroes(ctx: CanvasRenderingContext2D, state: GameState, panel: Rect): void {
    const x = panel.x, columns = this.rosterColumns(), detailX = x + (panel.width >= 720 ? 424 : panel.width - 232), detailWidth = panel.width >= 720 ? 280 : 216;
    this.text(ctx, 'ROSTER', x + 16, 80, palette.text, BODY, true); this.text(ctx, `${state.roster.length}/${CONFIG.heroes.length} OWNED`, x + 208, 80, palette.muted);
    ctx.save(); ctx.beginPath(); ctx.rect(x + 16, 104, columns * 96 - 8, 248); ctx.clip();
    for (let visible = 0; visible < columns * 3; visible += 1) {
      const index = this.heroRow * columns + visible, definition = CONFIG.heroes[index]; if (!definition) continue;
      const card = { x: x + 16 + (visible % columns) * 96, y: 104 + Math.floor(visible / columns) * 84, width: 88, height: 80 };
      const owned = state.roster.some(hero => hero.id === definition.id), active = state.partyIds.includes(definition.id);
      this.button(ctx, `hero-${definition.id}`, '', card, () => { this.selectedHero = definition.id; this.onRedraw(); }, { selected: this.selectedHero === definition.id, tooltip: `${definition.name}${owned ? '' : ' — not owned'}`, cardIndex: index });
      ctx.save(); ctx.beginPath(); ctx.rect(card.x + 3, card.y + 3, 82, 74); ctx.clip(); ctx.globalAlpha = owned ? 1 : 0.45;
      this.sprite(ctx, definition.id, card.x + 43, card.y + 59, state.tick); ctx.restore();
      if (active) { ctx.fillStyle = palette.green; ctx.fillRect(card.x + 74, card.y + 6, 6, 6); }
      const name = definition.name.replace('Medieval ', '').replace('Martial ', '').replace('Fantasy ', '').replace(' (recolored Wizard)', '');
      this.text(ctx, name, card.x + 4, card.y + 60, owned ? palette.gold : palette.muted, BODY, false, 80);
    }
    ctx.restore();
    if (Math.ceil(CONFIG.heroes.length / columns) > 3) {
      ctx.fillStyle = palette.edge; ctx.fillRect(x + columns * 96 + 18, 104, 4, 248);
      ctx.fillStyle = palette.gold; ctx.fillRect(x + columns * 96 + 18, 104 + this.heroRow * 40, 4, 80);
    }
    this.frame(ctx, { x: detailX, y: 80, width: detailWidth, height: 272 });
    const definition = heroConfig(this.selectedHero), hero = state.roster.find(hero => hero.id === definition.id);
    this.text(ctx, definition.name.replace('Medieval ', '').replace(' (recolored Wizard)', ''), detailX + 16, 90, palette.gold, panel.width >= 720 ? HEADING : BODY, true, detailWidth - 32);
    ctx.save(); ctx.beginPath(); ctx.rect(detailX + 16, 112, 96, 104); ctx.clip(); this.sprite(ctx, definition.id, detailX + 63, 213, state.tick, 2); ctx.restore();
    this.text(ctx, definition.role.toUpperCase(), detailX + 126, 120, palette.text, BODY, true, detailWidth - 132);
    this.text(ctx, hero ? `Lv. ${hero.level}` : 'LOCKED', detailX + 126, 145, palette.muted, BODY, false, detailWidth - 132);
    this.text(ctx, `${hero?.stars ?? 1} STAR`, detailX + 126, 169, palette.muted, BODY, false, detailWidth - 132);
    this.text(ctx, definition.rarity.toUpperCase(), detailX + 16, 202, palette.blue, BODY);
    if (hero) {
      const stats = heroStats(state, hero), combat = state.party.find(unit => unit.sourceId === hero.id);
      this.text(ctx, `HP ${combat?.hp ?? stats.maxHp} / ${combat?.maxHp ?? stats.maxHp}`, detailX + 16, 223, palette.text, BODY);
      ctx.fillStyle = palette.ink; ctx.fillRect(detailX + 16, 244, detailWidth - 32, 6); ctx.fillStyle = palette.green; ctx.fillRect(detailX + 17, 245, Math.round((detailWidth - 34) * ((combat?.hp ?? stats.maxHp) / (combat?.maxHp ?? stats.maxHp))), 4);
      this.text(ctx, `ATK ${combat?.atk ?? stats.atk}    DEF ${combat?.def ?? stats.def}`, detailX + 16, 262, palette.text, BODY, false, detailWidth - 28);
      this.text(ctx, 'EQUIPPED', detailX + 16, 288, palette.muted, BODY);
      for (const [index, slot] of slotSchema.options.entries()) {
        this.frame(ctx, { x: detailX + 16 + index * 40, y: 304, width: 32, height: 32 }, 'button-9slice.png');
        this.icon(ctx, slot === 'weapon' ? 'sword' : slot === 'armor' ? 'armor' : 'potion', detailX + 24 + index * 40, 312);
      }
      if (!state.partyIds.includes(hero.id)) for (let slot = 0; slot < CONFIG.sim.partySize; slot += 1) this.button(ctx, `replace-${slot}`, `Slot ${slot + 1}`, { x: detailX + 8 + slot * Math.floor((detailWidth - 16) / 3), y: 328, width: Math.floor((detailWidth - 22) / 3), height: 24 }, () => {
        const ids = [...state.partyIds]; ids[slot] = hero.id; this.onAction({ type: 'party', heroIds: ids });
      }, { tooltip: `Replace slot ${slot + 1}: ${heroConfig(state.partyIds[slot] ?? '').name}` });
    } else this.text(ctx, 'Recruit to unlock', detailX + 16, 241, palette.muted, BODY);
    this.text(ctx, `FORMATION ${state.partyIds.length}/3`, x + 16, 368, palette.muted, BODY, true);
    const item = cheapestEquippedUpgrade(state), cost = item ? upgradeCost(item) : null;
    this.button(ctx, 'hero-upgrade', cost === null ? 'No gear yet' : `Upgrade ${short(cost)} G`, { x: x + panel.width - 184, y: 364, width: 168, height: 28 }, () => { if (item) this.onAction({ type: 'upgrade', gearId: item.id }); }, { disabled: !item || state.gold < (cost ?? 0), tooltip: cost === null ? 'Defeat waves to earn gear' : state.gold < cost ? `Need ${cost - state.gold} more gold` : `Upgrade equipped gear #${item?.id}: ${cost} gold` });
    if (panel.width >= 720) this.text(ctx, 'Stats refresh next stage', x + 320, 370, palette.muted, BODY, false, 208);
    this.button(ctx, 'auto-equip-heroes', 'Auto-equip', { x: x + 192, y: 364, width: 120, height: 28 }, () => this.onAction({ type: 'autoEquip' }));
  }
  private drawGear(ctx: CanvasRenderingContext2D, state: GameState, panel: Rect): void {
    const x = panel.x, cols = this.gearColumns(), detailX = x + (panel.width >= 720 ? 424 : panel.width - 232), detailWidth = panel.width >= 720 ? 280 : 216;
    const choice = state.pendingChoice?.[0];
    if (choice) this.drawChestChoice(ctx, state, choice, x + 16, detailX - 16, state.pendingChoice?.length ?? 1);
    else {
      this.text(ctx, `INVENTORY ${state.inventory.length}/${CONFIG.gear.inventoryCap}`, x + 16, 80, palette.text, BODY, true);
      const fortune = fortuneMeter(state);
      if (fortune) { const label = fortune.found ? `Fortune ${fortune.since}/${fortune.limit}` : `Legend in ${fortune.left}`; this.text(ctx, label, detailX - 16 - this.measureText(label), 80, CONFIG.ui.rarity.legendary.label, BODY); }
    }
    if (!state.inventory.some(item => item.id === this.selectedGear)) this.selectedGear = state.inventory[0]?.id ?? null;
    for (let visible = 0; visible < (choice ? 0 : cols * 5); visible += 1) {
      const item = state.inventory[this.gearRow * cols + visible];
      const rect = { x: x + 16 + visible % cols * 48, y: 112 + Math.floor(visible / cols) * 48, width: 40, height: 40 };
      if (!item) { this.frame(ctx, rect, 'button-disabled-9slice.png'); continue; }
      this.button(ctx, `gear-${item.id}`, '', rect, () => { this.selectedGear = item.id; this.onRedraw(); }, { selected: item.id === this.selectedGear, tooltip: `${item.rarity} ${item.slot} +${item.level}` });
      this.icon(ctx, item.slot === 'weapon' ? 'sword' : item.slot === 'armor' ? 'armor' : 'potion', rect.x + 12, rect.y + 9);
      this.text(ctx, String(item.level), rect.x + 24, rect.y + 24, palette.gold, BODY);
    }
    this.frame(ctx, { x: detailX, y: 80, width: detailWidth, height: 272 });
    const item = state.inventory.find(item => item.id === this.selectedGear);
    if (!item) { this.text(ctx, 'No gear yet.', detailX + 16, 112, palette.text); this.text(ctx, 'Defeat a wave.', detailX + 16, 136, palette.muted); }
    else this.gearDetail(ctx, state, item, detailX, detailWidth);
    this.button(ctx, 'gear-autoequip', 'Auto-equip best', { x: x + 16, y: 364, width: 176, height: 28 }, () => this.onAction({ type: 'autoEquip' }));
    const cost = item ? upgradeCost(item) : 0;
    this.button(ctx, 'gear-upgrade', item ? `Upgrade ${short(cost)} G` : 'Upgrade', { x: x + panel.width - 184, y: 364, width: 168, height: 28 }, () => { if (item) this.onAction({ type: 'upgrade', gearId: item.id }); }, { disabled: !item || item.level >= CONFIG.gear.upgrade.maxLevel || state.gold < cost, tooltip: item && state.gold < cost ? `Need ${cost - state.gold} more gold` : `${cost} gold; maximum +${CONFIG.gear.upgrade.maxLevel}` });
    this.button(ctx, 'gear-equip', 'Equip', { x: x + panel.width - 288, y: 364, width: 96, height: 28 }, () => { const heroId = state.partyIds[this.targetSlot]; if (item && heroId) this.onAction({ type: 'equip', heroId, gearId: item.id }); }, { disabled: !item, tooltip: `Equip to slot ${this.targetSlot + 1}: ${heroConfig(state.partyIds[this.targetSlot] ?? '').name}` });
  }
  /** CR-14-08 pick-1-of-2: the oldest pending chest as two cards with Keep buttons, in the inventory grid's place. */
  private drawChestChoice(ctx: CanvasRenderingContext2D, state: GameState, options: readonly [Gear, Gear], left: number, right: number, waiting: number): void {
    this.text(ctx, 'CHEST: PICK 1 OF 2', left, 80, palette.gold, BODY, true);
    if (waiting > 1) { const label = `${waiting} WAITING`; this.text(ctx, label, right - this.measureText(label), 80, palette.muted, BODY); }
    const width = Math.floor((right - left - 8) / 2), target = state.roster.find(hero => hero.id === state.partyIds[this.targetSlot]);
    options.forEach((item, index) => {
      const card = { x: left + index * (width + 8), y: 104, width, height: 248 }, other = options[index === 0 ? 1 : 0];
      const tier = CONFIG.ui.rarity[item.rarity];
      this.frame(ctx, card);
      ctx.fillStyle = tier.frame; ctx.fillRect(card.x + 4, card.y + 4, card.width - 8, 2);
      this.text(ctx, `${item.rarity} ${item.slot}`.toUpperCase(), card.x + 12, card.y + 14, tier.label, BODY, true, card.width - 24);
      this.icon(ctx, item.slot === 'weapon' ? 'sword' : item.slot === 'armor' ? 'armor' : 'potion', card.x + 12, card.y + 40, 3);
      let row = 0;
      for (const [key, value] of Object.entries(item.stats)) if (value) this.text(ctx, `+ ${key.toUpperCase()} ${key.endsWith('Pct') ? `${(value * 100).toFixed(1)}%` : value.toFixed(0)}`, card.x + 72, card.y + 44 + row++ * 20, palette.green, BODY, false, card.width - 80);
      this.text(ctx, `SCORE ${gearScore(item).toFixed(0)}`, card.x + 12, card.y + 104, palette.text, BODY, false, card.width - 24);
      const equipped = state.inventory.find(gear => gear.id === target?.equipment[item.slot]);
      const delta = gearScore(item) - (equipped ? gearScore(equipped) : 0);
      this.text(ctx, `vs slot ${this.targetSlot + 1}: ${delta >= 0 ? '+' : ''}${delta.toFixed(0)}`, card.x + 12, card.y + 128, delta >= 0 ? palette.green : palette.red, BODY, false, card.width - 24);
      this.text(ctx, `DROP ${CONFIG.stages[item.dropStage - 1]?.id ?? ''}`, card.x + 12, card.y + 152, palette.muted, BODY, false, card.width - 24);
      this.text(ctx, `Other salvaged +${Math.round(CONFIG.runtime.salvageBase * CONFIG.gear.rarityMult[other.rarity])} G`, card.x + 12, card.y + 176, palette.muted, BODY, false, card.width - 24);
      this.button(ctx, `chest-keep-${index}`, 'Keep', { x: card.x + 12, y: card.y + 204, width: card.width - 24, height: 28 }, () => this.onAction({ type: 'chooseChest', keep: index }),
        { tooltip: `Keep this ${item.rarity} ${item.slot}; salvage the other`, bold: true, ...(bestChoice(options) === index ? { selected: true } : {}) });
    });
  }
  private gearDetail(ctx: CanvasRenderingContext2D, state: GameState, item: Gear, x: number, width: number): void {
    this.text(ctx, `${item.rarity} ${item.slot}`, x + 16, 96, palette.gold, BODY, true, width - 32);
    this.icon(ctx, item.slot === 'weapon' ? 'sword' : item.slot === 'armor' ? 'armor' : 'potion', x + 16, 128, 3);
    this.text(ctx, `LEVEL +${item.level}`, x + 80, 134, palette.text, BODY);
    this.text(ctx, `DROP ${CONFIG.stages[item.dropStage - 1]?.id}`, x + 80, 158, palette.muted, BODY);
    let row = 0;
    for (const [key, value] of Object.entries(item.stats)) if (value) { const total = value * (1 + CONFIG.gear.upgrade.mainPerLevel * item.level); this.text(ctx, `+ ${key.toUpperCase()} ${key.endsWith('Pct') ? `${(total * 100).toFixed(1)}%` : total.toFixed(1)}`, x + 16, 200 + row++ * 22, palette.green, BODY); }
    const target = state.roster.find(hero => hero.id === state.partyIds[this.targetSlot]);
    const equipped = state.inventory.find(gear => gear.id === target?.equipment[item.slot]);
    const delta = gearScore(item) - (equipped ? gearScore(equipped) : 0);
    this.text(ctx, `vs equipped: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} score`, x + 16, 252, delta >= 0 ? palette.green : palette.red, BODY, false, width - 24);
    this.text(ctx, 'EQUIP TO PARTY SLOT', x + 16, 280, palette.muted, BODY);
    for (let slot = 0; slot < 3; slot += 1) this.button(ctx, `gear-target-${slot}`, String(slot + 1), { x: x + 16 + slot * 56, y: 304, width: 48, height: 28 }, () => { this.targetSlot = slot; this.onRedraw(); }, { selected: this.targetSlot === slot, tooltip: heroConfig(state.partyIds[slot] ?? '').name });
  }
  private drawRecruit(ctx: CanvasRenderingContext2D, state: GameState, panel: Rect): void {
    const x = panel.x, detailX = x + (panel.width >= 720 ? 424 : panel.width - 232), detailWidth = panel.width >= 720 ? 280 : 216;
    const leftWidth = panel.width >= 720 ? 184 : 136;
    for (let banner = 0; banner < (this.recruitHistoryOpen ? 0 : 2); banner += 1) {
      const bx = x + 16 + banner * (leftWidth + 8);
      this.frame(ctx, { x: bx, y: 104, width: leftWidth, height: 224 });
      this.text(ctx, banner ? 'EPIC+ PITY' : 'ALL HEROES', bx + 12, 116, palette.gold, BODY, true);
      this.sprite(ctx, banner ? 'hk2' : 'wiz', bx + Math.floor(leftWidth / 2), 240, state.tick, 2);
      this.text(ctx, banner ? `${state.pity} / ${CONFIG.gacha.pity.guaranteeEpicPlusEvery}` : '1 TICKET', bx + 12, 270, palette.text, BODY);
      this.text(ctx, banner ? 'Same hero pool' : `${state.tickets} tickets`, bx + 12, 294, palette.muted, BODY, false, leftWidth - 20);
    }
    if (this.recruitHistoryOpen) {
      this.frame(ctx, { x: x + 16, y: 104, width: detailX - x - 32, height: 224 });
      this.text(ctx, 'RECENT RECRUITS', x + 28, 112, palette.gold, BODY, true);
      this.history.slice(0, 9).forEach((entry, index) => this.text(ctx, entry, x + 28, 138 + index * 20, palette.text, BODY, false, detailX - x - 56));
    }
    this.frame(ctx, { x: detailX, y: 80, width: detailWidth, height: 272 });
    this.text(ctx, 'ACTUAL ODDS', detailX + 16, 96, palette.text, BODY, true);
    let row = 0;
    for (const [rarity, rate] of Object.entries(CONFIG.gacha.rates)) this.text(ctx, `${rarity.toUpperCase()} ${(rate * 100).toFixed(0)}%`, detailX + 16, 126 + row++ * 22, palette.muted, BODY);
    const meters = recruitMeters(state);
    if (meters) {
      this.text(ctx, `Epic+ in ${meters.epicPlus}${meters.legendary === null ? '' : ` · Legend in ${meters.legendary}`}`, detailX + 16, 224, palette.gold, BODY, false, detailWidth - 24);
      this.text(ctx, meters.newHero === null ? '30th: Epic 76.5% / Leg 23.5%' : `New hero in ${meters.newHero}`, detailX + 16, 244, meters.newHero === null ? palette.muted : palette.green, BODY, false, detailWidth - 24);
    } else {
      this.text(ctx, `Pity: ${state.pity}/${CONFIG.gacha.pity.guaranteeEpicPlusEvery}`, detailX + 16, 224, palette.gold, BODY);
      this.text(ctx, '30th: Epic 76.5% / Leg 23.5%', detailX + 16, 244, palette.muted, BODY, false, detailWidth - 24);
    }
    this.text(ctx, `Duplicates: +1 star (max ${CONFIG.growth.starMax})`, detailX + 16, 267, palette.text, BODY, false, detailWidth - 24);
    this.text(ctx, 'Then rarity-based gold.', detailX + 16, 287, palette.text, BODY, false, detailWidth - 24);
    this.text(ctx, this.history[0] ?? 'Earned tickets only.', detailX + 16, 320, palette.blue, BODY, false, detailWidth - 24);
    this.text(ctx, `HISTORY ${state.stats.pulls} PULLS`, x + 16, 334, palette.muted, BODY);
    this.button(ctx, 'recruit-history', this.recruitHistoryOpen ? 'Banners' : 'History', { x: x + 16, y: 364, width: 120, height: 28 }, () => { this.recruitHistoryOpen = !this.recruitHistoryOpen; this.onRedraw(); });
    const recruit = (count: 1 | 10): void => { this.startRecruit(count); };
    this.button(ctx, 'recruit-one', 'Recruit x1', { x: x + panel.width - 296, y: 364, width: 132, height: 28 }, () => recruit(1), { disabled: this.pending || state.tickets < CONFIG.gacha.costTickets, tooltip: `Cost ${CONFIG.gacha.costTickets} ticket; available ${state.tickets}` });
    this.button(ctx, 'recruit-ten', 'Recruit x10', { x: x + panel.width - 156, y: 364, width: 140, height: 28 }, () => recruit(10), { disabled: this.pending || state.tickets < CONFIG.gacha.costTickets * 10, tooltip: `Cost ${CONFIG.gacha.costTickets * 10} tickets; available ${state.tickets}` });
  }
  private syncControls(): void {
    const regions = this.sourceRegions();
    for (const [id, node] of this.surfaces) if (!regions.some(rect => rect.id === id)) { this.surfaces.delete(id); node.remove(); }
    for (const rect of regions) {
      let node = this.surfaces.get(rect.id);
      if (!node) { node = document.createElement('div'); node.className = 'pixel-surface'; node.dataset.region = rect.id; this.overlay.prepend(node); this.surfaces.set(rect.id, node); }
      Object.assign(node.style, { left: `${rect.x * this.scaleToCss}px`, top: `${rect.y * this.scaleToCss}px`, width: `${rect.width * this.scaleToCss}px`, height: `${rect.height * this.scaleToCss}px` });
    }
    for (const [id, button] of this.buttons) if (!this.controls.has(id)) { this.buttons.delete(id); button.remove(); }
    for (const control of this.controls.values()) {
      let button = this.buttons.get(control.id);
      if (!button) {
        button = document.createElement('button'); button.className = 'pixel-hit'; button.dataset.control = control.id;
        button.addEventListener('pointerdown', () => { this.pressed = control.id; this.onRedraw(); });
        button.addEventListener('pointerup', () => { this.pressed = ''; this.onRedraw(); });
        button.addEventListener('click', () => { this.controls.get(control.id)?.click(); });
        button.addEventListener('pointerenter', () => { this.hovered = control.id; this.hoverAt = performance.now(); this.onRedraw(); });
        button.addEventListener('pointerleave', () => { if (this.hovered === control.id) this.hovered = ''; if (this.pressed === control.id) this.pressed = ''; this.onRedraw(); });
        button.addEventListener('pointermove', event => { const bounds = this.overlay.getBoundingClientRect(); this.pointer = { x: (event.clientX - bounds.left) / this.scaleToCss, y: (event.clientY - bounds.top) / this.scaleToCss }; });
        button.addEventListener('focus', () => { this.focused = control.id; this.onRedraw(); });
        button.addEventListener('blur', () => { this.focused = ''; this.onRedraw(); });
        this.buttons.set(control.id, button); this.overlay.append(button);
      }
      button.disabled = control.disabled; button.style.zIndex = String(control.layer ?? 1);
      button.setAttribute('aria-label', control.label || control.tooltip); button.title = control.tooltip;
      if (control.cardIndex !== undefined) button.dataset.cardIndex = String(control.cardIndex);
      Object.assign(button.style, { left: `${control.x * this.scaleToCss}px`, top: `${control.y * this.scaleToCss}px`, width: `${control.width * this.scaleToCss}px`, height: `${control.height * this.scaleToCss}px` });
    }
  }
  stateForDebug() {
    const reveal = this.reveal;
    return { panel: this.panel, selectedHero: this.selectedHero, heroRow: this.heroRow, selectedGear: this.selectedGear, history: [...this.history], fontsReady: this.readyFlag,
      reveal: reveal ? { count: reveal.count, pulls: reveal.pulls.map(pull => ({ ...pull })), skipped: reveal.skipped, cued: reveal.cued, done: this.revealDone() } : null,
      welcome: this.welcome ? { ...this.welcome, closing: this.welcomeCloseAt !== null } : null, audio: { ...this.audio } };
  }
}
