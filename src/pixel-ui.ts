import { CONFIG, TICK_MS, heroConfig, stageConfig } from './config';
import type { Rarity } from './config';
import { pulseGrowPx } from './motion';
import { FlashLimiter, awayLabel, burstCue, chestSlot, countUp, particles, revealFrame, revealSchedule, rewardLabel, welcomeDoneMs } from './reveal-timeline';
import type { CardFace, FlyingCard, RevealSchedule } from './reveal-timeline';
import { drawGate, spark } from './summoning-gate';
import { BODY, HEADING, LINE_BOX, fitSize, CSS_FONT_STACK, loadFonts, slotOffsetY } from './font';
import type { AtlasLibrary } from './atlas';
import type { Action, GameState, ItemId } from './core/model';
import { compactLaneLayout } from './compact-lane-layout';
import { stageCue } from './core/selectors';
import { getPartyHeroDefinition } from './core/party-definitions';
import { welcomeLayout } from './welcome-layout';
import { ellipsize } from './text-fit';
import { drawRoleIcon } from './management/role-icons';

export type PanelTab = 'heroes' | 'gear' | 'recruit';
export interface Rect { x: number; y: number; width: number; height: number }
/** compactMenu.shortName: drop a leading 'Medieval ' and 'Martial Hero' â†’ 'Martial' (cards and compact pull cards). */
export function shortHeroName(heroId: string): string {
  return heroConfig(heroId).name.replace(' (recolored Wizard)', '').replace(/\s*\([^)]*\)/g, '').trim().replace(/^Medieval /, '').replace(/^Martial Hero\b/, 'Martial');
}
export const REVEAL_STAGE = { width: 896, height: 452 } as const;
export interface SourceHitRegion extends Rect { kind: 'hud' | 'panel'; id: string }
interface Control extends Rect { id: string; label: string; disabled: boolean; click(): void; tooltip: string; cardIndex?: number; layer?: number }
/** One recruit result as the reveal shows it (gacha.md Â§9: badge kind from the post-pull star count, pity from the event). */
export interface RevealPull { heroId: string; rarity: Rarity; pity: boolean; badge: 'new' | 'star' | 'gold'; gold: number }
interface Reveal { plan: RevealSchedule; count: 1 | 10; pulls: RevealPull[]; startedAt: number; skipped: boolean; cued: boolean; flash: boolean | null }
/** What the welcome-back panel shows: the offline result (already credited) plus the farm stage and best item. */
export interface WelcomeData { seconds: number; rawSeconds: number; capped: boolean; clears: number; gold: number; xp: number; chests: number;
  heroes: readonly { id: string; levelBefore: number; levelAfter: number }[]; expeditionChests?: number; tickets?: number; stage: number; partialClears?: number;
  earned: boolean; farmReason: 'no-earned-clear' | 'formation-or-combat-changed' | null;
  best: { rarity: Rarity; slot: string } | null; choices: number }
