import { CONFIG, TICK_MS, heroConfig, raritySchema, stageConfig } from './config';
import type { Rarity } from './config';
import { pulseGrowPx } from './motion';
import { FlashLimiter, awayLabel, burstCue, burstStartMs, chestSlot, countUp, highestCard, motes, particles, rewardLabel, singleFrame, tenFrame, welcomeChestGrid, welcomeDoneMs } from './reveal-timeline';
import type { CardFace } from './reveal-timeline';
import { BODY, FONT_FILES, HEADING, LINE_BOX, fitSize, fontFor, slotOffsetY } from './font';
import type { AtlasLibrary } from './atlas';
import type { Action, GameState, ItemId } from './core/model';
import { compactLaneLayout } from './compact-lane-layout';

export type PanelTab = 'heroes' | 'gear' | 'recruit';
export interface Rect { x: number; y: number; width: number; height: number }
/** Standalone reveal canvas: the expanded Recruit panel size (ui.md Â§4). */
/** compactMenu.shortName: drop a leading 'Medieval ' and 'Martial Hero' â†’ 'Martial' (cards and compact pull cards). */
export function shortHeroName(heroId: string): string {
  return heroConfig(heroId).name.replace(' (recolored Wizard)', '').replace(/\s*\([^)]*\)/g, '').trim().replace(/^Medieval /, '').replace(/^Martial Hero\b/, 'Martial');
}
export const REVEAL_STAGE = { width: CONFIG.ui.expanded.panelWidth, height: CONFIG.ui.expanded.panelHeight, top: 72 } as const;
export interface SourceHitRegion extends Rect { kind: 'hud' | 'panel'; id: string }
interface Control extends Rect { id: string; label: string; disabled: boolean; click(): void; tooltip: string; cardIndex?: number; layer?: number }
/** One recruit result as the reveal shows it (gacha.md Â§9: badge kind from the post-pull star count, pity from the event). */
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
/** Round half to even, as the designer's rect tables do (e.g. banner x 894.5 -> 894, 887.5 -> 888). */
export function roundHalfEven(value: number): number { const floor = Math.floor(value); return value - floor !== 0.5 ? Math.round(value) : floor % 2 === 0 ? floor : floor + 1; }
export class PixelUI {
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
  readonly reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly surfaces = new Map<string, HTMLDivElement>();
  private pressed = '';
  private controls = new Map<string, Control>();
  private current: GameState | null = null;
  private width = CONFIG.view.defaultWidth;
  private compactMode = true;
  private sourceHeight = CONFIG.ui.closed.height;
  private scaleToCss = 1;
  private hovered = '';
  private focused = '';
  private readyFlag = false;
  /** M3: gacha reveal and welcome-back panel (renderer memory only; results are already in the state). */
  private reveal: Reveal | null = null;
  /** Standalone reveal (the DOM management menu hosts its own PixelUI that only draws the reveal for pulls it committed). */
  private standalone = false;
  private revealStageWidth: number = REVEAL_STAGE.width;
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
        event.preventDefault(); event.stopImmediatePropagation();
        if (this.revealMs() < Infinity && !this.revealDone()) this.skipReveal(); else if (event.code !== 'Space') this.finishReveal(true);
        return;
      }
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
  /** Standalone: the 720Ã—400 Recruit panel's reveal (same layout, tokens and timings as the lane panel), drawn from y=72 down. */
  /**
   * `stageWidth` 624 = the docked browser panel at W=640: the 10-pull uses compactMenu.tenPullCompact (5Ã—2 of 104Ã—96) and
   * the single reveal keeps its standard card, centred; 720 (and the native window) keep gacha.tenPull / gacha.single.
   */
  drawRevealStage(ctx: CanvasRenderingContext2D, tickets: number, scaleToCss: number, stageWidth: number = REVEAL_STAGE.width): void {
    this.standalone = true; this.revealStageWidth = stageWidth; this.width = stageWidth; this.scaleToCss = scaleToCss; this.controls.clear();
    ctx.clearRect(0, 0, REVEAL_STAGE.width, REVEAL_STAGE.height);
    if (!this.readyFlag) { this.syncControls(); return; }
    const panel = { x: 0, y: 0, ...REVEAL_STAGE, width: stageWidth };
    // The host's PARTY CAMP header and tabs stay visible above y=72; the reveal owns the rest of the panel.
    ctx.fillStyle = palette.panel; ctx.fillRect(0, REVEAL_STAGE.top, stageWidth, REVEAL_STAGE.height - REVEAL_STAGE.top);
    if (this.reveal) this.drawReveal(ctx, tickets, panel, this.reveal);
    this.syncControls();
  }
  /** Compact lane edit mode (compact-menu.md Â§2.2): the stage heading shifts right of the Move handle. */
  compactEditing = false;
  /** Compact lane HUD: full-bleed field with a short stage id; Menu is the only DOM control. */
  private drawCompactLane(ctx: CanvasRenderingContext2D, state: GameState, _paused: boolean): void {
    void _paused;
    const width = this.width, coreY = this.sourceHeight - CONFIG.ui.closed.coreHeight;
    const progress = state.progress;
    const stageId = progress.kind === 'BOSS_READY' ? stageConfig(progress.bossStage).id : (CONFIG.stages[progress.stage - 1]?.id ?? '');
    const color = progress.kind === 'BOSS_READY' || progress.kind === 'BOSS_FIGHT' ? palette.red : palette.gold;
    this.text(ctx, stageId, 8, coreY + 8, color, BODY, true, undefined, { exactY: true });
    if (this.compactEditing) {
      ctx.fillStyle = CONFIG.ui.compactMenu.editMode.frameInk; ctx.fillRect(0, coreY, width, 1); ctx.fillRect(0, coreY + 79, width, 1); ctx.fillRect(0, coreY, 1, 80); ctx.fillRect(width - 1, coreY, 1, 80);
      ctx.fillStyle = CONFIG.ui.compactMenu.editMode.frameColor; ctx.fillRect(1, coreY + 1, width - 2, 1); ctx.fillRect(1, coreY + 78, width - 2, 1); ctx.fillRect(1, coreY + 1, 1, 78); ctx.fillRect(width - 2, coreY + 1, 1, 78);
    }
  }
  setCompactMode(value: boolean): void { this.compactMode = value; if (value) this.setPanel(null); this.onLayoutChange(); }
  height(): number { return this.compactMode ? CONFIG.ui.closed.height : this.isOpen() ? CONFIG.ui.expanded.height : CONFIG.ui.closed.height; }
  panelRect(): Rect {
    const width = this.width >= 736 ? CONFIG.ui.expanded.panelWidth : Math.max(608, this.width - 16);
    return { x: Math.max(8, this.width - width - CONFIG.ui.expanded.panelRightInset), y: 0, width, height: CONFIG.ui.expanded.panelHeight };
  }
  sourceRegions(): SourceHitRegion[] {
    if (this.standalone) return [{ kind: 'panel', id: 'reveal-stage', x: 0, y: REVEAL_STAGE.top, width: this.revealStageWidth, height: REVEAL_STAGE.height - REVEAL_STAGE.top }];
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
    this.current = state; this.width = width; this.coreY = coreY; this.sourceHeight = this.height(); this.scaleToCss = scaleToCss; this.controls.clear();
    if (!this.readyFlag) { this.syncControls(); return; }
    for (const event of state.events) if (event.seq > this.lastPullSeq && event.data.type === 'pull') {
      this.history.unshift(`${heroConfig(event.data.heroId).name} Â· ${event.data.rarity}${event.data.duplicate ? ' Â· duplicate +star/gold' : ' Â· NEW'}`);
      if (this.history.length > 10) this.history.pop(); this.lastPullSeq = event.seq;
    }
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
    const spec = CONFIG.ui.badges[kind], label = spec.label.replace('{gold}', String(gold)), width = this.measureText(label, BODY, true) + 8, left = alignRight ? x - width : x;
    ctx.fillStyle = spec.fill; ctx.fillRect(left, y, width, CONFIG.ui.badges.heightPx);
    this.text(ctx, label, left + 4, y + 1, spec.ink, BODY, true, undefined, { exactY: true });
  }
  /** Card face (gacha.md Â§3): back = raised 9-slice with a "?" plate; front = 2 px rarity frame, fill and 16 px floor band. */
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
    const compact = this.standalone && panel.width < REVEAL_STAGE.width, small = CONFIG.ui.compactMenu.tenPullCompact;
    // Compact: the 720-wide single stage is centred in the 624 body (it fits), the 10-pull switches to the 104Ã—96 grid.
    if (reveal.count === 1) this.drawSingle(ctx, compact ? { ...panel, x: x + Math.floor((panel.width - REVEAL_STAGE.width) / 2) } : panel, reveal, ms); else this.drawTen(ctx, panel, reveal, ms, compact);
    if (!done) { this.text(ctx, 'Click anywhere to skip', x + 16, 368, palette.muted, BODY); return; }
    const cost = CONFIG.gacha.costTickets * reveal.count, short10 = tickets < cost;
    if (reveal.count === 1) this.text(ctx, 'Click a button or press Enter', x + 16, 368, palette.muted, BODY, false, 370);
    else this.text(ctx, `Tickets ${tickets}${short10 ? ` Â· Again needs ${cost}` : ''}`, x + 16, 368, palette.muted, BODY, false, 370);
    const [ax = 400, ay = 364, aw = 152, ah = 28] = compact ? small.againRect : reveal.count === 1 ? spec.single.againRect : spec.tenPull.againRect, [ox = 560, oy = 364, ow = 144, oh = 28] = compact ? small.okRect : reveal.count === 1 ? spec.single.okRect : spec.tenPull.okRect;
    this.button(ctx, 'reveal-again', `Again x${reveal.count}`, { x: x + ax, y: ay, width: aw, height: ah }, () => { this.reveal = null; this.onRevealAgain(reveal.count); },
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
  private drawTen(ctx: CanvasRenderingContext2D, panel: Rect, reveal: Reveal, ms: number, compact = false): void {
    const x = panel.x, spec = CONFIG.ui.gacha.tenPull, small = CONFIG.ui.compactMenu.tenPullCompact, rarities = reveal.pulls.map(pull => pull.rarity), frame = tenFrame(rarities, ms, this.reducedMotion);
    const [hx = 16, hy = 88] = small.header;
    this.text(ctx, 'RECRUIT x10 RESULTS', x + 16, compact ? hy : 80, palette.text, BODY, true);
    const tally = [...raritySchema.options].reverse().map(tier => [tier, rarities.filter(r => r === tier).length] as const).filter(([, n]) => n > 0).map(([tier, n]) => `${n} ${tier.toUpperCase()}`).join(' ');
    if (frame.done) this.text(ctx, tally, x + (compact ? small.tallyMaxX : 704) - this.measureText(tally), compact ? hy : 80, palette.muted, BODY);
    void hx;
    ctx.save(); ctx.translate(reveal.flash ? frame.shakeX : 0, 0);
    reveal.pulls.forEach((pull, index) => {
      const cardFrame = frame.cards[index]; if (!cardFrame) return;
      if (compact) { this.drawTenCompactCard(ctx, x, pull, index, cardFrame, frame); return; }
      const [rx = 24, ry = 100, rw = 128, rh = 120] = spec.cardRects[index] ?? [];
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
      while (this.measureText(name) > 124 && name.length > 1) name = `${name.slice(0, -2)}â€¦`;
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
  /** compactMenu.tenPullCompact card: 104Ã—96, art (0,0,104,68), label strip (0,68,104,28), short name â‰¤ 96 px. */
  private drawTenCompactCard(ctx: CanvasRenderingContext2D, x: number, pull: RevealPull, index: number, cardFrame: ReturnType<typeof tenFrame>['cards'][number], frame: ReturnType<typeof tenFrame>): void {
    const small = CONFIG.ui.compactMenu.tenPullCompact, [rx = 36, ry = 108, rw = 104, rh = 96] = small.cardRects[index] ?? [], [, , , artH = 68] = small.artArea;
    const tier = CONFIG.ui.rarity[pull.rarity], width = Math.round(cardFrame.width * rw / 128), full = cardFrame.width >= 128;
    const rect = { x: x + rx + Math.floor((rw - width) / 2), y: ry + cardFrame.dropY, width, height: rh };
    const highlight = index === frame.highlight && (cardFrame.rimAlpha > 0 || frame.done) && ['epic', 'legendary'].includes(pull.rarity);
    if (highlight) this.drawRim(ctx, rect, tier.frame, 255);
    if (cardFrame.face === 'back') { this.drawCard(ctx, 'back', pull.rarity, pull.heroId, rect, rh, rect.y + artH - 4); return; }
    this.drawCard(ctx, cardFrame.face, pull.rarity, pull.heroId, { ...rect, height: artH }, artH, rect.y + artH - 4);
    ctx.fillStyle = palette.ink; ctx.fillRect(rect.x, rect.y + artH, rect.width, rh - artH);
    ctx.fillStyle = tier.fill; ctx.fillRect(rect.x + 1, rect.y + artH + 1, rect.width - 2, rh - artH - 1); ctx.fillStyle = tier.frame; ctx.fillRect(rect.x, rect.y + artH, rect.width, 1);
    if (!full) return;
    if (cardFrame.burstAge !== null && !this.reducedMotion) for (const dot of particles(pull.rarity, index, cardFrame.burstAge, 0.25)) { ctx.fillStyle = dot.color; ctx.fillRect(rect.x + rw / 2 + dot.x, rect.y + artH / 2 + dot.y, dot.size, dot.size); }
    let name = shortHeroName(pull.heroId);
    while (this.measureText(name) > small.nameMaxPx && name.length > 1) name = `${name.slice(0, -2)}â€¦`;
    this.text(ctx, name, rect.x + Math.floor((rw - this.measureText(name)) / 2), rect.y + small.nameYInCard, palette.text, BODY);
    const label = pull.rarity.toUpperCase(); this.text(ctx, label, rect.x + Math.floor((rw - this.measureText(label, BODY, true)) / 2), rect.y + small.rarityYInCard, tier.label, BODY, true);
    this.drawShape(ctx, pull.rarity, rect.x + 10, rect.y + small.rarityYInCard + 6);
    if (frame.badges) {
      this.drawBadge(ctx, pull.badge === 'new' ? 'new' : pull.badge === 'star' ? 'duplicateStar' : 'duplicateGold', rect.x + rect.width - 4, rect.y + 5, pull.gold, true);
      if (pull.pity) this.drawBadge(ctx, 'pity', rect.x + 4, rect.y + 5);
    }
  }
  /** Welcome back (ui/offline-rewards.md): rewards are already in the save; Collect acknowledges. */
  drawWelcome(ctx: CanvasRenderingContext2D, state: GameState, data: WelcomeData): void {
    const panel = this.panelRect(), x = panel.x, layout = CONFIG.ui.offlineRewards.layout, spec = CONFIG.ui.offlineRewards;
    if (this.welcomeCloseAt !== null && this.clock() >= this.welcomeCloseAt) { queueMicrotask(() => this.closeWelcome()); }
    const ms = this.welcomeMs(), rm = this.reducedMotion, closing = this.welcomeCloseAt !== null, capH = spec.capHours;
    this.frame(ctx, panel);
    this.text(ctx, 'WELCOME BACK', x + 16, 9, palette.gold, HEADING, true);
    this.button(ctx, 'welcome-close', 'X', { x: x + 680, y: 8, width: 28, height: 24 }, () => this.collect(), { disabled: closing, tooltip: 'Collect and close (Esc)' });
    this.text(ctx, `Away ${awayLabel(data.rawSeconds)}`, x + 16, 46, palette.text, BODY, true);
    const note = data.capped ? `Rewards capped Â· max ${capH}h` : `max ${capH}h`;
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
    row(layout.xpRow, 'potion', 'XP Â· EACH PARTY HERO', rewardLabel(countUp(data.xp, ms, spec.countUp.xpStartMs, rm)), palette.blue);
    const [cx = 16, cy = 224, cw = 440, chh = 120] = layout.chestRow, expedition = data.expeditionChests !== undefined, max = expedition ? (CONFIG.v14.offline.expeditionChestMax || CONFIG.idle.offlineChestMax) : CONFIG.idle.offlineChestMax;
    this.frame(ctx, { x: x + cx, y: cy, width: cw, height: chh }, 'button-9slice.png');
    const title = expedition ? `EXPEDITION ${data.chests}/${max}` : `CHESTS ${data.chests}/${max}`;
    this.text(ctx, title, x + cx + 16, cy + 8, palette.text, BODY, true);
    const rule = expedition ? `${CONFIG.v14.offline.expeditionChestsPerHour} per hour Â· max ${max} Â· best of ${CONFIG.v14.offline.expeditionBestOf}` : `1 per ${CONFIG.idle.offlineChestEveryHours}h Â· max ${max}`;
    this.text(ctx, rule, x + cx + 16 + this.measureText(title, BODY, true) + 12, cy + 8, palette.muted, BODY, false, cw - 40 - this.measureText(title, BODY, true));
    const slots = Math.max(max, 4), slot = layout.chestSlot, grid = welcomeChestGrid(slots), perRow = grid.perRow;
    for (let i = 0; i < slots; i += 1) {
      // 4 slots: 40 px at stride 48. 9â€“16: two rows of 8 at 28 px, stride 34. 17â€“28: two rows of 14 at 26 px, stride 29 (ends at cy + 81).
      const size = grid.size, sxp = x + slot.x + (i % perRow) * grid.stride, syp = (grid.originY ? cy + grid.originY : slot.y) + Math.floor(i / perRow) * grid.stride;
      const shown = i < data.chests ? chestSlot(i, ms, rm, data.chests) : { shown: false, pop: false };
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
    // Party panel: hero tiles with level before â†’ after.
    const [px = 464, py = 80, pw = 240, ph = 264] = layout.partyPanel, stageId = stageConfig(Math.max(1, data.stage)).id;
    this.frame(ctx, { x: x + px, y: py, width: pw, height: ph });
    this.text(ctx, `PARTY Â· FARMED ${stageId}`, x + px + 12, py + 10, palette.text, BODY, true, pw - 24);
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
