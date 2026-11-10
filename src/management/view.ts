import { CONFIG, heroConfig, raritySchema } from '../config';
import audioManifest from '../audio-manifest.json';
import { AtlasLibrary } from '../atlas';
import { FONT_FILES } from '../font';
import { PixelUI, REVEAL_STAGE, type RevealPull } from '../pixel-ui';
import { partyBasicDpsForStats, realizedBasicCycleTicks, upgradeCost } from '../core/economy';
import { getPartyHeroDefinition } from '../core/party-definitions';
import type { Action, GameState } from '../core/model';
import type { HeroGearComparison, ManagementReply, ManagementSnapshot } from './authority';
import type { CompactPrefs } from '../platform/desktop/compact-geometry';

export interface ManagementClient {
  snapshot(): Promise<ManagementSnapshot>;
  execute(action: Action | { type: 'pullMany'; count: 1 | 10 }, revision: number, requestId: string): Promise<ManagementReply>;
  compare(heroId: string, gearId: string): Promise<HeroGearComparison | null>;
  pause(paused: boolean): Promise<void>;
  getAudio(): Promise<{ muted: boolean; volume: number; buses?: { music: number; sfx: number; ui: number } }>;
  setAudio(value: { muted: boolean; volume: number; buses?: { music: number; sfx: number; ui: number } }): Promise<void>;
  getCompactPrefs(): Promise<CompactPrefs>;
  setCompactPrefs(value: CompactPrefs): Promise<void>;
  close(): void;
  /** Optional UI sound (ui_click, ui_open, ui_close, gacha cues); the host maps it to its audio buses. */
  cue?(key: string): void;
}
/** Epic+ pity window, as used by ManagementAuthority's epicPlusRemaining. */
const EPIC_PITY_PULLS = 30;
type Tab = 'party' | 'stash' | 'recruit' | 'upgrades' | 'settings';
const esc = (value: string): string => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
const fmt = (value: number): string => Math.round(value).toLocaleString();
const heroName = (id: string): string => heroConfig(id).name
  .replace(/\s*\([^)]*\)/g, '')
  .replace(/\s*(?:\||[-–])\s*(?:asset|pack|sprite|sheet)\b.*$/ig, '').trim();
/** Card / slot label (mockups): drop the asset-pack prefixes so names fit 88 px cards (Warrior 2, Martial 1, King 2). */
const shortName = (id: string): string => heroName(id).replace(/^Medieval /, '').replace(/^Martial Hero\b/, 'Martial');
const pct = (value: number): string => `${Math.round(value * 100)}%`;
function activeDescription(id: string) {
  const definition = getPartyHeroDefinition(id), ability = definition.active, seconds = (ticks: number | undefined) => `${(ticks ?? 0) / CONFIG.sim.ticksPerSecond}s`;
  switch (ability.kind) {
    case 'shield': return `Self-shield ${pct(ability.shieldFraction ?? 0)} max HP for ${seconds(ability.durationTicks)} when threatened or below ${pct(ability.hpThreshold ?? 0)} HP; ${seconds(ability.cooldownTicks)} cooldown`;
    case 'selfHeal': return `Heal ${pct(ability.healCoefficient ?? 0)} max HP below ${pct(ability.hpThreshold ?? 0)} HP; ${seconds(ability.cooldownTicks)} cooldown`;
    case 'cleave': return `${pct(ability.coefficient ?? 0)} damage in ${ability.radius ?? 0} range, plus ${pct(ability.secondaryCoefficient ?? 0)} to one nearby foe; ${seconds(ability.cooldownTicks)} cooldown`;
    case 'projectile': return `${pct(ability.coefficient ?? 0)} ranged damage within ${definition.basic.range} range; ${seconds(ability.cooldownTicks)} cooldown`;
    case 'burstHeal': return `Heal ${pct(ability.healCoefficient ?? 0)} ATK to an ally below ${pct(ability.hpThreshold ?? 0)} HP; ${seconds(ability.cooldownTicks)} cooldown`;
    case 'weaken': return `Reduce enemy ATK ${pct(ability.atkReduction ?? 0)} and DEF ${pct(ability.defReduction ?? 0)} for ${seconds(ability.durationTicks)}; ${seconds(ability.cooldownTicks)} cooldown`;
    case 'buff': return `Give the strongest ally +${pct(ability.atkBonus ?? 0)} ATK for ${seconds(ability.durationTicks)}; ${seconds(ability.cooldownTicks)} cooldown`;
    case 'fireball': return `${pct(ability.coefficient ?? 0)} damage at a fixed ${ability.radius ?? 0} radius, ${pct(ability.secondaryCoefficient ?? 0)} to nearby foes; ${seconds(ability.cooldownTicks)} cooldown`;
    case 'singleBurst': return `${pct(ability.coefficient ?? 0)} damage to one foe within ${definition.basic.range} range; ${seconds(ability.cooldownTicks)} cooldown`;
    case 'selfSustain': return `${pct(ability.coefficient ?? 0)} melee damage and heal ${pct(ability.healCoefficient ?? 0)} max HP on a valid hit; ${seconds(ability.cooldownTicks)} cooldown`;
    case 'intercept': return `Intercept a committed hit within ${ability.range ?? 0} range`;
  }
}
function passiveDescription(id: string) {
  const passive = getPartyHeroDefinition(id).passive, seconds = (ticks: number | undefined) => `${(ticks ?? 0) / CONFIG.sim.ticksPerSecond}s`;
  switch (passive.kind) {
    case 'intercept': return `Intercept one committed hit within ${passive.range ?? 0} range; ${seconds(passive.cooldownTicks)} cooldown`;
    case 'fourthSelfHeal': return `Every fourth successful basic heals ${pct(passive.coefficient ?? 0)} of actual HP damage dealt`;
    case 'sameTargetRamp': return `Each consecutive hit on the same foe adds ${pct(passive.coefficient ?? 0)} damage, capped at ${pct(passive.cap ?? 0)}; resets on target change`;
    case 'fourthBonus': return `Every fourth successful basic deals ${pct(passive.coefficient ?? 0)} bonus damage; missed or expired hits do not count`;
    case 'healGuard': return `A successful heal gives the recipient ${pct(passive.coefficient ?? 0)} damage reduction for ${seconds(passive.durationTicks)}`;
    case 'firstWeakenShield': return `The first weaken on each foe shields the lowest-HP ally for ${pct(passive.shieldFraction ?? 0)} max HP for ${seconds(passive.durationTicks)}`;
    case 'livingAura': return `While alive, allies take ${pct(passive.atkReduction ?? 0)} less damage`;
    case 'thirdSplash': return `Every third successful basic deals ${pct(passive.coefficient ?? 0)} splash within ${passive.radius ?? 0} range; splash cannot trigger another proc`;
    case 'fourthGuard': return `Every fourth successful basic grants ${pct(passive.atkReduction ?? 0)} damage reduction for ${seconds(passive.durationTicks)}`;
  }
}