export interface AudioControls { muted: boolean; volume: number }
// Face centers in the padded idle portraits. Weapons and spell particles contribute
// to the atlas bounds, so the geometric center often misses the face in a 16px crop.
const portraitFocus: Readonly<Record<string, readonly [number, number]>> = {
  'hero-knight': [25, 16], 'hero-knight-2': [22, 10],
  'medieval-king-pack': [15, 9], 'medieval-king-pack-2': [22, 10],
  'medieval-warrior-pack': [12, 9], 'medieval-warrior-pack-2': [22, 9], 'medieval-warrior-pack-3': [25, 9],
  'fantasy-warrior': [18, 9], 'martial-hero': [25, 24], 'martial-hero-2': [21, 10], 'martial-hero-3': [22, 13],
  huntress: [18, 11], 'huntress-2': [29, 11], 'wizard-pack': [17, 12], priest: [17, 12],
  'evil-wizard': [17, 17], 'evil-wizard-2': [16, 55], 'evil-wizard-3': [10, 10],
};
const counter = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const palette = CONFIG.ui.palette;
const feedback = CONFIG.ui.coreLoopFeedback;
/** Text options retain `exactY` for caller compatibility; active text has no optical y offset. */
export interface TextOptions { exactY?: boolean }
const rootUrl = (): URL => new URL(`${import.meta.env.BASE_URL}ui/`, window.location.href);
/** Round half to even, as the designer's rect tables do (e.g. banner x 894.5 -> 894, 887.5 -> 888). */
export function roundHalfEven(value: number): number { const floor = Math.floor(value); return value - floor !== 0.5 ? Math.round(value) : floor % 2 === 0 ? floor : floor + 1; }
const REDUCED_MOTION_KEY = 'taskbar-legends:reduced-motion:v1';
export function presentationReducedMotionPreference(): boolean { try { return localStorage.getItem(REDUCED_MOTION_KEY) === 'true'; } catch { return false; } }
export function setPresentationReducedMotionPreference(enabled: boolean): void {
  try { localStorage.setItem(REDUCED_MOTION_KEY, String(enabled)); } catch { /* in-memory setting is reflected by the event below */ }
  document.body.dataset.reducedMotion = String(enabled);
  window.dispatchEvent(new CustomEvent('presentation-reduced-motion-change', { detail: enabled }));
}
export class PixelUI {
  managementReducedMotion = false;
  /** Shared low-rate management idle clock; reveal transition timing continues on `clock`. */
  managementIdleClock: (() => number) | null = null;
  panel: PanelTab | null = null;
  onPanelRequest: (tab: PanelTab) => void = () => undefined;
  private coreY = 0;
  selectedHero = CONFIG.heroes[0]?.id ?? '';
  heroDetailTab: 'ability' | 'stats' | 'items' = 'ability';
  selectedGear: ItemId | null = null;
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly textCache = new Map<string, HTMLCanvasElement>();
  private measureContext: CanvasRenderingContext2D | null = null;
  private readonly badgeMemory = new Map<string, { on: boolean; pulseTick: number; seen: boolean }>();
  private readonly badgesDrawn = new Set<string>();
  animationFrozen = false;
  get reducedMotion(): boolean { return this.animationFrozen || this.managementReducedMotion || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) || presentationReducedMotionPreference(); }
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly surfaces = new Map<string, HTMLDivElement>();
  private pressed = '';
  private controls = new Map<string, Control>();
  private current: GameState | null = null;
  private width = CONFIG.view.defaultWidth;
  private compactMode = true;
  private scaleToCss = 1;
  private hovered = '';
  private focused = '';
  private readyFlag = false;
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
  /** Audio cue keys (gacha.md Â§7, offline-rewards.md); main wires these to the audio engine. */
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
    window.addEventListener('keydown', event => {
      if (this.welcome && (event.code === 'Escape' || event.code === 'Enter')) { event.preventDefault(); this.collect(); return; }
      if (this.reveal && (this.panel === 'recruit' || this.standalone) && (event.code === 'Enter' || event.code === 'Space' || event.code === 'NumpadEnter')) {
        if (event.target instanceof HTMLElement && event.target.closest('[data-control^="reveal-"]')) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (this.revealMs() < Infinity && !this.revealDone()) this.skipReveal(); else if (event.code !== 'Space') this.finishReveal(true);
        return;
      }
    });
  }
  private async load(): Promise<void> {
    try {
      await loadFonts();
      const files = ['dungeon/panel.png', 'dungeon/button.png', 'dungeon/hover.png', 'dungeon/pressed.png', 'dungeon/disabled.png', 'icon-sword.png', 'icon-armor.png', 'icon-chest.png', 'icon-potion.png', 'icon-gold.png', 'dungeon/insignia.png', 'dungeon/corridor.png', 'dungeon/summoning-hall.png'];
      await Promise.all(files.map(async file => { const image = new Image(); image.src = new URL(file, rootUrl()).href; await image.decode(); this.images.set(file, image); }));
      this.readyFlag = true;
    } catch (error) { this.errors.push(String(error)); }
  }
  private drawManagementRole(ctx: CanvasRenderingContext2D, role: string, x: number, y: number): void {
    // Integer-pixel plate + authored sword/shield/plus glyphs (no PNG load for roles).
    const left = Math.round(x), top = Math.round(y);
    ctx.fillStyle = '#17212d'; ctx.fillRect(left, top, 18, 18);
    ctx.fillStyle = '#101820'; ctx.fillRect(left + 1, top + 1, 16, 16);
    drawRoleIcon(ctx, role, left + 1, top + 1, 1);
  }
  setPanel(tab: PanelTab | null): void {
    if (tab) { this.onPanelRequest(tab); return; }
  }
  isOpen(): boolean { return this.panel !== null || this.welcome !== null; }
  /** Welcome back (offline-rewards.md): shows when â‰¥ 60 s away and something was credited; Collect only acknowledges. */
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
  private revealMs(): number { return !this.reveal ? 0 : this.reveal.skipped ? Infinity : this.clock() - this.reveal.startedAt; }
  private revealDone(): boolean {
    const reveal = this.reveal; if (!reveal) return true;
    return this.reducedMotion || this.revealMs() >= reveal.plan.doneAt;
  }
  private skipReveal(silent = false): void {
    const reveal = this.reveal; if (!reveal || reveal.skipped) return;
    reveal.skipped = true;
    if (!silent) this.onCue(CONFIG.ui.gacha.audio.click);
    // The rarity is still heard once: a skip before the burst plays the deferred burst cue, never the flash or shake.
    const pull = reveal.pulls[reveal.plan.highlight]; if (!reveal.cued && pull) { reveal.cued = true; this.onCue(burstCue(pull.rarity, pull.pity)); }
    this.onRedraw();
  }
  private finishReveal(ok: boolean): void { if (ok) { this.onCue(CONFIG.ui.gacha.audio.click); } this.reveal = null; this.onRedraw(); if (this.standalone) this.onRevealClose(); }
  /** Standalone: play the reveal for pulls the caller already committed (badges from the pre-pull star counts). */
  playReveal(count: 1 | 10, pulls: RevealPull[]): void {
    this.standalone = true; if (!pulls.length) return;
    this.reveal = { plan: revealSchedule(pulls), count, pulls, startedAt: this.clock(), skipped: false, cued: false, flash: null };
    this.onCue(CONFIG.ui.gacha.audio.pull); this.onRedraw();
  }
  /** Standalone: drop the reveal without cues (tab change, menu close). */
  clearReveal(): void { if (this.reveal && !this.revealDone()) this.skipReveal(true); this.reveal = null; this.syncControls(); }
  revealState(): { count: 1 | 10; done: boolean; pulls: RevealPull[] } | null { const reveal = this.reveal; return reveal ? { count: reveal.count, done: this.revealDone(), pulls: structuredClone(reveal.pulls) } : null; }
  drawRevealStage(ctx: CanvasRenderingContext2D, tickets: number): void {
    this.standalone = true; this.scaleToCss = 1; this.controls.clear();
    ctx.clearRect(0, 0, REVEAL_STAGE.width, REVEAL_STAGE.height);
    if (this.readyFlag && this.reveal) this.drawReveal(ctx, tickets, this.reveal);
    this.syncControls();
  }
  /** Compact lane edit mode (compact-menu.md Â§2.2): the stage heading shifts right of the Move handle. */
  compactEditing = false;
  /** Source pixels occupied by the controls and their trailing inset. */
  compactControlInset = 52;
  drawCorridor(ctx: CanvasRenderingContext2D, width: number, floor: number, offset: number, tick: number): void {
    const tile = this.images.get('dungeon/corridor.png');
    if (!tile) return;
    const top = floor - 103;
    for (let x = -(offset % tile.width); x < width; x += tile.width) {
      ctx.drawImage(tile, x, top);
      if (tick % 7 < 3) {
        ctx.fillStyle = '#ffd285';
        for (const torch of [86, 214]) ctx.fillRect(x + torch, top + 33, 2, 3);
      }
    }
  }
  /** One fixed rail reserves the remaining 128px for combat and boss warnings. */
  private drawCompactLane(ctx: CanvasRenderingContext2D, state: GameState, paused: boolean): void {
    const width = this.width, coreY = this.coreY, y = coreY - 80;
    const railEnd = width - this.compactControlInset - 5;
    const slot = railEnd < 240 ? 18 : 26;
    this.frame(ctx, { x: 0, y, width, height: 32 });
    state.party.forEach((unit, i) => {
      const x = 5 + i * (slot + 2);
      ctx.fillStyle = '#666370'; ctx.fillRect(x, y + 3, slot, 26);
      ctx.fillStyle = '#151b27'; ctx.fillRect(x + 1, y + 4, slot - 2, 24);
      const key = CONFIG.view.heroAssets[unit.sourceId as keyof typeof CONFIG.view.heroAssets];
      const portrait = key && this.atlas.portrait(key);
      if (portrait) {
        const w = Math.min(slot - 2, portrait.width), h = Math.min(19, portrait.height);
        const [faceX, faceY] = portraitFocus[key] ?? [Math.floor(portrait.width / 2), 9];
        const left = Math.max(0, Math.min(portrait.width - w, faceX - Math.floor(w / 2)));
        const top = Math.max(0, Math.min(portrait.height - h, faceY - Math.floor(h / 2)));
        ctx.drawImage(portrait, left, top, w, h, x + Math.floor((slot - w) / 2), y + 5, w, h);
      }
      ctx.fillStyle = palette.green; ctx.fillRect(x + 2, y + 25, Math.round((slot - 4) * unit.hp / unit.maxHp), 2);
    });
    const gold = counter.format(state.gold), tickets = counter.format(state.tickets);
    const goldWidth = 18 + Math.ceil(this.measureText(gold));
    const ticketWidth = 18 + Math.ceil(this.measureText(tickets));
    const start = 7 + 3 * (slot + 2);
    const stackedWallet = railEnd - start - goldWidth - ticketWidth < 166;
    const walletX = railEnd - (stackedWallet ? Math.max(goldWidth, ticketWidth) : goldWidth + 8 + ticketWidth);
    const ticketX = stackedWallet ? walletX : railEnd - ticketWidth;
    const goldY = y + (stackedWallet ? 0 : 8), ticketY = y + (stackedWallet ? 15 : 8);
    this.icon(ctx, 'gold', walletX, goldY);
    this.text(ctx, gold, walletX + 16, goldY + 2, palette.gold);
    const icons = this.images.get('dungeon/insignia.png');
    if (icons) ctx.drawImage(icons, 112, 0, 16, 16, ticketX, ticketY, 16, 16);
    this.text(ctx, tickets, ticketX + 16, ticketY + 2);

    const progress = state.progress, cue = stageCue(state);
    const betweenStages = state.phase.kind === 'rest' && state.phase.next === 'encounter';
    const cleared = betweenStages && cue?.kind === 'clear';
    const stage = cleared ? cue.stage : progress.kind === 'BOSS_READY' ? progress.bossStage : progress.stage;
    const info = stageConfig(stage), current = (stage - 1) % 10;
    const space = walletX - start - 5, narrow = space < 152;
    const wave = `${state.wave}/${info.waves.length}`;
    const label = cleared ? (narrow ? 'Clear' : 'Stage clear') : progress.kind === 'BOSS_READY' ? (narrow ? 'Ready' : 'Boss ready')
      : progress.kind === 'BOSS_FIGHT' ? (narrow ? 'Boss' : 'Boss fight') : progress.kind === 'COMPLETE' ? (narrow ? 'Done' : 'Complete')
      : betweenStages ? (narrow ? 'Next' : 'Up next') : progress.kind === 'FARMING' ? (narrow ? 'Farm' : 'Farming') : `${narrow ? 'W' : 'Wave'} ${wave}`;
    const heading = narrow ? info.id : `Stage ${info.id}`;
    this.text(ctx, heading, start, y + 2, palette.gold, BODY, true);
    this.text(ctx, label, narrow ? start : start + Math.ceil(this.measureText(heading, BODY, true)) + 10,
      y + (narrow ? 15 : 2), info.isBoss ? '#ffac8d' : palette.text);
    const barWidth = narrow ? Math.max(1, Math.min(5, Math.floor(space / 10) - 1)) : 8;
    const gap = narrow ? 1 : 2, barY = y + (narrow ? 28 : 22);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i === 9 ? palette.red : i <= current ? palette.gold : palette.edge;
      ctx.fillRect(start + i * (barWidth + gap), barY, barWidth, narrow ? 2 : 4);
    }
    if (!betweenStages && !info.isBoss && !narrow) {
      ctx.fillStyle = '#b5d7bc';
      ctx.fillRect(start + current * (barWidth + gap), barY + 3, Math.ceil(barWidth * state.wave / info.waves.length), 2);
    }
    if (!narrow && !info.isBoss) this.text(ctx, 'Boss 10', start + 102, y + 16, palette.red);
    if (paused && space >= 164) {
      ctx.fillStyle = palette.muted;
      ctx.fillRect(walletX - 10, y + 13, 2, 7); ctx.fillRect(walletX - 6, y + 13, 2, 7);
    }
    if (this.compactEditing) {
      ctx.fillStyle = CONFIG.ui.compactMenu.editMode.frameInk; ctx.fillRect(0, coreY, width, 1); ctx.fillRect(0, coreY + 79, width, 1); ctx.fillRect(0, coreY, 1, 80); ctx.fillRect(width - 1, coreY, 1, 80);
      ctx.fillStyle = CONFIG.ui.compactMenu.editMode.frameColor; ctx.fillRect(1, coreY + 1, width - 2, 1); ctx.fillRect(1, coreY + 78, width - 2, 1); ctx.fillRect(1, coreY + 1, 1, 78); ctx.fillRect(width - 2, coreY + 1, 1, 78);
    }
  }
  setCompactMode(value: boolean): void { this.compactMode = value; if (value) this.setPanel(null); this.onLayoutChange(); }
  height(): number { return this.welcome ? CONFIG.ui.expanded.height : this.compactMode ? CONFIG.ui.closed.height : this.isOpen() ? CONFIG.ui.expanded.height : CONFIG.ui.closed.height; }
  panelRect(): Rect {
    if (this.welcome) {
      const slots = this.welcome.expeditionChests !== undefined ? CONFIG.v14.offline.expeditionChestMax || CONFIG.idle.offlineChestMax : CONFIG.idle.offlineChestMax;
      return welcomeLayout(this.width, Math.max(4, slots)).panel;
    }
    const width = this.width >= 736 ? CONFIG.ui.expanded.panelWidth : Math.max(608, this.width - 16);
    return { x: Math.max(8, this.width - width - CONFIG.ui.expanded.panelRightInset), y: 0, width, height: CONFIG.ui.expanded.panelHeight };
  }
  sourceRegions(): SourceHitRegion[] {
    if (this.standalone) return [{ kind: 'panel', id: 'reveal-stage', x: 0, y: 0, ...REVEAL_STAGE }];
    if (this.welcome) return [{ kind: 'panel', id: 'welcome', ...this.panelRect() }];
    if (this.compactMode) {
      const dy = this.height() - CONFIG.ui.closed.coreHeight - CONFIG.ui.closed.coreY, layout = compactLaneLayout(this.width);
      return [
        { kind: 'hud', id: 'progress', x: layout.progress.x, y: layout.progress.y + dy, width: layout.progress.width, height: layout.progress.height },
        { kind: 'hud', id: 'actions', x: layout.actions.x, y: layout.actions.y + dy, width: layout.actions.width, height: layout.actions.height },
      ];
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
  private frame(ctx: CanvasRenderingContext2D, rect: Rect, file = 'dungeon/panel.png'): void {
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
    const family = CSS_FONT_STACK;
    // textBaseline 'top' at whole pixels; layout slots get the per-size optical offset.
    y = Math.round(y) + (options.exactY ? 0 : slotOffsetY(size, bold));
    const key = `${family}|${bold ? 700 : 400}|${size}|${color}|${value}`;
    let raster = this.textCache.get(key);
    if (!raster) {
      raster = document.createElement('canvas'); const measure = raster.getContext('2d', { willReadFrequently: true }); if (!measure) return;
      measure.font = `${bold ? 700 : 400} ${size}px ${family}`;
      const metrics = measure.measureText(value), ascent = Math.ceil(metrics.actualBoundingBoxAscent || size), descent = Math.ceil(metrics.actualBoundingBoxDescent || Math.ceil(size / 4));
      raster.width = Math.ceil(metrics.width) + 2; raster.height = ascent + descent + 2;
      // Assigning canvas dimensions resets every context property, including the font.
      measure.font = `${bold ? 700 : 400} ${size}px ${family}`;
      measure.textBaseline = 'alphabetic'; measure.fillStyle = color; measure.fillText(value, 1, ascent + 1);
      this.textCache.set(key, raster);
      if (this.textCache.size > CONFIG.runtime.textCacheLimit) { const first = this.textCache.keys().next().value; if (first !== undefined) this.textCache.delete(first); }
    }
    ctx.save();
    if (maxWidth !== undefined) { ctx.beginPath(); ctx.rect(Math.round(x), Math.round(y), maxWidth, size + 6); ctx.clip(); }
    ctx.drawImage(raster, Math.round(x), Math.round(y)); ctx.restore();
  }
  /** Advance width in source pixels, matching the face and weight used by text(). */
  measureText(value: string, size = BODY, bold = false): number {
    this.measureContext ??= document.createElement('canvas').getContext('2d');
    if (!this.measureContext) return 0;
    this.measureContext.font = `${bold ? 700 : 400} ${size}px ${CSS_FONT_STACK}`;
    return this.measureContext.measureText(value).width;
  }
  private icon(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, scale = 1): void {
    const image = this.images.get(`icon-${name}.png`); if (image) ctx.drawImage(image, Math.round(x), Math.round(y), 16 * scale, 16 * scale);
  }
  private button(ctx: CanvasRenderingContext2D, id: string, label: string, rect: Rect, click: () => void, options: { disabled?: boolean; selected?: boolean; icon?: string; tooltip?: string; cardIndex?: number; badge?: 'gold' | 'boss'; labelColor?: string; bold?: boolean; primary?: boolean } = {}): void {
    const disabled = options.disabled ?? false;
    const hover = this.hovered === id, focus = this.focused === id;
    this.controls.set(id, { ...rect, id, label, disabled, click, tooltip: options.tooltip ?? label, ...(options.cardIndex === undefined ? {} : { cardIndex: options.cardIndex }) });
    this.frame(ctx, rect, disabled ? 'dungeon/disabled.png' : this.pressed === id ? 'dungeon/pressed.png' : hover ? 'dungeon/hover.png' : 'dungeon/button.png');
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
   * Affordability pip (ui.md Â§10): 6x6 fill at (x+w-10, y+2) with a 1 px ink rim and a 2x2 highlight; red for the boss.
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
  /** Stage-clear / boss-ready plate in the effects ceiling (ui.md Â§10): panel 9-slice, 24 px tall, sized to the measured label. */
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
    this.current = state; this.width = width; this.coreY = coreY; this.scaleToCss = scaleToCss; this.controls.clear();
    if (!this.readyFlag) { this.syncControls(); return; }
    for (const event of state.events) if (event.seq > this.lastPullSeq && event.data.type === 'pull') {
      this.history.unshift(`${heroConfig(event.data.heroId).name} · ${event.data.rarity}${event.data.duplicate ? ' · duplicate +star/gold' : ' · NEW'}`);
      if (this.history.length > 10) this.history.pop(); this.lastPullSeq = event.seq;
    }
    if (this.welcome) { this.drawWelcome(ctx, state, this.welcome); this.syncControls(); return; }
    this.drawCompactLane(ctx, state, paused);
    this.syncControls();
  }
  /** Rarity shape cue (rarity-drops.md Â§2) centred on (cx, cy), 1 px 4-neighbour ink outline; rare `twinkle` = 3Ã—3 frame. */
  private drawShape(ctx: CanvasRenderingContext2D, tier: Rarity, cx: number, cy: number, twinkle = false): void {
    const shape = CONFIG.ui.rarityDrop.shapes[tier], map: readonly string[] = twinkle && 'twinkleMap' in shape ? shape.twinkleMap : shape.map;
    const colors: Record<string, string> = shape.colors, h = map.length, w = map[0]?.length ?? 0, x0 = Math.round(cx - Math.floor(w / 2)), y0 = Math.round(cy - Math.floor(h / 2));
    const inked = (x: number, y: number): boolean => { const cell = map[y]?.[x]; return cell !== undefined && cell !== '.'; };
    ctx.fillStyle = CONFIG.ui.rarityDrop.outline.color;
    for (let y = -1; y <= h; y += 1) for (let x = -1; x <= w; x += 1) if (!inked(x, y) && (inked(x - 1, y) || inked(x + 1, y) || inked(x, y - 1) || inked(x, y + 1))) ctx.fillRect(x0 + x, y0 + y, 1, 1);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) { const cell = map[y]?.[x]; if (cell && cell !== '.') { ctx.fillStyle = colors[cell] ?? '#ffffff'; ctx.fillRect(x0 + x, y0 + y, 1, 1); } }
  }
  private drawBadge(ctx: CanvasRenderingContext2D, kind: 'new' | 'duplicateStar' | 'duplicateGold' | 'pity', x: number, y: number, gold = 0, alignRight = false): void {
    const spec = CONFIG.ui.badges[kind], label = (kind === 'duplicateStar' || kind === 'duplicateGold' ? 'DUPE ' : '') + spec.label.replace('{gold}', String(gold)), width = this.measureText(label, BODY, true) + 8, left = alignRight ? x - width : x;
    ctx.fillStyle = spec.fill; ctx.fillRect(left, y, width, CONFIG.ui.badges.heightPx);
    this.text(ctx, label, left + 4, y + 1, spec.ink, BODY, true, undefined, { exactY: true });
  }
  private readonly silhouettes = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

  private drawSummonedHero(ctx: CanvasRenderingContext2D, pull: RevealPull, face: CardFace, cx: number, floor: number, width: number, height: number): void {
    const key = Object.entries(CONFIG.view.heroAssets).find(([id]) => id === pull.heroId)?.[1];
    if (!key || face === 'back') return;
    const age = this.reducedMotion ? 0 : this.managementIdleClock?.() ?? 0;
    const sprite = this.atlas.portraitFrame(key, this.atlas.idleFrameIndex(key, age));
    if (!sprite) return;
    const scale = Math.max(1, Math.min(4, Math.floor(width / sprite.width), Math.floor(height / sprite.height)));
    let art = sprite;
    if (face === 'silhouette') {
      let mask = this.silhouettes.get(sprite);
      if (!mask) {
        mask = document.createElement('canvas'); mask.width = sprite.width; mask.height = sprite.height;
        const ink = mask.getContext('2d'); if (!ink) return;
        ink.drawImage(sprite, 0, 0); ink.globalCompositeOperation = 'source-in';
        ink.fillStyle = CONFIG.ui.rarity[pull.rarity].frame; ink.fillRect(0, 0, mask.width, mask.height);
        this.silhouettes.set(sprite, mask);
      }
      art = mask;
    }
    const w = sprite.width * scale, h = sprite.height * scale;
    if (w > 0) ctx.drawImage(art, cx - Math.floor(w / 2), floor - h, w, h);
  }

  private drawOutcome(ctx: CanvasRenderingContext2D, pull: RevealPull, right: number, y: number): void {
    this.drawBadge(ctx, pull.badge === 'new' ? 'new' : pull.badge === 'star' ? 'duplicateStar' : 'duplicateGold', right, y, pull.gold, true);
  }

  private drawReveal(ctx: CanvasRenderingContext2D, tickets: number, reveal: Reveal): void {
    const ms = this.reducedMotion ? Infinity : this.revealMs();
    const { plan } = reveal;
    const frame = revealFrame(plan, ms);
    const { done, phase } = frame, group = reveal.count === 10;
    const cue = reveal.pulls[plan.highlight]!;
    if (!reveal.cued && ms >= plan.cueAt && !reveal.skipped) {
      reveal.cued = true; this.onCue(burstCue(cue.rarity, cue.pity));
    }
    if (this.reducedMotion) reveal.skipped = true;
    if (reveal.flash === null && frame.flash) reveal.flash = this.flashes.request(this.clock());

    this.frame(ctx, { x: 0, y: 0, ...REVEAL_STAGE });
    const inGrid = frame.cards.length > 0;
    this.text(ctx, inGrid && done ? 'Recruited heroes' : 'Summoning Hall', 22, 14, '#f6dcad', 24, true);
    const newCount = reveal.pulls.filter(pull => pull.badge === 'new').length;
    const header = group && done ? `${newCount} NEW   /   ${reveal.pulls.length - newCount} DUPLICATES` : `RECRUIT  ×${reveal.count}`;
    this.text(ctx, header, 872 - this.measureText(header, BODY, true), 23, palette.gold, BODY, true);

    const hall = this.images.get('dungeon/summoning-hall.png');
    ctx.save();
    ctx.beginPath(); ctx.rect(12, 56, 872, 306); ctx.clip();
    // Zoom around the astrolabe in whole-pixel steps. The source stays nearest-neighbour.
    const push = phase === 'charge' ? frame.amount : phase === 'open' ? 1 - frame.amount : phase === 'leak' ? 1 : 0;
    const zoom = Math.floor(push * 5);
    if (hall && !(group && done)) ctx.drawImage(hall, 12 - zoom * 4, 56 - zoom, 872 + zoom * 8, 304 + zoom * 3);
    if (reveal.flash) ctx.translate(frame.shakeX, 0);
    if (phase === 'charge' || phase === 'leak' || phase === 'open') {
      drawGate(ctx, phase, frame.color, frame.amount, ms);
    } else if (inGrid) {
      this.drawTen(ctx, reveal, frame.cards);
    } else {
      this.drawSummonedHero(ctx, cue, phase === 'silhouette' ? 'silhouette' : 'front', 448, 294, 232, 202);
      if (frame.burstAge !== null) {
        for (const dot of particles(cue.rarity, 0, frame.burstAge)) {
          spark(ctx, 448 + dot.x * 3, 186 + dot.y * 2, dot.size * 2 + 1, dot.color);
        }
      }
    }
    if (reveal.flash && frame.flash) {
      // One local accent on the highlighted burst, governed by the shared flash limiter.
      const cx = group ? 100 + (plan.highlight % 5) * 174 : 448;
      const cy = group ? 116 + Math.floor(plan.highlight / 5) * 156 : 186;
      spark(ctx, cx, cy, group ? 14 : 28, '#fff0c4');
    }
    ctx.restore();
    const status = done ? group ? 'Pull breakdown' : shortHeroName(cue.heroId)
      : phase === 'charge' ? 'Charging the gate…' : phase === 'leak' ? 'Light breaks through…'
      : phase === 'open' ? 'Opening the gate…' : group ? 'Revealing heroes…' : 'A hero approaches…';
    this.text(ctx, status, 22, 382, palette.text, HEADING, true);
    if (!group && done) {
      const role = getPartyHeroDefinition(cue.heroId).role;
      this.drawShape(ctx, cue.rarity, 30, 424);
      this.text(ctx, cue.rarity.toUpperCase(), 44, 417, CONFIG.ui.rarity[cue.rarity].label, BODY, true);
      this.drawManagementRole(ctx, role, 146, 414);
      this.text(ctx, role.toUpperCase(), 170, 417, palette.text, BODY);
      this.drawOutcome(ctx, cue, 330, 414);
      if (cue.pity) this.drawBadge(ctx, 'pity', 342, 414);
    } else if (group && done) {
      const tally = [...CONFIG.ui.rarity.order].reverse().map(tier => {
        const n = reveal.pulls.filter(pull => pull.rarity === tier).length;
        return n ? `${n} ${tier}` : '';
      }).filter(Boolean).join('  ·  ');
      this.text(ctx, tally, 22, 418, palette.muted);
    } else if (inGrid) {
      const count = frame.cards.filter(card => card.face === 'front').length;
      this.text(ctx, `${count} of ${reveal.pulls.length}`, 22, 418, palette.muted);
    }
    const buttonY = 390;
    if (!done) {
      this.hotspot(ctx, 'reveal-stage-skip', { x: 12, y: 56, width: 872, height: 306 }, () => this.skipReveal(), 'Skip reveal', 0);
      this.button(ctx, 'reveal-skip', 'Skip reveal', { x: 732, y: buttonY, width: 142, height: 40 }, () => this.skipReveal());
      return;
    }
    const cost = CONFIG.gacha.costTickets * reveal.count;
    if (tickets < cost) this.text(ctx, `Tickets ${tickets} · Again needs ${cost}`, 562, 430, palette.muted);
    this.button(ctx, 'reveal-again', `Again ×${reveal.count}`, { x: 562, y: buttonY, width: 164, height: 40 }, () => { this.reveal = null; this.onRevealAgain(reveal.count); },
      { icon: 'chest', disabled: tickets < cost, tooltip: `Recruit ×${reveal.count} for ${cost} ticket${cost === 1 ? '' : 's'}` });
    this.button(ctx, 'reveal-ok', 'Back to Recruit', { x: 732, y: buttonY, width: 142, height: 40 }, () => this.finishReveal(true), { primary: true, bold: true });
  }

  private drawTen(ctx: CanvasRenderingContext2D, reveal: Reveal, cards: readonly FlyingCard[]): void {
    const hall = this.images.get('dungeon/summoning-hall.png');
    const cardW = 168, cardH = 150;
    reveal.pulls.forEach((pull, i) => {
      const card = cards[i]; if (!card || card.travel === 0) return;
      const gridX = 100 + (i % 5) * 174, gridY = 56 + Math.floor(i / 5) * 156;
      const t = 1 - (1 - card.travel) ** 2;
      const cx = Math.round(448 + (gridX - 448) * t);
      const height = Math.round(cardH * (0.12 + 0.88 * t));
      const width = Math.round(cardW * (0.12 + 0.88 * t) * card.width);
      const y = Math.round(186 + (gridY + cardH / 2 - 186) * t - 80 * t * (1 - t) - height / 2);
      const x = cx - Math.floor(width / 2);
      if (!width) return;
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
      const tier = CONFIG.ui.rarity[pull.rarity];
      if (card.face === 'back') {
        ctx.fillStyle = tier.floor; ctx.fillRect(x, y, width, height);
        ctx.fillStyle = tier.frame; ctx.fillRect(x + 2, y + 2, width - 4, height - 4);
        ctx.fillStyle = tier.fill; ctx.fillRect(x + 4, y + 4, width - 8, height - 8);
        ctx.fillStyle = tier.floor; ctx.fillRect(x + 8, y + 8, width - 16, height - 16);
        ctx.fillStyle = '#302b39'; ctx.fillRect(x + 10, y + 10, width - 20, height - 20);
        const cy = y + Math.floor(height / 2), radius = Math.max(2, Math.round(22 * t));
        spark(ctx, cx, cy, radius, tier.floor); spark(ctx, cx, cy, Math.ceil(radius / 2), tier.frame);
      } else {
        ctx.fillStyle = tier.frame; ctx.fillRect(x, y, width, cardH);
        ctx.fillStyle = tier.fill; ctx.fillRect(x + 2, y + 2, width - 4, 100);
        if (hall) {
          ctx.globalAlpha = 0.48;
          ctx.drawImage(hall, 136, 17, 164, 100, cx - 82, y + 2, 164, 100);
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = '#201f2c'; ctx.fillRect(x + 2, y + 104, width - 4, 44);
        this.drawSummonedHero(ctx, pull, card.face, cx, y + 102, 144, 82);
        if (card.burstAge !== null) {
          for (const dot of particles(pull.rarity, i, card.burstAge, i === reveal.plan.highlight ? 1 : 0.25)) {
            spark(ctx, cx + dot.x, y + 60 + dot.y, dot.size + 1, dot.color);
          }
        }
        if (width === cardW && card.face === 'front') {
          this.drawManagementRole(ctx, getPartyHeroDefinition(pull.heroId).role, x + 8, y + 112);
          this.text(ctx, shortHeroName(pull.heroId), x + 30, y + 113, palette.text, BODY, true);
          this.drawShape(ctx, pull.rarity, x + 17, y + 138);
          this.text(ctx, pull.rarity.toUpperCase(), x + 30, y + 131, tier.label);
          this.drawOutcome(ctx, pull, x + width - 6, y + 6);
          if (pull.pity) this.drawBadge(ctx, 'pity', x + 6, y + 6);
        }
      }
      ctx.restore();
    });
  }
  /** Welcome back (ui/offline-rewards.md): rewards are already in the save; Collect acknowledges. */
  drawWelcome(ctx: CanvasRenderingContext2D, state: GameState, data: WelcomeData): void {
    const spec = CONFIG.ui.offlineRewards;
    const max = data.expeditionChests !== undefined ? CONFIG.v14.offline.expeditionChestMax || CONFIG.idle.offlineChestMax : CONFIG.idle.offlineChestMax;
    const layout = welcomeLayout(this.width, Math.max(4, max));
    const panel = layout.panel, x = panel.x;
    if (this.welcomeCloseAt !== null && this.clock() >= this.welcomeCloseAt) queueMicrotask(() => this.closeWelcome());
    const ms = this.welcomeMs(), rm = this.reducedMotion, closing = this.welcomeCloseAt !== null, capH = spec.capHours;
    this.frame(ctx, panel);
    this.text(ctx, 'WELCOME BACK', x + 16, 9, palette.gold, HEADING, true);
    this.button(ctx, 'welcome-close', 'X', { ...layout.close, x: x + layout.close.x }, () => this.collect(), { disabled: closing, tooltip: 'Collect and close (Esc)' });
    this.text(ctx, `Away ${awayLabel(data.rawSeconds)}`, x + 16, 46, palette.text, BODY, true);
    const note = data.capped ? `Rewards capped · max ${capH}h` : `Max ${capH}h`;
    this.text(ctx, note, x + panel.width - 16 - Math.min(this.measureText(note), panel.width - 150), 46, data.capped ? palette.gold : palette.muted, BODY, false, panel.width - 150);
    ctx.fillStyle = palette.ink; ctx.fillRect(x + layout.capBar.x, layout.capBar.y, layout.capBar.width, layout.capBar.height);
    ctx.fillStyle = palette.gold; ctx.fillRect(x + layout.capBar.x + 1, layout.capBar.y + 1, Math.round((layout.capBar.width - 2) * Math.min(1, data.seconds / (capH * 3600))), layout.capBar.height - 2);

    const row = (area: Rect, icon: string, label: string, value: string, color: string): void => {
      this.frame(ctx, { ...area, x: x + area.x }, 'dungeon/button.png');
      const iconX = area.x + (layout.compact ? 8 : 16), labelX = area.x + (layout.compact ? 34 : 64);
      this.icon(ctx, icon, x + iconX, area.y + (layout.compact ? 8 : 16), layout.compact ? 1 : 2);
      const textWidth = area.width - (labelX - area.x) - 8;
      this.text(ctx, label, x + labelX, area.y + 7, palette.muted, BODY, false, textWidth);
      this.text(ctx, value, x + labelX, area.y + 27, color, HEADING, true, textWidth);
    };
    row(layout.gold, 'gold', 'GOLD', rewardLabel(countUp(data.gold, ms, spec.countUp.goldStartMs, rm)), palette.gold);
    row(layout.xp, 'potion', layout.compact ? 'XP / HERO' : 'XP · EACH PARTY HERO', rewardLabel(countUp(data.xp, ms, spec.countUp.xpStartMs, rm)), palette.blue);

    const expedition = data.expeditionChests !== undefined;
    const chest = layout.chest, title = expedition ? `EXPEDITION ${data.chests}/${max}` : `CHESTS ${data.chests}/${max}`;
    this.frame(ctx, { ...chest, x: x + chest.x }, 'dungeon/button.png');
    this.text(ctx, title, x + layout.chestTitle.x, layout.chestTitle.y, palette.text, BODY, true);
    const titleWidth = this.measureText(title, BODY, true);
    const rule = expedition ? `${CONFIG.v14.offline.expeditionChestsPerHour} per hour · max ${max} · best of ${CONFIG.v14.offline.expeditionBestOf}` : `1 per ${CONFIG.idle.offlineChestEveryHours}h · max ${max}`;
    const ruleX = layout.compact ? layout.chestRule.x : layout.chest.x + 16 + titleWidth + 12;
    const ruleWidth = layout.compact ? layout.chestRule.width : Math.max(1, layout.chest.width - 40 - titleWidth);
    this.text(ctx, ellipsize(rule, ruleWidth, value => this.measureText(value)), x + ruleX, layout.chestRule.y, palette.muted, BODY, false, ruleWidth);
    const slots = Math.max(max, 4), grid = layout.chestGrid;
    for (let i = 0; i < slots; i += 1) {
      const sxp = x + grid.x + (i % grid.perRow) * grid.stride, syp = grid.y + Math.floor(i / grid.perRow) * grid.stride;
      const shown = i < data.chests ? chestSlot(i, ms, rm, data.chests) : { shown: false, pop: false };
      if (!shown.shown) {
        ctx.fillStyle = palette.edge;
        ctx.fillRect(sxp, syp, grid.size, 1); ctx.fillRect(sxp, syp + grid.size - 1, grid.size, 1);
        ctx.fillRect(sxp, syp, 1, grid.size); ctx.fillRect(sxp + grid.size - 1, syp, 1, grid.size);
        continue;
      }
      const lift = shown.pop ? -1 : 0, iconScale = grid.size >= 32 ? 2 : 1;
      this.frame(ctx, { x: sxp, y: syp + lift, width: grid.size, height: grid.size }, 'dungeon/button.png');
      this.icon(ctx, 'chest', sxp + Math.floor((grid.size - 16 * iconScale) / 2), syp + lift + Math.floor((grid.size - 16 * iconScale) / 2), iconScale);
    }
    const sent = data.choices > 0 ? `${data.choices} pick-1-of-2 waiting in Gear` : 'Gear sent to inventory';
    const best = !layout.compact && data.best && data.chests > 0 ? `Best: ${data.best.rarity[0]?.toUpperCase()}${data.best.rarity.slice(1)} ${data.best.slot[0]?.toUpperCase()}${data.best.slot.slice(1)}` : '';
    const bestWidth = best ? this.measureText(best) : 0, sentWidth = layout.compact ? chest.width - 24 : Math.max(1, chest.width - 32 - (best ? bestWidth + 12 : 0));
    this.text(ctx, ellipsize(sent, sentWidth, value => this.measureText(value)), x + chest.x + 12, layout.chestSentY, palette.muted, BODY, false, sentWidth);
    if (best) this.text(ctx, ellipsize(best, chest.width - 32, value => this.measureText(value)), x + chest.x + chest.width - 16 - bestWidth, chest.y + chest.height - 22, CONFIG.ui.rarity[data.best!.rarity].label, BODY);

    const stageId = stageConfig(Math.max(1, data.stage)).id;
    if (!layout.compact) this.frame(ctx, { ...layout.party, x: x + layout.party.x });
    this.text(ctx, `PARTY · FARMED ${stageId}`, x + layout.partyTitle.x, layout.partyTitle.y, palette.text, BODY, true, layout.partyTitle.width);
    data.heroes.slice(0, 3).forEach((hero, index) => {
      const tile = layout.heroes[index]; if (!tile) return;
      if (layout.compact) {
        ctx.fillStyle = '#141c26'; ctx.fillRect(x + tile.x, tile.y, tile.width, tile.height);
        ctx.fillStyle = palette.edge; ctx.fillRect(x + tile.x, tile.y + tile.height - 2, tile.width, 2);
        ctx.save(); ctx.beginPath(); ctx.rect(x + tile.x, tile.y, tile.width, tile.height - 10); ctx.clip();
        this.sprite(ctx, hero.id, x + tile.x + tile.width / 2, tile.y + 36, 0); ctx.restore();
        const level = `Lv ${hero.levelBefore}${hero.levelAfter > hero.levelBefore ? ` → ${hero.levelAfter}` : ''}`;
        this.text(ctx, ellipsize(level, tile.width - 8, value => this.measureText(value)), x + tile.x + 4, tile.y + 40, hero.levelAfter > hero.levelBefore ? palette.green : palette.muted, BODY, hero.levelAfter > hero.levelBefore, tile.width - 8);
      } else {
        ctx.fillStyle = '#141c26'; ctx.fillRect(x + tile.x, tile.y, tile.width, tile.height);
        ctx.fillStyle = palette.edge; ctx.fillRect(x + tile.x, tile.y + 72, tile.width, 8);
        ctx.save(); ctx.beginPath(); ctx.rect(x + tile.x, tile.y, tile.width, tile.height); ctx.clip();
        this.sprite(ctx, hero.id, x + tile.x + tile.width / 2, tile.y + tile.height - 8, 0); ctx.restore();
        this.text(ctx, `Lv ${hero.levelBefore}`, x + tile.x + 4, tile.y + 86, palette.muted, BODY, false, tile.width - 8);
        if (hero.levelAfter > hero.levelBefore) this.text(ctx, `→ ${hero.levelAfter}`, x + tile.x + 4, tile.y + 104, palette.green, BODY, true, tile.width - 8);
      }
    });
    const ticketStatus = data.tickets === undefined ? 'No tickets offline' : data.tickets > 0 ? `+${data.tickets} ticket${data.tickets === 1 ? '' : 's'} offline` : 'Ticket progress carried';
    const partial = `Next clear ${Math.round((data.partialClears ?? 0) * 100)}% complete`;
    const rate = data.earned ? 'Rate earned by this formation' : 'Starting estimate · clear to earn a stage rate';
    if (layout.compact) {
      const clears = data.clears >= 1_000_000 ? `${(data.clears / 1_000_000).toFixed(1)}M` : data.clears >= 10_000 ? `${(data.clears / 1_000).toFixed(1)}K` : data.clears.toLocaleString('en-US');
      this.text(ctx, ellipsize(`${clears} clears · ${ticketStatus}`, layout.clearSummary.width, value => this.measureText(value)), x + layout.clearSummary.x, layout.clearSummary.y, data.tickets ? palette.green : palette.muted, BODY, false, layout.clearSummary.width);
      this.text(ctx, partial, x + layout.partialSummary.x, layout.partialSummary.y, palette.muted, BODY, false, layout.partialSummary.width);
      this.text(ctx, rate, x + layout.rateSummary.x, layout.rateSummary.y, data.earned ? palette.muted : palette.gold, BODY, false, layout.rateSummary.width);
    } else {
      this.text(ctx, `${data.clears.toLocaleString('en-US')} clears at ${stageId}`, x + layout.clearSummary.x, layout.clearSummary.y, palette.muted, BODY, false, layout.clearSummary.width);
      this.text(ctx, ticketStatus, x + layout.partialSummary.x, layout.partialSummary.y, data.tickets ? palette.green : palette.muted, BODY, false, layout.partialSummary.width);
      this.text(ctx, partial, x + layout.rateSummary.x, layout.rateSummary.y, palette.muted, BODY, false, layout.rateSummary.width);
      this.text(ctx, data.earned ? 'Rate earned by this formation' : 'Starting estimate', x + layout.party.x + 12, layout.party.y + 230, data.earned ? palette.muted : palette.gold, BODY, false, layout.party.width - 24);
      if (!data.earned) this.text(ctx, 'Clear a stage to earn its rate', x + layout.party.x + 12, layout.party.y + 246, palette.gold, BODY, false, layout.party.width - 24);
    }
    ctx.fillStyle = palette.edge; ctx.fillRect(x + 16, layout.dividerY, panel.width - 32, 1);
    this.text(ctx, layout.compact ? 'Rewards already saved' : 'Rewards are already in your save', x + layout.saveNote.x, layout.saveNote.y, palette.muted, BODY, false, layout.saveNote.width);
    const tooltip = `Collect (Enter): rewards already saved. ${data.gold.toLocaleString('en-US')} gold, ${data.xp.toLocaleString('en-US')} XP per hero, ${data.chests} chests, ${data.clears.toLocaleString('en-US')} clears.`;
    this.button(ctx, 'welcome-collect', 'Collect', { ...layout.collect, x: x + layout.collect.x }, () => this.collect(), { icon: 'gold', primary: true, bold: true, disabled: closing, tooltip });
    void state;
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
        button.addEventListener('pointerenter', () => { this.hovered = control.id; this.onRedraw(); });
        button.addEventListener('pointerleave', () => { if (this.hovered === control.id) this.hovered = ''; if (this.pressed === control.id) this.pressed = ''; this.onRedraw(); });
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
    return { panel: this.panel, selectedHero: this.selectedHero, selectedGear: this.selectedGear, history: [...this.history], fontsReady: this.readyFlag,
      reveal: reveal ? { count: reveal.count, pulls: reveal.pulls.map(pull => ({ ...pull })), skipped: reveal.skipped, cued: reveal.cued, done: this.revealDone() } : null,
      welcome: this.welcome ? { ...this.welcome, closing: this.welcomeCloseAt !== null } : null, audio: { ...this.audio } };
  }
}
