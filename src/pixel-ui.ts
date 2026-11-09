import { CONFIG, TICK_MS, heroConfig, slotSchema, stageConfig } from './config';
import { pulseGrowPx } from './motion';
import { BODY, FONT_FILES, HEADING, LINE_BOX, SMALL, fontFor, slotOffsetY } from './font';
import type { AtlasLibrary } from './atlas';
import { cheapestEquippedUpgrade, gearScore, heroStats, upgradeCost } from './core/economy';
import { statusText } from './core/game';
import { affordability } from './core/selectors';
import type { Action, GameState, Gear, ItemId } from './core/model';

export type PanelTab = 'heroes' | 'gear' | 'recruit';
const AVAILABLE: Record<PanelTab, string> = { heroes: ': gear upgrade affordable', gear: ': upgrade or better gear available', recruit: ': ticket ready to pull' };
export interface Rect { x: number; y: number; width: number; height: number }
export interface SourceHitRegion extends Rect { kind: 'hud' | 'panel'; id: string }
interface Control extends Rect { id: string; label: string; disabled: boolean; click(): void; tooltip: string; cardIndex?: number }
const palette = CONFIG.ui.palette;
const feedback = CONFIG.ui.coreLoopFeedback;
/** Text options: `exactY` for specs that give the real Galmuri draw y; `fit` lets a non-essential label drop to Galmuri9 rather than clip. */
export interface TextOptions { exactY?: boolean; fit?: boolean }
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
  private sourceHeight = CONFIG.ui.closed.height;
  private scaleToCss = 1;
  private hovered = '';
  private focused = '';
  private hoverAt = 0;
  private pointer = { x: 0, y: 0 };
  private readyFlag = false;
  private pending = false;
  private recruitHistoryOpen = false;
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
    const wasOpen = this.panel !== null;
    this.panel = tab;
    if (wasOpen !== (tab !== null)) this.onLayoutChange(); else this.onRedraw();
  }
  private togglePanel(tab: PanelTab): void { this.setPanel(this.panel === tab ? null : tab); }
  height(): number { return this.panel ? CONFIG.ui.expanded.height : CONFIG.ui.closed.height; }
  private rosterColumns(): number { return this.width >= 736 ? 4 : 3; }
  private gearColumns(): number { return this.width >= 736 ? 8 : 6; }
  panelRect(): Rect {
    const width = this.width >= 736 ? CONFIG.ui.expanded.panelWidth : Math.max(608, this.width - 16);
    return { x: Math.max(8, this.width - width - CONFIG.ui.expanded.panelRightInset), y: 0, width, height: CONFIG.ui.expanded.panelHeight };
  }
  sourceRegions(): SourceHitRegion[] {
    const coreY = this.height() - CONFIG.ui.closed.coreHeight;
    const compact = this.width < 1000;
    const islandWidth = compact ? 200 : 280;
    const regions: SourceHitRegion[] = [{ kind: 'hud', id: 'progress', x: 8, y: coreY + 8, width: islandWidth, height: 64 },
      { kind: 'hud', id: 'actions', x: this.width - islandWidth - 8, y: coreY + 8, width: islandWidth, height: 64 }];
    if (this.quitHandler) regions.push({ ...this.quitRect(coreY), kind: 'hud', id: 'quit' });
    if (this.panel) regions.push({ ...this.panelRect(), kind: 'panel', id: 'management' });
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
    if (options.fit && maxWidth !== undefined && size === BODY && this.measureText(value, size, bold) > maxWidth) size = SMALL;
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
  private button(ctx: CanvasRenderingContext2D, id: string, label: string, rect: Rect, click: () => void, options: { disabled?: boolean; selected?: boolean; icon?: string; tooltip?: string; cardIndex?: number; badge?: 'gold' | 'boss'; labelColor?: string; bold?: boolean } = {}): void {
    const disabled = options.disabled ?? false;
    const hover = this.hovered === id, focus = this.focused === id;
    this.controls.set(id, { ...rect, id, label, disabled, click, tooltip: options.tooltip ?? label, ...(options.cardIndex === undefined ? {} : { cardIndex: options.cardIndex }) });
    this.frame(ctx, rect, disabled ? 'button-disabled-9slice.png' : this.pressed === id ? 'button-pressed-9slice.png' : hover ? 'button-hover-9slice.png' : 'button-9slice.png');
    if (options.selected) { ctx.fillStyle = palette.gold; ctx.fillRect(rect.x + 3, rect.y + rect.height - 3, rect.width - 6, 2); }
    if (options.badge) this.badge(ctx, id, rect, options.badge, hover || focus);
    if (options.icon) this.icon(ctx, options.icon, rect.x + 6, rect.y + Math.floor((rect.height - 16) / 2));
    const labelX = options.icon ? feedback.badge.labelTextX.withIcon : feedback.badge.labelTextX.noIcon;
    // Centre the 14 px line box: caps start at row 8 of a 28 px button, row 6 of a 24 px one.
    const color = disabled ? '#82909d' : options.selected || hover ? palette.gold : options.labelColor ?? palette.text;
    this.text(ctx, label, rect.x + labelX, rect.y + Math.floor((rect.height - LINE_BOX) / 2) + (this.pressed === id ? 1 : 0), color, BODY, options.bold ?? false, rect.width - labelX - (options.icon ? 5 : 4), { exactY: true });
    if (focus) { ctx.fillStyle = palette.text; ctx.fillRect(rect.x + 3, rect.y + 3, rect.width - 6, 1); ctx.fillRect(rect.x + 3, rect.y + rect.height - 4, rect.width - 6, 1); ctx.fillRect(rect.x + 3, rect.y + 3, 1, rect.height - 6); ctx.fillRect(rect.x + rect.width - 4, rect.y + 3, 1, rect.height - 6); }
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
    const compact = width < 1000, islandWidth = compact ? 200 : 280;
    const right = width - islandWidth - 8;
    this.frame(ctx, { x: 8, y: coreY + 8, width: islandWidth, height: 64 });
    this.frame(ctx, { x: right, y: coreY + 8, width: islandWidth, height: 64 });
    const stage = CONFIG.stages[state.progress.stage - 1];
    const heading = state.progress.kind === 'PUSHING' ? `GREENWAY / ${stage?.id ?? ''}` : statusText(state).replace(', next try in ', ' / ');
    const island = feedback.islandText, boss = feedback.bossButton, progress = state.progress, bossReady = progress.kind === 'BOSS_READY';
    this.text(ctx, progress.kind === 'BOSS_READY' ? boss.heading.replace('{id}', stageConfig(progress.bossStage).id) : heading, 20, coreY + island.headingDrawY, palette.gold, BODY, true, islandWidth - 20, { exactY: true });
    if (!bossReady || !boss.hidesWaveLabel) this.text(ctx, `WAVE ${state.wave}/${stage?.waves.length ?? 3}`, 20, coreY + island.row2DrawY, palette.muted, BODY, false, undefined, { exactY: true });
    this.icon(ctx, 'gold', compact ? 108 : 160, coreY + island.coinIconY); this.text(ctx, short(state.gold), compact ? 128 : 182, coreY + island.row2DrawY, palette.gold, BODY, true, compact ? 70 : 96, { exactY: true });
    ctx.fillStyle = palette.ink; ctx.fillRect(20, coreY + 59, islandWidth - 24, 4); ctx.fillStyle = palette.blue; ctx.fillRect(20, coreY + 59, Math.round((islandWidth - 24) * (state.wave - 1) / 3), 4);
    const dps = state.events.reduce((sum, event) => event.data.type === 'hit' && event.data.side === 'enemy' && state.tick - event.tick <= CONFIG.sim.ticksPerSecond * 5 ? sum + event.data.damage : sum, 0) / Math.min(5, Math.max(1, state.tick / CONFIG.sim.ticksPerSecond));
    if (!compact) this.text(ctx, `DPS ${short(Math.round(dps))}`, right + 12, coreY + island.rightRowDrawY, palette.blue, BODY, true, undefined, { exactY: true });
    this.text(ctx, paused ? 'PAUSED' : 'RUNNING', right + (compact ? 12 : this.quitHandler ? 120 : 152), coreY + island.rightRowDrawY, paused ? palette.gold : palette.green, BODY, false, undefined, { exactY: true });
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
    ctx.fillStyle = palette.edge; ctx.fillRect(x + 16, 357, w - 32, 1);
    if (this.panel === 'heroes') this.drawHeroes(ctx, state, panel);
    if (this.panel === 'gear') this.drawGear(ctx, state, panel);
    if (this.panel === 'recruit') this.drawRecruit(ctx, state, panel);
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
      this.text(ctx, name, card.x + 4, card.y + 60, owned ? palette.gold : palette.muted, BODY, false, 80, { fit: true });
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
    this.text(ctx, `INVENTORY ${state.inventory.length}/${CONFIG.gear.inventoryCap}`, x + 16, 80, palette.text, BODY, true);
    if (!state.inventory.some(item => item.id === this.selectedGear)) this.selectedGear = state.inventory[0]?.id ?? null;
    for (let visible = 0; visible < cols * 5; visible += 1) {
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
    this.text(ctx, `Pity: ${state.pity}/${CONFIG.gacha.pity.guaranteeEpicPlusEvery}`, detailX + 16, 224, palette.gold, BODY);
    this.text(ctx, '30th: Epic 76.5% / Leg 23.5%', detailX + 16, 244, palette.muted, BODY, false, detailWidth - 24);
    this.text(ctx, `Duplicates: +1 star (max ${CONFIG.growth.starMax})`, detailX + 16, 267, palette.text, BODY, false, detailWidth - 24);
    this.text(ctx, 'Then rarity-based gold.', detailX + 16, 287, palette.text, BODY, false, detailWidth - 24);
    this.text(ctx, this.history[0] ?? 'Earned tickets only.', detailX + 16, 320, palette.blue, BODY, false, detailWidth - 24);
    this.text(ctx, `HISTORY ${state.stats.pulls} PULLS`, x + 16, 334, palette.muted, BODY);
    this.button(ctx, 'recruit-history', this.recruitHistoryOpen ? 'Banners' : 'History', { x: x + 16, y: 364, width: 120, height: 28 }, () => { this.recruitHistoryOpen = !this.recruitHistoryOpen; this.onRedraw(); });
    const recruit = (count: number): void => { this.pending = true; for (let i = 0; i < count; i += 1) this.onAction({ type: 'pull' }); this.pending = false; this.onRedraw(); };
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
      button.disabled = control.disabled;
      button.setAttribute('aria-label', control.label || control.tooltip); button.title = control.tooltip;
      if (control.cardIndex !== undefined) button.dataset.cardIndex = String(control.cardIndex);
      Object.assign(button.style, { left: `${control.x * this.scaleToCss}px`, top: `${control.y * this.scaleToCss}px`, width: `${control.width * this.scaleToCss}px`, height: `${control.height * this.scaleToCss}px` });
    }
  }
  stateForDebug() { return { panel: this.panel, selectedHero: this.selectedHero, heroRow: this.heroRow, selectedGear: this.selectedGear, history: [...this.history], fontsReady: this.readyFlag }; }
}