const TABS: readonly Tab[] = ['party', 'stash', 'recruit', 'upgrades', 'settings'];
const TAB_LABEL: Record<Tab, string> = { party: 'Party', stash: 'Stash', recruit: 'Recruit', upgrades: 'Upgrades', settings: 'Settings' };
const SLOT_ICON: Record<string, string> = { weapon: 'sword', armor: 'armor', charm: 'potion' };
const PRESETS = [{ value: 'balanced', label: 'Balanced' }, { value: 'fastFarm', label: 'Fast farm' }, { value: 'bossSustain', label: 'Boss sustain' }] as const;
const MENU = CONFIG.ui.compactMenu, SLIDER = MENU.widgets.slider, VOLUME_STEP = SLIDER.volume.step;
const BUS_DEFAULTS = audioManifest.defaultVolumes;
type Choice = { value: string; label: string; rarity?: string };
type AudioValue = { muted: boolean; volume: number; buses?: { music: number; sfx: number; ui: number } };
export type ManagementVariant = 'browser' | 'native';
const asset = (path: string): string => new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).href;
const icon = (name: string): string => `<img class="px-icon" src="${asset(`ui/icon-${name}.png`)}" alt="" width="16" height="16">`;
const control = (id: string): string => `data-control="${esc(id)}"`;
const shortGold = (value: number): string => value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e4 ? `${(value / 1e3).toFixed(1)}K` : fmt(value);
const step = (value: number): number => Math.round(Math.min(1, Math.max(0, Math.round(value / VOLUME_STEP) * VOLUME_STEP)) * 100) / 100;
/** 9-slice pixel button (compact-menu.md §4): 28 px; `selected` = gold label + 2 px gold bottom rule; `primary` = gold rule. */
function button(id: string, label: string, attrs = '', options: { selected?: boolean; disabled?: boolean; primary?: boolean; icon?: string; aria?: string; pip?: 'gold' | 'blue' | 'red'; className?: string } = {}): string {
  const classes = ['px-btn', options.primary ? 'px-primary' : '', options.className ?? ''].filter(Boolean).join(' ');
  return `<button type="button" class="${classes}" ${control(id)} ${attrs}${options.selected === undefined ? '' : ` aria-pressed="${options.selected}"`}${options.disabled ? ' disabled' : ''}${options.aria ? ` aria-label="${esc(options.aria)}"` : ''}>${options.icon ? icon(options.icon) : ''}<span class="px-btn-label">${esc(label)}</span>${options.pip ? `<i class="px-pip" data-pip="${options.pip}"></i>` : ''}</button>`;
}
/** Toggle (§4): 32×16 well, 12×12 knob; role=switch. */
function toggle(id: string, action: string, on: boolean, label: string, aria: string): string {
  return `<button type="button" class="px-toggle" role="switch" aria-checked="${on}" aria-label="${esc(aria)}" ${control(id)} data-action="${action}"><span class="px-well"><span class="px-knob"></span></span><span>${esc(label)}</span></button>`;
}
/** Slider (§4): 4 px track, blue fill, 8×12 gold thumb, 0..1 in 0.05 steps, % readout. */
function slider(name: string, label: string, value: number, width: number): string {
  const pct = Math.round(value * 100), thumb = Math.round(value * (width - SLIDER.thumb[0]!));
  return `<div class="px-slider-row"><span class="px-slider-label">${esc(label)}</span><div class="px-slider" role="slider" tabindex="0" data-slider="${name}" ${control(`slider-${name}`)} aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-valuetext="${pct}%" style="width:${width}px"><span class="px-track"><span class="px-fill" style="width:${thumb + 4}px"></span></span><span class="px-thumb" style="left:${thumb}px"></span></div><span class="px-pct">${pct}%</span></div>`;
}
let fontsLoading: Promise<void> | null = null;
/** Galmuri faces (same files and names PixelUI registers); CSS falls back to monospace until they load. */
function loadFonts(): Promise<void> {
  fontsLoading ??= Promise.all(FONT_FILES.map(async ([name, file]) => { const face = new FontFace(name, `url(${asset(`fonts/${file}`)})`); await face.load(); document.fonts.add(face); })).then(() => undefined).catch(() => undefined);
  return fontsLoading;
}
const shapeCache = new Map<string, string>();
/** rarityDrop shape cue (dot / diamond / star / crown) with its 1 px ink outline, as a data URL for <img>. */
function shape(rarity: string): string {
  const tier = raritySchema.safeParse(rarity); if (!tier.success) return '';
  let url = shapeCache.get(tier.data);
  if (url === undefined) {
    const spec = CONFIG.ui.rarityDrop.shapes[tier.data], map: readonly string[] = spec.map, colors: Record<string, string> = spec.colors, h = map.length, w = map[0]?.length ?? 0;
    const canvas = document.createElement('canvas'); canvas.width = w + 2; canvas.height = h + 2; const ctx = canvas.getContext('2d');
    const inked = (x: number, y: number) => { const cell = map[y]?.[x]; return cell !== undefined && cell !== '.'; };
    if (ctx) {
      ctx.fillStyle = CONFIG.ui.rarityDrop.outline.color;
      for (let y = -1; y <= h; y += 1) for (let x = -1; x <= w; x += 1) if (!inked(x, y) && (inked(x - 1, y) || inked(x + 1, y) || inked(x, y - 1) || inked(x, y + 1))) ctx.fillRect(x + 1, y + 1, 1, 1);
      for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) { const cell = map[y]?.[x]; if (cell && cell !== '.') { ctx.fillStyle = colors[cell] ?? '#ffffff'; ctx.fillRect(x + 1, y + 1, 1, 1); } }
    }
    url = canvas.toDataURL(); shapeCache.set(tier.data, url);
  }
  return `<img class="px-shape" src="${url}" alt="" width="${(CONFIG.ui.rarityDrop.shapes[tier.data].map[0]?.length ?? 0) + 2}" height="${CONFIG.ui.rarityDrop.shapes[tier.data].map.length + 2}">`;
}
const rarityText = (rarity: string, text = rarity.toUpperCase()): string => `<span class="px-rarity" data-rarity="${esc(rarity)}">${esc(text)}</span>`;
export interface ManagementViewOptions {
  /** `browser`: docked 720×400 (or W-16 × 400) panel next to the lane; `native`: the 760×560 management window. */
  variant?: ManagementVariant;
  /** Sprite atlases for portraits and the gacha reveal; the native window creates its own. */
  atlas?: AtlasLibrary;
  /** Presentation clock for the reveal (the main window passes the debug-freezable PixelUI clock). */
  clock?: () => number;
}

/**
 * Management sheet in the PixelUI style (ui/compact-menu.md, ui-tokens compactMenu): Galmuri11 12/24 px (Galmuri9 10 px
 * hints), panel/button 9-slices, palette tokens, idle-0 outlined portraits, and pixel widgets only (button, dropdown,
 * slider, toggle, exclusive pair) — no native <select> or range input. Polling updates values and only replaces tab
 * contents when data or selection changes; the focused control is restored by its data-control id.
 */
export class ManagementView {
  private tab: Tab = 'party';
  private snapshotValue: ManagementSnapshot | null = null;
  private selectedHero = '';
  private selectedGear = '';
  private selectedPartySlot: 0 | 1 | 2 = 0;
  private slotFilter = 'all';
  private rarityFilter = 'all';
  private ownerFilter = 'all';
  private openDropdown: string | null = null;
  private message = '';
  private closed = true;
  private generation = 0;
  private timer = 0;
  private sequence = 0;
  private clientId = crypto.randomUUID();
  private contentKey = '';
  private compareKey = '';
  private comparison: HeroGearComparison | null = null;
  private pendingCompare = false;
  private pendingCompareGeneration = -1;
  private audioValue: AudioValue = { muted: false, volume: 0.5 };
  private compactPrefs: CompactPrefs | null = null;
  private dragging: { name: string; pointerId: number } | null = null;
  private readonly header: HTMLElement;
  private readonly nav: HTMLElement;
  private readonly status: HTMLElement;
  private readonly main: HTMLElement;
  private readonly footer: HTMLElement;
  private readonly revealHost: HTMLElement;
  private readonly revealCanvas: HTMLCanvasElement;
  private revealUi: PixelUI | null = null;
  private revealFrame = 0;
  private pulling = false;
  private atlas: AtlasLibrary | null;
  private readonly portraits = new Map<string, string>();
  private readonly variant: ManagementVariant;
  private readonly abort = new AbortController();
  constructor(private readonly root: HTMLElement, private readonly client: ManagementClient, private readonly onClose: () => void, private readonly options: ManagementViewOptions = {}) {
    void loadFonts().then(() => { this.contentKey = ''; this.renderContent(); });
    this.variant = options.variant ?? 'browser'; this.atlas = options.atlas ?? null;
    this.root.classList.add('px-menu'); this.root.dataset.variant = this.variant;
    for (const [key, value] of Object.entries(CONFIG.ui.palette)) this.root.style.setProperty(`--px-${key}`, value);
    for (const tier of raritySchema.options) this.root.style.setProperty(`--px-rarity-${tier}`, CONFIG.ui.rarity[tier].label);
    for (const [name, file] of [['panel', 'panel-9slice'], ['button', 'button-9slice'], ['hover', 'button-hover-9slice'], ['pressed', 'button-pressed-9slice'], ['disabled', 'button-disabled-9slice']] as const) {
      this.root.style.setProperty(`--px-${name}-9slice`, `url("${asset(`ui/${file}.png`)}")`);
    }
    this.root.innerHTML = `<header class="management-header"><h1>PARTY CAMP</h1><span class="px-run" data-run></span>${button('menu-close', 'X', 'data-close', { aria: 'Close management', className: 'px-close' })}</header>`
      + `<nav aria-label="Management tabs"></nav><span class="px-wallet" data-wallet></span><div class="management-status" role="status" aria-live="polite"></div><main></main><div class="px-divider"></div><footer class="px-footer"></footer>`
      + `<section class="reveal-stage" aria-label="Recruit reveal" hidden><canvas width="${REVEAL_STAGE.width}" height="${REVEAL_STAGE.height}" role="img" aria-label="Recruit results"></canvas><div class="reveal-controls"></div></section>`;
    this.header = this.root.querySelector('.management-header')!; this.nav = this.root.querySelector('nav')!;
    this.status = this.root.querySelector('.management-status')!; this.main = this.root.querySelector('main')!; this.footer = this.root.querySelector('footer')!;
    this.revealHost = this.root.querySelector('.reveal-stage')!; this.revealCanvas = this.revealHost.querySelector('canvas')!;
    this.renderNav();
    this.nav.addEventListener('click', event => {
      if (this.closed) return; const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-tab]') : null; if (!target?.dataset.tab) return;
      // Any tab click (including Recruit itself) leaves the reveal and shows that tab's body.
      this.stopReveal(); if (this.tab !== target.dataset.tab) this.client.cue?.('ui_click');
      this.tab = target.dataset.tab as Tab; this.openDropdown = null; this.contentKey = ''; this.renderContent(); this.renderNav();
    }, { signal: this.abort.signal });
    this.header.querySelector('[data-close]')?.addEventListener('click', () => this.close(), { signal: this.abort.signal });
    this.root.addEventListener('click', event => this.onClick(event), { signal: this.abort.signal });
    this.root.addEventListener('keydown', event => this.onKey(event), { signal: this.abort.signal });
    this.root.addEventListener('pointerdown', event => this.onPointer(event), { signal: this.abort.signal });
    this.root.addEventListener('pointermove', event => this.onPointer(event), { signal: this.abort.signal });
    this.root.addEventListener('pointerup', event => this.onPointer(event), { signal: this.abort.signal });
    this.root.addEventListener('pointercancel', event => this.onPointer(event), { signal: this.abort.signal });
    document.addEventListener('pointerdown', event => { if (this.openDropdown && !(event.target instanceof Node && this.root.contains(event.target))) { this.openDropdown = null; this.contentKey = ''; this.renderContent(); } }, { signal: this.abort.signal });
  }
  async open(): Promise<void> {
    if (!this.closed) return;
    this.closed = false; const generation = ++this.generation; this.clientId = crypto.randomUUID(); this.sequence = 0; this.root.hidden = false;
    this.client.cue?.('ui_open');
    try { [this.audioValue, this.compactPrefs] = await Promise.all([this.client.getAudio(), this.client.getCompactPrefs()]); } catch { /* window settings remain available from the main view */ }
    if (!this.isLive(generation)) return;
    if (!this.atlas) this.atlas = new AtlasLibrary();
    void this.atlas.ready.then(() => { this.portraits.clear(); this.contentKey = ''; this.renderContent(); });
    await this.refresh(generation);
    if (!this.isLive(generation)) return;
    this.timer = window.setInterval(() => { if (this.isLive(generation)) void this.refresh(generation); }, 200);
    this.nav.querySelector<HTMLButtonElement>(`[data-tab="${this.tab}"]`)?.focus();
  }
  close(): void {
    this.generation += 1; window.clearInterval(this.timer); this.timer = 0;
    if (this.closed) return;
    this.stopReveal(); this.openDropdown = null;
    this.closed = true; this.client.cue?.('ui_close'); this.client.close(); this.onClose();
  }
  dispose(): void { this.close(); this.generation += 1; this.abort.abort(); this.root.replaceChildren(); }
  /** Debug/shot hook: the reveal in this menu, or null. */
  revealState(): ReturnType<PixelUI['revealState']> { return this.revealHost.hidden ? null : this.revealUi?.revealState() ?? null; }
  private isLive(generation: number): boolean { return !this.closed && this.generation === generation; }
  private isNewer(next: ManagementSnapshot, current: ManagementSnapshot | null): boolean {
    return current === null || next.revision > current.revision || next.revision === current.revision && next.tick >= current.tick;
  }
  private async refresh(generation = this.generation): Promise<void> {
    if (!this.isLive(generation)) return;
    try {
      const fresh = await this.client.snapshot(); if (!this.isLive(generation) || !this.isNewer(fresh, this.snapshotValue)) return;
      const prior = this.snapshotValue; this.snapshotValue = fresh; this.renderHeader(); this.renderNav();
      if (!prior || this.contentSignature(prior) !== this.contentSignature(fresh)) { if (!this.dragging) this.renderContent(); }
    } catch (error) { if (this.isLive(generation)) { this.message = `Management could not refresh: ${String(error)}`; this.renderStatus(); } }
  }
  private contentSignature(value: ManagementSnapshot): string {
    const content = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'revision' && key !== 'tick')); return JSON.stringify(content);
  }
  private renderHeader(): void {
    const state = this.snapshotValue; if (!state) return;
    const wallet = this.root.querySelector<HTMLElement>('[data-wallet]'), run = this.header.querySelector<HTMLElement>('[data-run]');
    if (wallet) wallet.innerHTML = `${icon('gold')}<span class="px-gold">${shortGold(state.gold)}</span><span class="px-gold">${state.tickets} tix</span>`;
    if (run) { run.textContent = state.paused ? 'BATTLE PAUSED' : 'BATTLE CONTINUES'; run.dataset.paused = String(state.paused); }
  }
  /** Five 9-slice tabs (§5.2) with the 6×6 affordance pips: Stash blue while a chest choice waits, Upgrades gold, Recruit gold. */
  private renderNav(): void {
    const state = this.snapshotValue;
    const pips: Partial<Record<Tab, 'gold' | 'blue'>> = !state ? {} : {
      ...(state.pendingChoice?.length ? { stash: 'blue' as const } : {}),
      ...(state.tickets >= state.recruit.cost ? { recruit: 'gold' as const } : {}),
      ...(state.inventory.some(item => state.roster.some(hero => Object.values(hero.equipment).includes(item.id)) && item.level < CONFIG.gear.upgrade.maxLevel && upgradeCost(item) <= state.gold) ? { upgrades: 'gold' as const } : {}),
    };
    const html = TABS.map(tab => button(`tab-${tab}`, TAB_LABEL[tab], `data-tab="${tab}" style="${this.tabStyle(tab)}"`, { selected: tab === this.tab, ...(pips[tab] ? { pip: pips[tab] } : {}) })).join('');
    if (this.nav.dataset.html === html) return;
    const focused = document.activeElement instanceof HTMLElement && this.nav.contains(document.activeElement) ? document.activeElement.dataset.tab : undefined;
    this.nav.innerHTML = html; this.nav.dataset.html = html;
    if (focused) this.nav.querySelector<HTMLButtonElement>(`[data-tab="${focused}"]`)?.focus({ preventScroll: true });
  }
  private tabStyle(tab: Tab): string { const [x = 16, , width = 64] = MENU.browser.tabs[tab]; return `left:${x}px;width:${width}px`; }
  private renderStatus(): void { this.status.textContent = this.message; }
  private async settingRequest(operation: Promise<unknown>): Promise<void> {
    const generation = this.generation;
    try { await operation; }
    catch (error) { if (this.isLive(generation)) { this.message = `Setting could not be saved: ${String(error)}`; this.renderStatus(); } }
  }
  private async command(action: Action | { type: 'pullMany'; count: 1 | 10 }): Promise<ManagementReply | null> {
    const generation = this.generation, current = this.snapshotValue; if (!current || !this.isLive(generation)) return null;
    try {
      const reply = await this.client.execute(action, current.revision, `${this.clientId}:${++this.sequence}`);
      if (!this.isLive(generation)) return null;
      if (this.isNewer(reply.snapshot, this.snapshotValue)) this.snapshotValue = reply.snapshot;
      else await this.refresh(generation);
      if (!this.isLive(generation)) return null;
      this.message = reply.accepted ? 'Updated.' : reply.reason ?? 'Action rejected. State refreshed.';
      this.renderHeader(); this.renderNav(); this.contentKey = ''; this.renderContent(); this.renderStatus();
      return reply;
    } catch (error) { if (this.isLive(generation)) { this.message = `Action was not applied: ${String(error)}`; await this.refresh(generation); if (this.isLive(generation)) this.renderStatus(); } return null; }
  }
  /** Recruit: commit the pulls through the authority, then play the PixelUI gacha reveal (gacha.md) for exactly those pull events. */
  private async recruitPull(count: 1 | 10): Promise<void> {
    const before = this.snapshotValue; if (!before || this.pulling) return;
    this.pulling = true;
    try {
      const lastSeq = before.recentPulls.at(-1)?.seq ?? -1, stars = new Map(before.roster.map(hero => [hero.id, hero.stars]));
      this.stopReveal();
      const reply = await this.command({ type: 'pullMany', count });
      if (!reply?.accepted) return;
      const pulls: RevealPull[] = reply.snapshot.recentPulls.filter(pull => pull.seq > lastSeq).map(pull => {
        const rarity = raritySchema.parse(pull.rarity), had = stars.get(pull.heroId);
        stars.set(pull.heroId, had === undefined ? 1 : Math.min(CONFIG.growth.starMax, had + 1));
        return { heroId: pull.heroId, rarity, pity: pull.pity !== false && pull.pity !== null,
          badge: had === undefined ? 'new' : had < CONFIG.growth.starMax ? 'star' : 'gold', gold: Math.round(CONFIG.runtime.duplicateGold * CONFIG.rarity.statMult[rarity]) };
      });
      if (!pulls.length || this.closed || this.tab !== 'recruit') return;
      const ui = this.ensureRevealUi();
      this.revealHost.hidden = false; this.root.classList.add('reveal-active');
      ui.playReveal(count, pulls); this.drawReveal();
      this.revealHost.querySelector<HTMLButtonElement>('[data-control="reveal-skip"], [data-control="reveal-ok"]')?.focus({ preventScroll: true });
    } finally { this.pulling = false; }
  }
  private ensureRevealUi(): PixelUI {
    if (this.revealUi) return this.revealUi;
    this.atlas ??= new AtlasLibrary();
    const ui = new PixelUI(this.atlas, this.revealHost.querySelector<HTMLElement>('.reveal-controls')!);
    if (this.options.clock) { const clock = this.options.clock; ui.clock = () => clock(); }
    ui.onCue = key => this.client.cue?.(key);
    ui.onRedraw = () => this.drawReveal();
    ui.onRevealAgain = count => { void this.recruitPull(count); };
    ui.onRevealClose = () => { this.stopReveal(); this.root.querySelector<HTMLButtonElement>('[data-action="pull-one"]')?.focus(); };
    void Promise.all([ui.ready, this.atlas.ready]).then(() => this.drawReveal());
    this.revealUi = ui; return ui;
  }
  private drawReveal(): void {
    const ui = this.revealUi, ctx = this.revealCanvas.getContext('2d'); if (!ui || !ctx || this.revealHost.hidden) return;
    ctx.imageSmoothingEnabled = false;
    ui.drawRevealStage(ctx, this.snapshotValue?.tickets ?? 0, 1);
    window.cancelAnimationFrame(this.revealFrame);
    if (ui.revealState()) this.revealFrame = window.requestAnimationFrame(() => this.drawReveal());
  }
  private stopReveal(): void {
    window.cancelAnimationFrame(this.revealFrame); this.revealFrame = 0;
    this.revealUi?.clearReveal();
    this.revealHost.hidden = true; this.root.classList.remove('reveal-active');
  }
  /** Idle frame 0 of the outlined sheet, cropped to its ink (§3), at an integer scale. */
  private portrait(heroId: string, scale: 1 | 2 = 1): string {
    const key = Object.entries(CONFIG.view.heroAssets).find(([id]) => id === heroId)?.[1];
    if (!key || !this.atlas) return '<span class="px-portrait px-portrait-empty"></span>';
    let entry = this.portraits.get(key);
    if (entry === undefined) { const canvas = this.atlas.portrait(key); entry = canvas ? `${canvas.toDataURL()}|${canvas.width}|${canvas.height}` : ''; if (canvas) this.portraits.set(key, entry); }
    const [url, w, h] = entry.split('|');
    return url ? `<img class="px-portrait" src="${url}" alt="" width="${Number(w) * scale}" height="${Number(h) * scale}">` : '<span class="px-portrait px-portrait-empty"></span>';
  }
  private onKey(event: KeyboardEvent): void {
    if (this.closed) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (this.openDropdown) { const name = this.openDropdown; this.openDropdown = null; this.contentKey = ''; this.renderContent(); this.root.querySelector<HTMLElement>(`[data-dd-toggle="${CSS.escape(name)}"]`)?.focus(); return; }
      if (!this.revealHost.hidden) return; // PixelUI handles keys during a reveal; Esc after it is the sheet close below.
      this.close(); return;
    }
    if (target?.dataset.ddOption !== undefined || target?.dataset.ddToggle !== undefined && this.openDropdown === target.dataset.ddToggle) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      const options = [...this.root.querySelectorAll<HTMLButtonElement>(`[data-dd-option="${CSS.escape(this.openDropdown ?? '')}"]`)];
      const index = options.indexOf(target as HTMLButtonElement), next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      options[index < 0 && event.key === 'ArrowUp' ? options.length - 1 : next]?.focus(); return;
    }
    if (target?.dataset.ddToggle !== undefined && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); this.toggleDropdown(target.dataset.ddToggle, true); return; }
    const sliderNode = target?.closest<HTMLElement>('[data-slider]');
    if (sliderNode?.dataset.slider) {
      const name = sliderNode.dataset.slider, current = this.sliderValue(name);
      const next = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? current + VOLUME_STEP : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? current - VOLUME_STEP : event.key === 'Home' ? 0 : event.key === 'End' ? 1 : null;
      if (next === null) return;
      event.preventDefault(); this.setSlider(name, next, true);
    }
  }
  private onPointer(event: PointerEvent): void {
    if (this.closed) return;
    const node = event.type === 'pointerdown' ? (event.target instanceof Element ? event.target.closest<HTMLElement>('[data-slider]') : null) : this.dragging ? this.root.querySelector<HTMLElement>(`[data-slider="${CSS.escape(this.dragging.name)}"]`) : null;
    if (!node?.dataset.slider) return;
    if (event.type === 'pointerdown') { event.preventDefault(); node.focus(); this.dragging = { name: node.dataset.slider, pointerId: event.pointerId }; try { node.setPointerCapture(event.pointerId); } catch { /* synthetic pointers */ } }
    else if (this.dragging?.pointerId !== event.pointerId) return;
    const box = node.getBoundingClientRect(), value = (event.clientX - box.left - SLIDER.thumb[0]! / 2) / Math.max(1, box.width - SLIDER.thumb[0]!);
    if (event.type !== 'pointercancel') this.setSlider(node.dataset.slider, value, false);
    if (event.type === 'pointerup' || event.type === 'pointercancel') { this.dragging = null; this.contentKey = ''; this.renderContent(); }
  }
  private sliderValue(name: string): number {
    if (name === 'master') return this.audioValue.volume;
    const bus = name === 'music' || name === 'sfx' || name === 'ui' ? name : 'sfx';
    return this.audioValue.buses?.[bus] ?? BUS_DEFAULTS[bus];
  }
  /** Sliders: master = volume, music/sfx/ui = the audio bus levels (Game Lead answer 2). Updates the DOM in place while dragging. */
  private setSlider(name: string, raw: number, rerender: boolean): void {
    const value = step(raw);
    if (name === 'master') this.audioValue = { ...this.audioValue, volume: value };
    else if (name === 'music' || name === 'sfx' || name === 'ui') this.audioValue = { ...this.audioValue, buses: { music: this.sliderValue('music'), sfx: this.sliderValue('sfx'), ui: this.sliderValue('ui'), [name]: value } };
    void this.settingRequest(this.client.setAudio(this.audioValue));
    const node = this.root.querySelector<HTMLElement>(`[data-slider="${CSS.escape(name)}"]`);
    if (node) {
      const width = node.getBoundingClientRect().width || 280, thumb = Math.round(value * (width - SLIDER.thumb[0]!)), pct = Math.round(value * 100);
      node.setAttribute('aria-valuenow', String(pct)); node.setAttribute('aria-valuetext', `${pct}%`);
      node.querySelector<HTMLElement>('.px-thumb')?.style.setProperty('left', `${thumb}px`); node.querySelector<HTMLElement>('.px-fill')?.style.setProperty('width', `${thumb + 4}px`);
      const readout = node.parentElement?.querySelector('.px-pct'); if (readout) readout.textContent = `${pct}%`;
    }
    if (rerender) { this.contentKey = ''; this.renderContent(); }
  }
  private toggleDropdown(name: string, focusSelected = false): void {
    this.openDropdown = this.openDropdown === name ? null : name; this.contentKey = ''; this.renderContent();
    if (this.openDropdown && focusSelected) (this.root.querySelector<HTMLElement>(`[data-dd-option="${CSS.escape(name)}"][aria-selected="true"]`) ?? this.root.querySelector<HTMLElement>(`[data-dd-option="${CSS.escape(name)}"]`))?.focus();
  }
  private onClick(event: Event): void {
    if (this.closed) return;
    const target = event.target; if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>('button');
    if (this.openDropdown && !target.closest('.px-dd')) { this.openDropdown = null; this.contentKey = ''; this.renderContent(); }
    if (!button || !this.snapshotValue || button.disabled) return;
    const action = button.dataset.action, state = this.snapshotValue;
    if (button.dataset.ddToggle) { this.toggleDropdown(button.dataset.ddToggle, (event as MouseEvent).detail === 0); return; }
    if (button.dataset.ddOption) { const name = button.dataset.ddOption; this.openDropdown = null; this.choose(name, button.dataset.value ?? ''); this.root.querySelector<HTMLElement>(`[data-dd-toggle="${CSS.escape(name)}"]`)?.focus(); return; }
    if (button.dataset.hero) { this.selectedHero = button.dataset.hero; this.contentKey = ''; this.renderContent(); return; }
    if (button.dataset.partySlot !== undefined) { const index = Number(button.dataset.partySlot); this.selectedPartySlot = index === 1 || index === 2 ? index : 0; this.contentKey = ''; this.renderContent(); return; }
    if (button.dataset.assign) { const ids = [...state.partyIds]; ids[this.selectedPartySlot] = button.dataset.assign; if (ids.every(Boolean) && new Set(ids).size === 3) void this.command({ type: 'party', heroIds: ids }); else { this.message = 'Each formation slot needs a different owned hero.'; this.renderStatus(); } return; }
    if (button.dataset.lockHero) { void this.command({ type: 'lockHero', heroId: button.dataset.lockHero, locked: button.dataset.locked !== 'true' }); return; }
    if (button.dataset.gear) { this.selectedGear = button.dataset.gear; this.compareKey = ''; this.comparison = null; this.contentKey = ''; this.renderContent(); return; }
    if (button.dataset.zoom && this.compactPrefs) { this.compactPrefs = { ...this.compactPrefs, zoom: button.dataset.zoom === '2' ? 2 : 1 }; void this.settingRequest(this.client.setCompactPrefs(this.compactPrefs)); this.contentKey = ''; this.renderContent(); return; }
    if (action === 'pull-one') void this.recruitPull(1);
    else if (action === 'pull-ten') void this.recruitPull(10);
    else if (action === 'auto-party') void this.command({ type: 'autoParty', preset: state.partyPreset ?? 'balanced' });
    else if (action === 'auto-equip') void this.command({ type: 'autoEquip' });
    else if (action === 'choose-0' || action === 'choose-1') void this.command({ type: 'chooseChest', keep: action === 'choose-0' ? 0 : 1 });
    else if (action === 'retry') void this.command({ type: 'retry' });
    else if (action === 'upgrade' && this.selectedGear) void this.command({ type: 'upgrade', gearId: this.selectedGear as GameState['inventory'][number]['id'] });
    else if (action === 'equip' && this.selectedGear && this.selectedHero) void this.command({ type: 'equip', heroId: this.selectedHero, gearId: this.selectedGear as GameState['inventory'][number]['id'] });
    else if (action === 'pause') { const generation = this.generation; void this.settingRequest(this.client.pause(!state.paused).then(() => this.refresh(generation))); }
    else if (action === 'mute') { this.audioValue = { ...this.audioValue, muted: !this.audioValue.muted }; void this.settingRequest(this.client.setAudio(this.audioValue)); this.contentKey = ''; this.renderContent(); }
    else if (action === 'reset-size' && this.compactPrefs) { this.compactPrefs = { ...this.compactPrefs, sourceWidth: 640, sourceHeight: 160 }; void this.settingRequest(this.client.setCompactPrefs(this.compactPrefs)); this.contentKey = ''; this.renderContent(); }
  }
  /** Dropdown commits: filters and selections re-render; the preset applies at once (as the old select did). */
  private choose(name: string, value: string): void {
    if (name === 'slot') this.slotFilter = value;
    else if (name === 'rarity') this.rarityFilter = value;
    else if (name === 'owner') this.ownerFilter = value;
    else if (name === 'hero') { this.selectedHero = value; this.comparison = null; this.compareKey = ''; }
    else if (name === 'party-preset') { if (value === 'balanced' || value === 'fastFarm' || value === 'bossSustain') void this.command({ type: 'autoParty', preset: value }); this.contentKey = ''; this.renderContent(); return; }
    else if (name === 'placement' && this.compactPrefs) {
      this.compactPrefs = { ...this.compactPrefs, placement: value === 'snapped' ? 'snapped' : 'free', ...(value === 'snapped' ? { snapEdge: 'bottom' as const } : {}) };
      if (value !== 'snapped') delete this.compactPrefs.snapEdge; void this.settingRequest(this.client.setCompactPrefs(this.compactPrefs));
    }
    this.contentKey = ''; this.renderContent();
  }
  /** Pixel dropdown (§4): 9-slice button with the value and a caret; the open list is a 9-slice panel of 20 px rows. */
  private dropdown(name: string, label: string, options: readonly Choice[], current: string, width: number, attrs = ''): string {
    const open = this.openDropdown === name, value = options.find(option => option.value === current) ?? options[0];
    const valueHtml = (option: Choice | undefined) => option?.rarity ? rarityText(option.rarity, option.label) : esc(option?.label ?? '');
    return `<div class="px-dd${open ? ' px-dd-open' : ''}" data-dropdown="${esc(name)}" data-value="${esc(value?.value ?? '')}" style="width:${width}px" ${attrs}>`
      + `<button type="button" class="px-btn px-dd-button" ${control(`dd-${name}`)} data-dd-toggle="${esc(name)}" aria-haspopup="listbox" aria-expanded="${open}" aria-label="${esc(label)}: ${esc(value?.label ?? '')}"><span class="px-btn-label">${valueHtml(value)}</span><span class="px-dd-caret" aria-hidden="true">v</span></button>`
      + (open ? `<div class="px-dd-list" role="listbox" aria-label="${esc(label)}">${options.map(option => `<button type="button" class="px-dd-option" role="option" data-dd-option="${esc(name)}" data-value="${esc(option.value)}" ${control(`dd-${name}-${option.value}`)} aria-selected="${option.value === current}">${valueHtml(option)}</button>`).join('')}</div>` : '')
      + '</div>';
  }
  private renderContent(): void {
    const state = this.snapshotValue; if (!state || this.closed) return;
    const signature = `${this.tab}:${this.contentSignature(state)}:${this.selectedHero}:${this.selectedGear}:${this.selectedPartySlot}:${this.slotFilter}:${this.rarityFilter}:${this.ownerFilter}:${this.openDropdown}:${JSON.stringify(this.audioValue)}:${JSON.stringify(this.compactPrefs)}:${!!this.comparison}:${this.portraits.size}`;
    if (signature === this.contentKey) return;
    const active = document.activeElement, focusId = active instanceof HTMLElement && (this.main.contains(active) || this.footer.contains(active)) ? active.dataset.control : undefined;
    const scroll = [...this.main.querySelectorAll<HTMLElement>('[data-scroll]')].map(node => [node.dataset.scroll, node.scrollTop] as const);
    this.contentKey = signature; this.main.dataset.view = this.tab; this.root.dataset.view = this.tab;
    const [body, foot] = this.tab === 'party' ? this.party(state) : this.tab === 'stash' ? this.stash(state) : this.tab === 'recruit' ? this.recruit(state) : this.tab === 'upgrades' ? this.upgrades(state) : this.settings(state);
    this.main.innerHTML = body; this.footer.innerHTML = foot;
    for (const [key, top] of scroll) { const node = this.main.querySelector<HTMLElement>(`[data-scroll="${key}"]`); if (node) node.scrollTop = top; }
    this.renderStatus();
    if (focusId) this.root.querySelector<HTMLElement>(`[data-control="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true });
    if (this.revealUi && !this.revealHost.hidden) this.drawReveal();
    if (this.tab === 'stash' && this.selectedGear && this.selectedHero) void this.loadComparison(state);
  }
  private async loadComparison(snapshot: ManagementSnapshot): Promise<void> {
    const generation = this.generation;
    const heroId = this.selectedHero, gearId = this.selectedGear;
    const gear = snapshot.inventory.find(item => item.id === gearId), hero = snapshot.roster.find(item => item.id === heroId);
    if (!gear || !hero) return;
    const key = `${snapshot.revision}:${JSON.stringify(snapshot.heroStats[heroId])}:${JSON.stringify(gear)}/${heroId}/${gearId}`;
    if (this.compareKey === key || this.pendingCompare && this.pendingCompareGeneration === generation) return;
    this.pendingCompare = true; this.pendingCompareGeneration = generation;
    try {
      const result = await this.client.compare(heroId, gearId);
      if (!this.isLive(generation)) return;
      const latest = this.snapshotValue;
      const latestGear = latest?.inventory.find(item => item.id === gearId);
      const latestKey = latest && latestGear ? `${latest.revision}:${JSON.stringify(latest.heroStats[heroId])}:${JSON.stringify(latestGear)}/${heroId}/${gearId}` : '';
      if (latestKey === key && this.selectedHero === heroId && this.selectedGear === gearId) {
        this.compareKey = key; this.comparison = result; this.contentKey = ''; this.renderContent();
      }
    } catch { /* Comparison is read-only; the selected item and live stats remain visible. */ }
    finally { if (this.pendingCompareGeneration === generation) { this.pendingCompare = false; if (this.isLive(generation) && this.tab === 'stash' && this.snapshotValue && this.selectedHero && this.selectedGear && this.compareKey !== `${this.snapshotValue.revision}:${JSON.stringify(this.snapshotValue.heroStats[this.selectedHero])}:${JSON.stringify(this.snapshotValue.inventory.find(item => item.id === this.selectedGear))}/${this.selectedHero}/${this.selectedGear}`) void this.loadComparison(this.snapshotValue); } }
  }
  private ownerOf(state: ManagementSnapshot, id: string) { return state.roster.find(hero => Object.values(hero.equipment).includes(id as GameState['inventory'][number]['id'])); }
  /** Party (§7.1): preset row, coverage, three 96×88 formation slots, 88×80 roster cards (scroll), inspector with Assign/Lock pinned. */
  private party(state: ManagementSnapshot): [string, string] {
    const selected = state.roster.find(hero => hero.id === this.selectedHero) ?? state.roster.find(hero => hero.id === state.partyIds[0]);
    if (!this.selectedHero && selected) this.selectedHero = selected.id;
    const stats = selected ? state.heroStats[selected.id] : undefined;
    const definitions = state.partyIds.map(id => getPartyHeroDefinition(id));
    const preset = state.partyPreset ?? 'balanced';
    const missing = preset === 'fastFarm' ? [!definitions.some(value => value.tags.includes('aoe') && value.role === 'dps') && 'AoE damage', !definitions.some(value => value.role === 'dps' && !value.tags.includes('aoe')) && 'single target damage', !definitions.some(value => value.role === 'tank') && 'tank']
      : preset === 'bossSustain' ? [!definitions.some(value => value.role === 'tank') && 'tank', !definitions.some(value => value.role === 'dps' && !value.tags.includes('aoe')) && 'single target damage', !definitions.some(value => value.tags.includes('healer')) && 'healer']
      : [!definitions.some(value => value.role === 'tank') && 'tank', !definitions.some(value => value.role === 'dps') && 'damage', !definitions.some(value => value.role === 'support') && 'support'];
    const coverage = missing.filter((value): value is string => !!value);
    const selectedDef = selected ? getPartyHeroDefinition(selected.id) : undefined;
    const cycleTicks = stats ? realizedBasicCycleTicks(stats) : 6;
    const basicDps = stats && selected ? partyBasicDpsForStats(selected.id, stats) : 0;
    const slot = this.selectedPartySlot + 1;
    const slots = state.partyIds.map((id, index) => { const hero = state.roster.find(value => value.id === id);
      return `<button type="button" class="px-formation${this.selectedPartySlot === index ? ' px-sel' : ''}" ${control(`party-slot-${index}`)} data-party-slot="${index}" aria-pressed="${this.selectedPartySlot === index}" aria-label="Slot ${index + 1}: ${esc(heroName(id))}${hero?.partyLocked ? ' (locked)' : ''}" style="left:${16 + 104 * index}px">`
        + `<span class="px-index">${index + 1}</span>${hero?.partyLocked ? '<i class="px-lock" title="Locked"></i>' : ''}${this.portrait(id)}<span class="px-name">${esc(shortName(id))}</span></button>`; }).join('');
    const roster = state.roster.map(hero => { const rarity = heroConfig(hero.id).rarity;
      return `<button type="button" class="px-card${hero.id === selected?.id ? ' px-sel' : ''}" data-rarity="${rarity}" ${control(`hero-${hero.id}`)} data-hero="${esc(hero.id)}" aria-pressed="${hero.id === selected?.id}" aria-label="${esc(heroName(hero.id))}, ${rarity}, level ${hero.level}, ${hero.stars} stars">`
        + `${shape(rarity)}<span class="px-card-lv">Lv${hero.level}</span>${this.portrait(hero.id)}<span class="px-name">${esc(shortName(hero.id))}</span><span class="px-stars">${'★'.repeat(hero.stars)}</span></button>`; }).join('');
    const equipped = selected ? (['weapon', 'armor', 'charm'] as const).map(part => { const item = state.inventory.find(value => value.id === selected.equipment[part]); return item ? `<span class="px-eq" data-rarity="${item.rarity}" title="${esc(`${item.rarity} ${part} Lv ${item.level}`)}">${icon(SLOT_ICON[part] ?? 'chest')}</span>` : `<span class="px-eq px-eq-empty" title="No ${part}">${icon(SLOT_ICON[part] ?? 'chest')}</span>`; }).join('') : '';
    const hpWidth = Math.min(1, (stats?.maxHp ?? 0) / Math.max(1, ...Object.values(state.heroStats).map(value => value.maxHp)));
    const inspector = selected ? `<section class="px-inspector" aria-label="Hero details"><div class="px-insp-scroll" data-scroll="party-inspector"><div class="px-insp-top"><span class="px-pview">${this.portrait(selected.id, 2)}</span><div><h3>${esc(shortName(selected.id))}</h3>`
      + `<p>${shape(heroConfig(selected.id).rarity)}${rarityText(heroConfig(selected.id).rarity)}</p><p>${esc(selectedDef?.role.toUpperCase() ?? '')} · Lv ${selected.level} · ${selected.xp} XP</p><p class="px-gold">${'★'.repeat(selected.stars)}</p><p class="px-equip">${equipped}</p></div></div>`
      + `<div class="px-hp"><i style="width:${Math.round(hpWidth * 100)}%"></i></div><p class="px-stats"><span class="px-green">HP ${fmt(stats?.maxHp ?? 0)}</span> · ATK ${fmt(stats?.atk ?? 0)} · DEF ${fmt(stats?.def ?? 0)}</p><p class="px-blue">basic ${basicDps.toFixed(1)} DPS · realized cycle ${cycleTicks} ticks</p>`
      + `<p class="px-muted">Strength: ${esc(selectedDef?.strength ?? '')}. Weakness: ${esc(selectedDef?.weakness ?? '')}.</p><p>Active: ${esc(selectedDef ? activeDescription(selectedDef.id) : '')}.</p><p>Passive: ${esc(selectedDef ? passiveDescription(selectedDef.id) : '')}.</p></div>`
      + `<div class="px-insp-foot">${button(`assign-${selected.id}`, `Assign slot ${slot}`, `data-assign="${esc(selected.id)}"`, { primary: true, aria: `Assign ${heroName(selected.id)} to slot ${slot}` })}${button(`lock-${selected.id}`, selected.partyLocked ? 'Unlock' : 'Lock', `data-lock-hero="${esc(selected.id)}" data-locked="${selected.partyLocked === true}"`, { selected: selected.partyLocked === true, aria: selected.partyLocked ? 'Unlock preset slot' : 'Lock preset slot' })}</div></section>` : '';
    return [`<h2 class="px-sr">Party</h2><p class="px-hint" style="top:0">Choose 3 owned heroes. Presets keep locked slots.</p>`
      + `<div class="px-at" style="left:16px;top:20px">${this.dropdown('party-preset', 'Preset', PRESETS, preset, 160, 'data-setting="party-preset"')}</div>`
      + `<div class="px-at" style="left:184px;top:20px">${button('auto-party', 'Apply preset', 'data-action="auto-party" style="width:112px"', { primary: true })}</div>`
      + `<div class="px-at" style="left:304px;top:20px">${button('auto-equip', 'Auto-equip', 'data-action="auto-equip" style="width:104px"')}</div>`
      + `<p class="px-at px-coverage ${coverage.length ? 'px-red' : 'px-green'}" style="left:16px;top:52px">${coverage.length ? `Missing: ${coverage.map(esc).join(', ')}.` : 'Role coverage is complete.'}</p>`
      + `<div class="px-formations">${slots}</div>`
      + `<div class="px-heading px-at" style="left:16px;top:162px"><h3>ROSTER</h3><span class="px-muted">${state.roster.length}/${CONFIG.heroes.length} OWNED</span></div>`
      + `<div class="px-roster" data-scroll="roster">${roster}</div>${inspector}`,
      '<p class="px-muted">Changes apply at the next encounter boundary.</p>'];
  }
  private gearInspector(state: ManagementSnapshot, item: ManagementSnapshot['inventory'][number] | undefined, withCompare: boolean): string {
    if (!item) return `<section class="px-inspector px-insp-empty"><p class="px-muted">Select gear to inspect it.</p></section>`;
    const owner = this.ownerOf(state, item.id), comparison = this.comparison, mult = 1 + CONFIG.gear.upgrade.mainPerLevel * item.level, cost = upgradeCost(item);
    const signed = (value: number, text = String(value)) => `<span class="${value > 0 ? 'px-green' : value < 0 ? 'px-red' : 'px-muted'}">${value >= 0 ? '+' : ''}${text}</span>`;
    const stats = [['HP', item.stats.hp * mult], ['ATK', item.stats.atk * mult], ['DEF', item.stats.def * mult]].filter(([, value]) => Number(value) > 0).map(([label, value]) => `${label} ${fmt(Number(value))}`)
      .concat([['HP%', item.stats.hpPct], ['ATK%', item.stats.atkPct], ['speed', item.stats.speedPct]].filter(([, value]) => Number(value) > 0).map(([label, value]) => `${label} ${fmt(Number(value) * mult * 100)}${label === 'speed' ? '%' : ''}`));
    const compare = withCompare ? `<div class="px-compare"><span class="px-label">Compare / equip to</span>${this.dropdown('hero', 'Compare or equip to', state.roster.map(hero => ({ value: hero.id, label: heroName(hero.id) })), this.selectedHero, 184, 'data-select="hero"')}</div>`
      + (comparison ? `<p>Hero before → after: HP ${comparison.before.maxHp} → ${comparison.after.maxHp} ${signed(comparison.delta.maxHp)}; ATK ${comparison.before.atk} → ${comparison.after.atk} ${signed(comparison.delta.atk)}; DEF ${comparison.before.def} → ${comparison.after.def} ${signed(comparison.delta.def)}; interval ${comparison.before.attackTicks} → ${comparison.after.attackTicks} ticks; basic DPS ${signed(comparison.delta.basicDps, comparison.delta.basicDps.toFixed(2))}.</p>`
        + `<p class="${comparison.partyUtilityGain > 0 ? 'px-green' : 'px-muted'}">Party utility gain ${comparison.partyUtilityGain >= 0 ? '+' : ''}${comparison.partyUtilityGain.toFixed(3)}${comparison.partyUtilityGain > 0 ? ' · recommended' : ' · not a party-wide gain'}.</p>` : '<p role="status" class="px-muted">Calculating comparison…</p>') : '';
    const maxed = item.level >= CONFIG.gear.upgrade.maxLevel;
    return `<section class="px-inspector" aria-label="Gear details"><div class="px-insp-scroll" data-scroll="gear-inspector"><h3>${shape(item.rarity)}${rarityText(item.rarity, `${item.rarity} ${item.slot}`.toUpperCase())}</h3>`
      + `<p>${icon(SLOT_ICON[item.slot] ?? 'chest')} Lv ${item.level} · ${owner ? esc(heroName(owner.id)) : 'stash'}${item.acquiredAt.source === 'starter' ? ' · starter kit' : ''}</p><p class="px-stats">${stats.join(' · ') || 'No stats'}</p>`
      + `<p class="px-muted">Next level: ${maxed ? 'max level' : `x${(1 + CONFIG.gear.upgrade.mainPerLevel * (item.level + 1)).toFixed(2)} stats`}</p>${compare}</div>`
      + `<div class="px-insp-foot">${withCompare ? button('equip', 'Equip', 'data-action="equip"', { primary: true }) : ''}${button('upgrade', withCompare ? `Upgrade ${cost} G` : `Upgrade ${item.slot} · ${cost} G`, 'data-action="upgrade"', { disabled: state.gold < cost || maxed, primary: !withCompare, ...(withCompare ? {} : { icon: 'gold' }) })}</div></section>`;
  }
  /** Stash (§7.2): three dropdown filters, 40×40 slot grid, chest-choice cards, gear inspector. */
  private stash(state: ManagementSnapshot): [string, string] {
    if (!state.inventory.some(value => value.id === this.selectedGear) && state.inventory[0]) { this.selectedGear = state.inventory[0].id; this.compareKey = ''; this.comparison = null; }
    const item = state.inventory.find(value => value.id === this.selectedGear), choices = state.pendingChoice ?? [];
    if (item && !state.roster.some(hero => hero.id === this.selectedHero)) this.selectedHero = state.partyIds[0] ?? state.roster[0]?.id ?? '';
    const owners: Choice[] = [{ value: 'all', label: 'All stash' }, ...state.roster.map(hero => ({ value: hero.id, label: heroName(hero.id) }))];
    const visible = state.inventory.filter(gear => (this.slotFilter === 'all' || gear.slot === this.slotFilter) && (this.rarityFilter === 'all' || gear.rarity === this.rarityFilter)
      && (this.ownerFilter === 'all' || state.roster.find(hero => hero.id === this.ownerFilter)?.equipment[gear.slot] === gear.id));
    const slots = visible.map(gear => { const by = this.ownerOf(state, gear.id);
      return `<button type="button" class="px-slot${this.selectedGear === gear.id ? ' px-sel' : ''}" data-rarity="${gear.rarity}" ${control(`gear-${gear.id}`)} data-gear="${gear.id}" aria-pressed="${this.selectedGear === gear.id}" aria-label="${esc(`${gear.rarity} ${gear.slot}, level ${gear.level}${by ? `, on ${heroName(by.id)}` : ''}`)}">${shape(gear.rarity)}${icon(SLOT_ICON[gear.slot] ?? 'chest')}${gear.level ? `<span class="px-count">+${gear.level}</span>` : ''}${by ? '<i class="px-worn"></i>' : ''}</button>`; }).join('');
    const score = (gear: { stats: { hp: number; atk: number; def: number; hpPct: number; atkPct: number; speedPct: number } }) => gear.stats.hp / 8 + gear.stats.atk + gear.stats.def + 100 * (gear.stats.hpPct + gear.stats.atkPct + gear.stats.speedPct);
    const pair = choices[0];
    const pending = pair ? `<section class="px-chest" aria-label="Chest choice"><div class="px-heading"><h3>CHEST: PICK 1 OF 2</h3>${choices.length > 1 ? `<span class="px-muted">${choices.length - 1} more waiting</span>` : ''}</div><div class="px-chest-cards">${pair.map((gear, index) => {
      const better = score(gear) >= score(pair[1 - index] ?? gear);
      return `<div class="px-chest-card" data-rarity="${gear.rarity}">${shape(gear.rarity)}${icon(SLOT_ICON[gear.slot] ?? 'chest')}${rarityText(gear.rarity, `${gear.rarity.toUpperCase()} ${gear.slot}`)}${button(`choose-${index}`, `Keep ${index + 1}`, `data-action="choose-${index}"`, { primary: better })}</div>`; }).join('')}</div></section>` : '';
    return [`<h2 class="px-sr">Stash</h2><div class="px-filters">${this.dropdown('slot', 'Slot', ['all', 'weapon', 'armor', 'charm'].map(value => ({ value, label: value === 'all' ? 'All slots' : value })), this.slotFilter, 96, 'data-filter="slot"')}`
      + `${this.dropdown('rarity', 'Rarity', [{ value: 'all', label: 'All rarity' }, ...CONFIG.rarity.order.map(value => ({ value, label: value, rarity: value }))], this.rarityFilter, 96, 'data-filter="rarity"')}${this.dropdown('owner', 'Owner', owners, this.ownerFilter, 136, 'data-filter="owner"')}</div>`
      + `<div class="px-left" data-scroll="stash">${pending}<div class="px-grid">${slots}${'<span class="px-slot px-slot-empty" aria-hidden="true"></span>'.repeat(Math.max(0, (this.variant === 'native' ? 24 : 12) - visible.length))}</div>${slots ? '' : `<p class="px-muted px-empty-grid">${state.inventory.length ? 'No matching gear.' : 'No gear yet. Defeat a wave.'}</p>`}</div>${this.gearInspector(state, item, true)}`,
      `${button('stash-auto-equip', 'Auto-equip best', 'data-action="auto-equip"')}<p class="px-muted">${state.inventory.length}/${CONFIG.gear.inventoryCap} items</p>`];
  }
  /** Recruit (§7.3, gacha.md): two banners, real odds, pityMeters copy, history; footer Recruit x1/x10 start the reveal. */
  private recruit(state: ManagementSnapshot): [string, string] {
    const meters = CONFIG.ui.pityMeters.recruit, epic = state.recruit.epicPlusRemaining, legend = state.recruit.legendaryRemaining, fresh = state.recruit.newHeroRemaining;
    const dot = `<span style="color:${meters.colors.middot}"> · </span>`;
    const pity = `<span style="color:${meters.colors.epicSegment}">Epic+ in ${epic}</span>${legend === null ? '' : `${dot}<span style="color:${meters.colors.legendSegment}">Legend in ${legend}</span>`}`;
    const owned = new Set(state.roster.map(hero => hero.id)), heroesByRarity = (rarity: string) => CONFIG.heroes.filter(hero => hero.rarity === rarity).map(hero => hero.id);
    const featured = heroesByRarity('legendary').find(id => !owned.has(id)) ?? heroesByRarity('legendary')[0] ?? CONFIG.heroes[0]!.id;
    const pityHero = heroesByRarity('epic').find(id => !owned.has(id)) ?? heroesByRarity('epic')[0] ?? featured;
    const pityTotal = EPIC_PITY_PULLS, pityFill = Math.max(0, Math.min(1, (pityTotal - epic) / Math.max(1, pityTotal)));
    const odds = Object.entries(state.recruit.rates).map(([rarity, value]) => `<li>${shape(rarity)}${rarityText(rarity)}<span>${Number((value * 100).toFixed(2))}%</span></li>`).join('');
    const history = [...state.recentPulls].reverse().map(result => `<li data-rarity="${esc(result.rarity)}">${shape(result.rarity)}${esc(heroName(result.heroId))}${result.duplicate ? ' <span class="px-badge">+1★</span>' : ' <span class="px-badge px-green">NEW</span>'}${result.pity ? ' <span class="px-badge px-gold">PITY</span>' : ''}</li>`).join('') || '<li class="px-muted">No pulls yet.</li>';
    const cost = state.recruit.cost;
    return [`<h2 class="px-sr">Recruit</h2><div class="px-banners"><section class="px-banner" aria-label="All heroes banner"><h3>ALL HEROES</h3><span class="px-pview">${this.portrait(featured, 2)}</span><p class="px-gold px-b">${cost} TICKET${cost === 1 ? '' : 'S'}</p><p class="px-muted">${state.tickets} tickets · ${state.roster.length}/${CONFIG.heroes.length} owned</p></section>`
      + `<section class="px-banner" aria-label="Epic plus pity banner"><h3>EPIC+ PITY</h3><span class="px-pview">${this.portrait(pityHero, 2)}</span><div class="px-hp px-pity"><i style="width:${Math.round(pityFill * 100)}%"></i></div><p class="px-b" style="color:${meters.colors.epicSegment}">${pityTotal - epic} / ${pityTotal}</p><p class="px-muted">Same hero pool</p></section>`
      + `<section class="px-odds" aria-label="Recruit odds"><h3>ACTUAL ODDS</h3><ul>${odds}</ul><p class="px-b">${pity}</p>${fresh === null ? '' : `<p style="color:${meters.colors.newSegment}">New hero in ${fresh}</p>`}<p class="px-muted">Duplicates: +1 star (max ${CONFIG.growth.starMax}), then gold.</p><p class="px-muted">Earned tickets only.</p></section></div>`
      + `<section class="px-history"><div class="px-heading px-heading-left"><h3>HISTORY</h3><span class="px-muted">${state.stats.pulls} PULLS</span></div><ol class="px-list" data-scroll="history">${history}</ol></section>`,
      `<span></span><div class="px-row">${button('pull-one', 'Recruit x1', 'data-action="pull-one" style="width:132px"', { disabled: state.tickets < cost, primary: true })}${button('pull-ten', 'Recruit x10', 'data-action="pull-ten" style="width:140px"', { disabled: state.tickets < cost * 10 })}</div>`];
  }
  /** Upgrades (§7.4): 48 px rows of equipped gear with the wearer portrait and cost, plus the gear inspector. */
  private upgrades(state: ManagementSnapshot): [string, string] {
    const equipped = state.inventory.filter(item => this.ownerOf(state, item.id));
    if (!equipped.some(item => item.id === this.selectedGear) && equipped[0]) this.selectedGear = equipped[0].id;
    const selected = equipped.find(item => item.id === this.selectedGear);
    const rows = equipped.map(item => { const by = this.ownerOf(state, item.id), cost = upgradeCost(item), affordable = state.gold >= cost;
      return `<button type="button" class="px-urow${this.selectedGear === item.id ? ' px-sel' : ''}" data-rarity="${item.rarity}" ${control(`gear-${item.id}`)} data-gear="${item.id}" aria-pressed="${this.selectedGear === item.id}">`
        + `<span class="px-urow-portrait">${by ? this.portrait(by.id) : ''}</span>${icon(SLOT_ICON[item.slot] ?? 'chest')}${shape(item.rarity)}<span class="px-urow-text">${rarityText(item.rarity, `${item.rarity.toUpperCase()} ${item.slot}`)}<span>Lv ${item.level} · ${by ? esc(shortName(by.id)) : ''} · <span class="${affordable ? 'px-gold' : 'px-red'}">${cost} G</span></span></span></button>`; }).join('');
    return [`<h2 class="px-sr">Upgrades</h2><p class="px-hint" style="top:0">Gold ${fmt(state.gold)}. Select equipped gear to upgrade.</p><div class="px-left px-urows" data-scroll="upgrades">${rows || '<p class="px-muted">No equipped items.</p>'}</div>${this.gearInspector(state, selected, false)}`,
      '<p class="px-muted">Upgrade uses the current progression cost.</p>'];
  }
  /** Settings (§7.5): pause and mute toggles, four volume sliders (master + buses), zoom pair, placement dropdown, notes. */
  private settings(state: ManagementSnapshot): [string, string] {
    const prefs = this.compactPrefs, width = this.variant === 'native' ? 400 : 280, zoom = String(prefs?.zoom ?? 1);
    const retry = state.progress.kind === 'BOSS_READY' || state.progress.kind === 'FARMING'
      ? button('retry', state.progress.kind === 'BOSS_READY' ? 'Retry boss' : 'Start encounter', 'data-action="retry"', { pip: 'red', className: 'px-boss' }) : '';
    return [`<h2 class="px-sr">Settings</h2><div class="px-settings">`
      // Toggles follow the mockup: the pause switch is "running" (off while paused), the label names the action it takes.
      + `<div class="px-srow">${toggle('pause', 'pause', !state.paused, state.paused ? 'Resume simulation' : 'Pause simulation', 'Simulation running')}</div>`
      + `<div class="px-srow">${toggle('mute', 'mute', this.audioValue.muted, this.audioValue.muted ? 'Unmute audio' : 'Mute audio', 'Audio muted')}</div>`
      + slider('master', 'Volume', this.audioValue.volume, width) + slider('music', 'Music', this.sliderValue('music'), width) + slider('sfx', 'SFX', this.sliderValue('sfx'), width) + slider('ui', 'UI', this.sliderValue('ui'), width)
      + `<div class="px-srow px-zoomrow"><span class="px-slider-label">Zoom</span><span class="px-pair" role="group" aria-label="Zoom">${['1', '2'].map(value => button(`zoom-${value}`, `${value}×`, `data-zoom="${value}"`, { selected: zoom === value, className: 'px-zoom' })).join('')}</span>`
      + `${this.dropdown('placement', 'Placement', [{ value: 'free', label: 'Free' }, { value: 'snapped', label: 'Snap to bottom' }], prefs?.placement ?? 'free', 160, 'data-setting="placement"')}${button('reset-size', 'Reset size', 'data-action="reset-size"')}</div>`
      + `<div class="px-notes"><p class="px-muted">${state.progress.kind === 'BOSS_READY' ? `<span class="px-red">Boss ${state.progress.bossStage} is ready.</span> Starting it requires an explicit action.` : state.progress.kind === 'FARMING' ? 'The next push starts automatically when its timer or retry condition is met.' : 'Campaign is active.'}</p>`
      + (import.meta.env.DEV ? '<p class="px-muted" data-dev-note>Dev: party v2 preview uses a separate save key; the legacy account stays untouched.</p>' : '')
      + '<p class="px-muted">If a save cannot be loaded, use the game window recovery panel to export it or discard it.</p></div></div>',
      `<p class="px-muted">Esc closes the menu.</p>${retry}`];
  }
}
