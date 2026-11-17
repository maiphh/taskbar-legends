import { CONFIG, activeV14Rules, heroConfig, raritySchema } from '../config';
import audioManifest from '../audio-manifest.json';
import { AtlasLibrary } from '../atlas';
import { loadFonts } from '../font';
import { PixelUI, REVEAL_STAGE, shortHeroName, type RevealPull } from '../pixel-ui';
import { upgradeCost } from '../core/economy';
import { campaignPresentation } from '../core/selectors';
import { getPartyHeroDefinition } from '../core/party-definitions';
import type { Action, GameState } from '../core/model';
import type { HeroGearComparison, ManagementReply, ManagementSnapshot } from './authority';
import type { CompactPrefs } from '../platform/desktop/compact-geometry';
import { formationDrop } from './formation';
import { ManagementTooltip } from './tooltip';
import { autoEquipBest, equipList } from './equip-model';

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
type Tab = 'home' | 'heroes' | 'formation' | 'gear' | 'recruit' | 'stages' | 'settings';
const esc = (value: string): string => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
const fmt = (value: number): string => Math.round(value).toLocaleString();
const heroName = (id: string): string => heroConfig(id).name
  .replace(/\s*\([^)]*\)/g, '')
  .replace(/\s*(?:\||[-–])\s*(?:asset|pack|sprite|sheet)\b.*$/ig, '').trim();
/** Card / slot label (mockups): drop the asset-pack prefixes so names fit 88 px cards (Warrior 2, Martial 1, King 2). */
const shortName = (id: string): string => shortHeroName(id);
function activeSkillName(id: string): string {
  const names: Record<string, string> = { mw2: 'Guardian Shield', hk1: 'Second Wind', mw1: 'Cleave', hu1: 'Piercing Shot', priest: 'Restoration', ew1: 'Withering Hex', mk1: 'Rally', wiz: 'Fireball', mw3: 'Wide Cleave', mh1: 'Focused Burst', mh2: 'Quick Burst', hu2: 'Long Shot', hk2: 'Bulwark', fw: 'Blood Strike', ew2: 'Inferno', mk2: 'Iron Wall', mh3: 'Execution', ew3: 'Armor Break' };
  return names[id] ?? 'Signature Skill';
}
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

const TABS: readonly Tab[] = ['home', 'heroes', 'formation', 'gear', 'recruit', 'stages', 'settings'];
const TAB_LABEL: Record<Tab, string> = { home: 'Home', heroes: 'Heroes', formation: 'Formation', gear: 'Gear', recruit: 'Recruit', stages: 'Stages', settings: 'Settings' };
const SLOT_ICON: Record<string, string> = { weapon: 'sword', armor: 'armor', charm: 'potion' };
const PRESETS = [{ value: 'balanced', label: 'Balanced' }, { value: 'fastFarm', label: 'Fast farm' }, { value: 'bossSustain', label: 'Boss sustain' }] as const;
const MENU = CONFIG.ui.compactMenu, SLIDER = MENU.widgets.slider, VOLUME_STEP = SLIDER.volume.step;
const BUS_DEFAULTS = audioManifest.defaultVolumes;
type Choice = { value: string; label: string; rarity?: string };
type AudioValue = { muted: boolean; volume: number; buses?: { music: number; sfx: number; ui: number } };
export type ManagementVariant = 'browser' | 'native';
type FormationGesture = { pointerId: number; heroId: string; sourceSlot: string | null; startX: number; startY: number; revision: number; partyIds: string[]; started: boolean; target: HTMLElement | null };
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
/** compactMenu.settingsSliders: 28 px row, 72 px label at x=16, track at x=96, % readout at the track's right edge + 12. */
function slider(name: string, label: string, value: number, width: number): string {
  const pct = Math.round(value * 100), thumb = Math.round(value * (width - SLIDER.thumb[0]!));
  return `<div class="px-slider-row"><span class="px-slider-label">${esc(label)}</span><div class="px-slider" role="slider" tabindex="0" data-slider="${name}" ${control(`slider-${name}`)} aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-valuetext="${pct}%" style="width:${width}px"><span class="px-track"><span class="px-fill" style="width:${thumb + 4}px"></span></span><span class="px-thumb" style="left:${thumb}px"></span></div><span class="px-pct">${pct}%</span></div>`;
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
  /** Browser overlay and native window share the 1280×720 and 960×640 integer-zoom presets. */
  variant?: ManagementVariant;
  /** Sprite atlases for portraits and the gacha reveal; the native window creates its own. */
  atlas?: AtlasLibrary;
  /** Presentation clock for the reveal (the main window passes the debug-freezable PixelUI clock). */
  clock?: () => number;
}

/**
 * Seven-screen management UI in the PixelUI style: Galmuri display and metadata faces, panel/button 9-slices, palette tokens,
 * integer-scaled portraits, and pixel widgets only (button, dropdown, slider, toggle, exclusive pair). Polling updates values and only replaces view
 * contents when data or selection changes; the focused control is restored by its data-control id.
 */
export class ManagementView {
  private tab: Tab = 'home';
  private gearUpgrades = false;
  private stageChapter = 0;
  private stageSelection = 0;
  private lockedHeroId = '';
  private snapshotValue: ManagementSnapshot | null = null;
  private selectedHero = '';
  private selectedGear = '';
  private selectedPartySlot: 0 | 1 | 2 = 0;
  private partyWorkspace: 'heroes' | 'formation' = 'heroes';
  private heroDetailTab: 'ability' | 'stats' | 'items' = 'ability';
  private detailsOpen = false;
  private detailsOpener: 'heroes' | 'formation' = 'heroes';
  private loadoutItemOpen = false;
  private equipOpen = false;
  private equipOpener: 'heroes' | 'formation' = 'heroes';
  private equipReturnFocusControl = '';
  private equipSlot: 'weapon' | 'armor' | 'charm' = 'weapon';
  private equipItem = '';
  private slotFilter = 'all';
  private rarityFilter = 'all';
  private ownerFilter = 'all';
  private heroRoleFilter = 'all';
  private heroRarityFilter = 'all';
  private heroSort = 'rarity';
  private openDropdown: string | null = null;
  private message = '';
  private closed = true;
  private generation = 0;
  private timer = 0;
  private sequence = 0;
  private clientId = crypto.randomUUID();
  private contentKey = '';
  private restoreFocusControl = '';
  private detailsReturnFocusControl = '';
  private compareKey = '';
  private comparison: HeroGearComparison | null = null;
  private pendingCompare = false;
  private pendingCompareGeneration = -1;
  private audioValue: AudioValue = { muted: false, volume: 0.5 };
  private compactPrefs: CompactPrefs | null = null;
  private dragging: { name: string; pointerId: number } | null = null;
  private formationGesture: FormationGesture | null = null;
  private formationPending = false;
  private suppressFormationClick: { pointerId: number; heroId: string; sourceSlot: string | null; timer: number } | null = null;
  private deferredFormationRender = false;
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
  private campaignPending = false;
  private atlas: AtlasLibrary | null;
  private readonly portraits = new Map<string, string>();
  private readonly variant: ManagementVariant;
  private readonly abort = new AbortController();
  private readonly tooltip: ManagementTooltip;
  constructor(private readonly root: HTMLElement, private readonly client: ManagementClient, private readonly onClose: () => void, private readonly options: ManagementViewOptions = {}) {
    void loadFonts().then(() => { this.contentKey = ''; this.renderContent(); }).catch(error => {
      this.message = `Local font could not load; using system text: ${String(error)}`; this.renderStatus();
    });
    this.variant = options.variant ?? 'browser'; this.atlas = options.atlas ?? null;
    this.root.classList.add('px-menu'); this.root.dataset.variant = this.variant;
    this.root.dataset.layout = 'v2';
    this.tooltip = new ManagementTooltip(this.root);
    for (const [key, value] of Object.entries(CONFIG.ui.palette)) this.root.style.setProperty(`--px-${key}`, value);
    for (const tier of raritySchema.options) this.root.style.setProperty(`--px-rarity-${tier}`, CONFIG.ui.rarity[tier].label);
    for (const [name, file] of [['panel', 'panel-9slice'], ['button', 'button-9slice'], ['hover', 'button-hover-9slice'], ['pressed', 'button-pressed-9slice'], ['disabled', 'button-disabled-9slice'], ['gold', 'button-gold-9slice']] as const) {
      this.root.style.setProperty(`--px-${name}-9slice`, `url("${asset(`ui/${file}.png`)}")`);
    }
    this.root.innerHTML = `<header class="management-header"><h1>TASKBAR LEGENDS</h1><span class="px-run" data-run></span><span class="px-wallet" data-wallet></span>${button('menu-close', 'X', 'data-close', { aria: 'Close management', className: 'px-close' })}</header>`
      + `<nav aria-label="Management tabs"></nav><div class="campaign-row"><span class="campaign-status" data-campaign></span><span data-campaign-action></span></div><div class="management-status" role="status" aria-live="polite"></div><main></main><div class="px-divider"></div><footer class="px-footer"></footer>`
      + `<section class="reveal-stage" aria-label="Recruit reveal" hidden><canvas width="${REVEAL_STAGE.width}" height="${REVEAL_STAGE.height}" role="img" aria-label="Recruit results"></canvas><div class="reveal-controls"></div></section>`;
    this.header = this.root.querySelector('.management-header')!; this.nav = this.root.querySelector('nav')!;
    this.status = this.root.querySelector('.management-status')!; this.main = this.root.querySelector('main')!; this.footer = this.root.querySelector('footer')!;
    this.revealHost = this.root.querySelector('.reveal-stage')!; this.revealCanvas = this.revealHost.querySelector('canvas')!;
    this.renderNav();
    this.nav.addEventListener('click', event => {
      if (this.closed) return; const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-tab]') : null; if (!target?.dataset.tab) return;
      // Any tab click (including Recruit itself) leaves the reveal and shows that tab's body.
      this.cancelFormationGesture(); this.tooltip.hide(); this.stopReveal(); if (this.tab !== target.dataset.tab) this.client.cue?.('ui_click');
      this.equipOpen = false; this.tab = target.dataset.tab as Tab; this.lockedHeroId = ''; this.openDropdown = null; this.contentKey = ''; this.renderContent(); this.renderNav();
    }, { signal: this.abort.signal });
    this.header.querySelector('[data-close]')?.addEventListener('click', () => this.close(), { signal: this.abort.signal });
    this.root.addEventListener('click', event => this.onClick(event), { signal: this.abort.signal });
    this.root.addEventListener('keydown', event => this.onKey(event), { signal: this.abort.signal });
    this.root.addEventListener('scroll', event => { const list = event.target instanceof HTMLElement && event.target.matches('[data-scroll="equip-list"]') ? event.target : null; const cue = list?.parentElement?.querySelector<HTMLElement>('.px-equip-scroll-cue'); if (list && cue) cue.hidden = list.scrollTop + list.clientHeight >= list.scrollHeight - 2; }, { capture:true, signal:this.abort.signal });
    this.root.addEventListener('pointerdown', event => this.onPointer(event), { signal: this.abort.signal });
    this.root.addEventListener('pointermove', event => this.onPointer(event), { signal: this.abort.signal });
    this.root.addEventListener('pointerup', event => this.onPointer(event), { signal: this.abort.signal });
    this.root.addEventListener('pointercancel', event => this.onPointer(event), { signal: this.abort.signal });
    this.root.addEventListener('lostpointercapture', event => { if (event.target === this.root && this.formationGesture?.pointerId === (event as PointerEvent).pointerId && !this.root.hasPointerCapture((event as PointerEvent).pointerId)) this.cancelFormationGesture(); }, { signal: this.abort.signal });
    this.root.addEventListener('dragstart', event => { if (event.target instanceof Element && event.target.closest('.px-formation-view')) event.preventDefault(); }, { signal: this.abort.signal });
    document.addEventListener('pointerup', event => { if (this.formationGesture && !this.root.contains(event.target as Node)) this.cancelFormationGesture(); }, { signal: this.abort.signal });
    window.addEventListener('blur', () => this.cancelFormationGesture(), { signal: this.abort.signal });
    document.addEventListener('pointerdown', event => { if (this.openDropdown && !(event.target instanceof Node && this.root.contains(event.target))) { this.openDropdown = null; this.contentKey = ''; this.renderContent(); } }, { signal: this.abort.signal });
  }
  async open(tab: Tab = this.tab): Promise<void> {
    this.cancelFormationGesture();
    this.stopReveal(); this.openDropdown = null; this.tooltip.hide();
    this.equipOpen = false; this.detailsOpen = false; this.loadoutItemOpen = false; this.lockedHeroId = '';
    this.tab = tab;
    this.lockedHeroId = '';
    if (!this.closed) { this.contentKey = ''; this.renderContent(); this.renderNav(); return; }
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
    this.cancelFormationGesture(); this.tooltip.hide(); this.stopReveal(); this.openDropdown = null;
    this.closed = true; this.client.cue?.('ui_close'); this.client.close(); this.onClose();
  }
  dispose(): void { this.close(); this.generation += 1; this.tooltip.dispose(); this.abort.abort(); this.root.replaceChildren(); }
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
    const campaign = campaignPresentation(state.progress, state.paused), label = this.root.querySelector<HTMLElement>('[data-campaign]'), actionHost = this.root.querySelector<HTMLElement>('[data-campaign-action]');
    if (label) { label.textContent = campaign.management; label.dataset.tone = campaign.tone; label.title = campaign.management; }
    if (actionHost) {
      const existing = actionHost.querySelector<HTMLButtonElement>('[data-action="retry"]');
      if (!campaign.action) {
        const hadFocus = actionHost.contains(document.activeElement);
        actionHost.replaceChildren();
        if (hadFocus) this.nav.querySelector<HTMLButtonElement>(`[data-tab="${this.tab}"]`)?.focus({ preventScroll: true });
      }
      else if (existing) { existing.textContent = campaign.action; existing.disabled = this.campaignPending; existing.setAttribute('aria-label', `${campaign.action}: start the next campaign encounter`); }
      else actionHost.innerHTML = button('campaign-retry', campaign.action, 'data-action="retry"', { primary: true, aria: `${campaign.action}: start the next campaign encounter` });
    }
  }
  /** Seven 9-slice destinations with 6×6 affordance pips for pending choices and available actions. */
  private renderNav(): void {
    const state = this.snapshotValue;
    const pips: Record<string, 'gold' | 'blue'> = !state ? {} : {
      ...(state.pendingChoice?.length ? { gear: 'blue' as const } : {}),
      ...(state.tickets >= state.recruit.cost ? { recruit: 'gold' as const } : {}),
      ...(state.inventory.some(item => state.roster.some(hero => Object.values(hero.equipment).includes(item.id)) && item.level < CONFIG.gear.upgrade.maxLevel && upgradeCost(item) <= state.gold) ? { gear: 'gold' as const } : {}),
    };
    const navArt: Record<Tab,string> = { home:icon('chest'), heroes:icon('armor'), formation:icon('sword'), gear:icon('armor'), recruit:icon('chest'), stages:icon('gold'), settings:'<span aria-hidden="true">#</span>' };
    const html = TABS.map(tab => `<button type="button" class="px-btn px-nav${tab === this.tab ? ' is-selected' : ''}" data-tab="${tab}" aria-current="${tab === this.tab ? 'page' : 'false'}"><span class="nav-icon" aria-hidden="true">${navArt[tab]}</span><span>${TAB_LABEL[tab]}</span>${pips[tab] ? `<i class="px-pip" data-pip="${pips[tab]}"></i>` : ''}</button>`).join('');
    if (this.nav.dataset.html === html) return;
    const focused = document.activeElement instanceof HTMLElement && this.nav.contains(document.activeElement) ? document.activeElement.dataset.tab : undefined;
    this.nav.innerHTML = html; this.nav.dataset.html = html;
    if (focused) this.nav.querySelector<HTMLButtonElement>(`[data-tab="${focused}"]`)?.focus({ preventScroll: true });
  }
  private renderStatus(): void { this.status.textContent = this.message; this.status.dataset.quiet = String(this.message === 'Updated.'); }
  private async settingRequest(operation: Promise<unknown>): Promise<void> {
    const generation = this.generation;
    try { await operation; }
    catch (error) { if (this.isLive(generation)) { this.message = `Setting could not be saved: ${String(error)}`; this.renderStatus(); } }
  }
  private async command(action: Action | { type: 'pullMany'; count: 1 | 10 }, expectedRevision?: number): Promise<ManagementReply | null> {
    const generation = this.generation, current = this.snapshotValue; if (!current || !this.isLive(generation)) return null;
    try {
      const reply = await this.client.execute(action, expectedRevision ?? current.revision, `${this.clientId}:${++this.sequence}`);
      if (!this.isLive(generation)) return null;
      if (this.isNewer(reply.snapshot, this.snapshotValue)) this.snapshotValue = reply.snapshot;
      else await this.refresh(generation);
      if (!this.isLive(generation)) return null;
      this.message = reply.accepted ? 'Updated.' : reply.reason ?? 'Action rejected. State refreshed.';
      this.renderHeader(); this.renderNav(); this.contentKey = ''; this.renderContent(); this.renderStatus();
      return reply;
    } catch (error) { if (this.isLive(generation)) { this.message = `Action was not applied: ${String(error)}`; await this.refresh(generation); if (this.isLive(generation)) this.renderStatus(); } return null; }
    finally { if (action.type === 'retry') { this.campaignPending = false; this.renderHeader(); } }
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
    ui.managementReveal = true;
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
    const width = this.stageWidth(); this.revealHost.dataset.compact = String(width < REVEAL_STAGE.width);
    ui.drawRevealStage(ctx, this.snapshotValue?.tickets ?? 0, 1, width);
    window.cancelAnimationFrame(this.revealFrame);
    if (ui.revealState()) this.revealFrame = window.requestAnimationFrame(() => this.drawReveal());
  }
  /** 624-wide docked panel → compactMenu.tenPullCompact; 720 panels and the native window keep the 720 gacha layout. */
  private stageWidth(): number { return this.variant === 'browser' && this.root.getBoundingClientRect().width < REVEAL_STAGE.width ? MENU.tenPullCompact.panelW : REVEAL_STAGE.width; }
  private stopReveal(): void {
    window.cancelAnimationFrame(this.revealFrame); this.revealFrame = 0;
    this.revealUi?.clearReveal();
    this.revealHost.hidden = true; this.root.classList.remove('reveal-active');
  }
  /** Idle frame 0 of the outlined sheet, cropped to its ink (§3), at an integer scale. */
  private portrait(heroId: string, scale: 1 | 2 | 3 | 4 | 5 = 1): string {
    const key = Object.entries(CONFIG.view.heroAssets).find(([id]) => id === heroId)?.[1];
    if (!key || !this.atlas) return '<span class="px-portrait px-portrait-empty"></span>';
    let entry = this.portraits.get(key);
    if (entry === undefined) { const canvas = this.atlas.portrait(key); entry = canvas ? `${canvas.toDataURL()}|${canvas.width}|${canvas.height}` : ''; if (canvas) this.portraits.set(key, entry); }
    const [url, w, h] = entry.split('|');
    return url ? `<img class="px-portrait" src="${url}" alt="" draggable="false" width="${Number(w) * scale}" height="${Number(h) * scale}" style="width:${Number(w) * scale}px;height:${Number(h) * scale}px">` : '<span class="px-portrait px-portrait-empty"></span>';
  }
  private portraitScale(heroId: string, width: number, height: number): 1 | 2 | 3 | 4 | 5 {
    const key = Object.entries(CONFIG.view.heroAssets).find(([id]) => id === heroId)?.[1], canvas = key && this.atlas?.portrait(key);
    if (!canvas) return 1;
    return Math.max(1, Math.min(5, Math.floor(Math.min(width / canvas.width, height / canvas.height)))) as 1 | 2 | 3 | 4 | 5;
  }
  private onKey(event: KeyboardEvent): void {
    if (this.closed) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const dialog = this.root.querySelector<HTMLElement>('.px-howto-card[role="dialog"]');
    if (dialog && event.key === 'Tab') {
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),[href],input:not(:disabled),[tabindex]:not([tabindex="-1"])')];
      if (controls.length) { const first = controls[0]!, last = controls.at(-1)!;
        if (event.shiftKey && (target === first || !dialog.contains(target))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (target === last || !dialog.contains(target))) { event.preventDefault(); first.focus(); }
      }
    }
    if (this.equipOpen && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !(target && /^(INPUT|TEXTAREA)$/.test(target.tagName))) { event.preventDefault(); this.cycleEquipHero(event.key === 'ArrowRight' ? 1 : -1); return; }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (this.formationGesture) { this.cancelFormationGesture(); return; }
      if (this.tooltip.dismissEscape()) return;
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
    if (target?.dataset.heroDetail !== undefined && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const tabs = ['ability', 'stats', 'items'] as const, index = tabs.indexOf(target.dataset.heroDetail as typeof tabs[number]);
      this.heroDetailTab = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[2] : tabs[Math.max(0, Math.min(2, index + (event.key === 'ArrowRight' ? 1 : -1)))]!;
      this.contentKey = ''; this.renderContent(); this.root.querySelector<HTMLElement>(`[data-hero-detail="${this.heroDetailTab}"]`)?.focus(); return;
    }
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
    if (this.handleFormationPointer(event)) return;
    const node = event.type === 'pointerdown' ? (event.target instanceof Element ? event.target.closest<HTMLElement>('[data-slider]') : null) : this.dragging ? this.root.querySelector<HTMLElement>(`[data-slider="${CSS.escape(this.dragging.name)}"]`) : null;
    if (!node?.dataset.slider) return;
    if (event.type === 'pointerdown') { event.preventDefault(); node.focus(); this.dragging = { name: node.dataset.slider, pointerId: event.pointerId }; try { node.setPointerCapture(event.pointerId); } catch { /* synthetic pointers */ } }
    else if (this.dragging?.pointerId !== event.pointerId) return;
    const box = node.getBoundingClientRect(), value = (event.clientX - box.left - SLIDER.thumb[0]! / 2) / Math.max(1, box.width - SLIDER.thumb[0]!);
    if (event.type !== 'pointercancel') this.setSlider(node.dataset.slider, value, false);
    if (event.type === 'pointerup' || event.type === 'pointercancel') { this.dragging = null; this.contentKey = ''; this.renderContent(); }
  }
  private handleFormationPointer(event: PointerEvent): boolean {
    if (event.type === 'pointerdown') {
      if (this.tab !== 'formation' || this.formationPending || !event.isPrimary || event.button !== 0) return false;
      const target = event.target instanceof Element ? event.target : null;
      const touchGrip = event.pointerType === 'touch' ? document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-drag-grip]') : null;
      const source = (touchGrip ?? target)?.closest<HTMLElement>('[data-drag-hero]');
      if (!source) return false;
      if (event.pointerType === 'touch' && !touchGrip) return false;
      const state = this.snapshotValue; if (!state || !state.roster.some(hero => hero.id === source.dataset.dragHero)) return false;
      this.formationGesture = { pointerId: event.pointerId, heroId: source.dataset.dragHero!, sourceSlot: source.dataset.partySlot ?? null, startX: event.clientX, startY: event.clientY,
        revision: state.revision, partyIds: [...state.partyIds], started: false, target: null };
      return false;
    }
    const gesture = this.formationGesture; if (!gesture || gesture.pointerId !== event.pointerId) return false;
    if (event.type === 'pointercancel') { this.cancelFormationGesture(); return true; }
    if (event.type === 'pointermove') {
      if (!gesture.started && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) >= 7) {
        gesture.started = true; this.tooltip.hide(); this.root.querySelector('.px-formation-view')?.classList.add('is-dragging');
        this.root.querySelector<HTMLElement>(`[data-drag-hero="${CSS.escape(gesture.heroId)}"]`)?.setAttribute('data-dragging', 'true');
        try { this.root.setPointerCapture(event.pointerId); } catch { /* synthetic event environments */ }
      }
      if (gesture.started) {
        event.preventDefault();
        const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-party-slot]') ?? null;
        gesture.target = hit && this.root.contains(hit) ? hit : null;
        this.root.querySelectorAll('[data-party-slot]').forEach(node => node.removeAttribute('data-drop-target'));
        gesture.target?.setAttribute('data-drop-target', 'true');
      }
      return gesture.started;
    }
    if (event.type === 'pointerup') {
      if (!gesture.started) { this.cancelFormationGesture(); return false; }
      event.preventDefault();
      const current = this.snapshotValue, slot = gesture.target?.dataset.partySlot;
      const targetSlot = slot === undefined ? -1 : Number(slot);
      const valid = current && this.tab === 'formation' && !this.closed
        && current.revision === gesture.revision && current.partyIds.length === gesture.partyIds.length && current.partyIds.every((id, i) => id === gesture.partyIds[i]);
      const next = valid && targetSlot >= 0 ? formationDrop(gesture.partyIds, current.roster.map(hero => hero.id), gesture.heroId, targetSlot) : null;
      this.armFormationClickSuppression(gesture);
      this.cancelFormationGesture();
      if (next && current) void this.submitFormation(next, gesture.revision);
      else if (!valid) { this.message = 'Formation changed while dragging. Try again.'; this.renderStatus(); }
      return true;
    }
    return false;
  }
  private cancelFormationGesture(): void {
    const gesture = this.formationGesture; if (!gesture) return;
    if (gesture.started) this.armFormationClickSuppression(gesture);
    this.formationGesture = null;
    this.root.querySelector('.px-formation-view')?.classList.remove('is-dragging');
    this.root.querySelectorAll('[data-dragging], [data-drop-target]').forEach(node => { node.removeAttribute('data-dragging'); node.removeAttribute('data-drop-target'); });
    try { if (this.root.hasPointerCapture(gesture.pointerId)) this.root.releasePointerCapture(gesture.pointerId); } catch { /* capture may already be gone */ }
    this.tooltip.hide();
    if (this.deferredFormationRender) { this.deferredFormationRender = false; this.contentKey = ''; this.renderContent(); }
  }
  private armFormationClickSuppression(gesture: FormationGesture): void {
    if (this.suppressFormationClick) window.clearTimeout(this.suppressFormationClick.timer);
    const suppression = { pointerId: gesture.pointerId, heroId: gesture.heroId, sourceSlot: gesture.sourceSlot, timer: 0 };
    suppression.timer = window.setTimeout(() => { if (this.suppressFormationClick === suppression) this.suppressFormationClick = null; }, 0);
    this.suppressFormationClick = suppression;
  }
  private async submitFormation(ids: string[], revision: number): Promise<void> {
    if (this.formationPending) return;
    this.formationPending = true; this.message = 'Formation update pending…'; this.renderStatus();
    try {
      const reply = await this.command({ type: 'party', heroIds: ids }, revision);
      if (reply?.accepted && !this.closed) this.message = 'Formation updated for the next encounter.';
      else if (reply && !this.closed) this.message = reply.reason ?? 'Formation was not changed.';
    } finally {
      this.formationPending = false;
      if (!this.closed) { this.contentKey = ''; this.renderContent(); this.renderStatus(); }
    }
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
    const pointerClick = event instanceof PointerEvent ? event : null, suppressed = this.suppressFormationClick;
    if (pointerClick && suppressed && pointerClick.pointerId === suppressed.pointerId && pointerClick.detail > 0
      && (target.closest('[data-drag-hero]')?.getAttribute('data-drag-hero') === suppressed.heroId
        || suppressed.sourceSlot !== null && target.closest('[data-party-slot]')?.getAttribute('data-party-slot') === suppressed.sourceSlot)) {
      window.clearTimeout(suppressed.timer); this.suppressFormationClick = null; event.preventDefault(); event.stopPropagation(); return;
    }
    const button = target.closest<HTMLButtonElement>('button');
    const state = this.snapshotValue;
    const equipTarget = target.closest<HTMLElement>('[data-equip-slot]');
    if (equipTarget?.dataset.equipSlot && this.tab === 'formation' && !this.equipOpen) {
      const slot = equipTarget.dataset.equipSlot as 'weapon' | 'armor' | 'charm', heroId = equipTarget.closest<HTMLElement>('[data-drag-hero]')?.dataset.dragHero;
      if (heroId && state) { this.equipReturnFocusControl = (equipTarget as HTMLElement).dataset.control ?? ''; this.openEquip(heroId, slot, 'formation'); }
      return;
    }
    if (this.openDropdown && !target.closest('.px-dd')) { this.openDropdown = null; this.contentKey = ''; this.renderContent(); }
    if (!button || !state || button.disabled) return;
    const action = button.dataset.action;
    if (button.dataset.openHero) { this.detailsReturnFocusControl = button.dataset.control ?? ''; this.restoreFocusControl = this.detailsReturnFocusControl; this.detailsOpener = this.tab === 'formation' ? 'formation' : 'heroes'; this.selectedHero = button.dataset.openHero; this.tab = 'heroes'; this.detailsOpen = true; this.contentKey = ''; this.renderNav(); this.renderContent(); return; }
    if (button.dataset.equipBack !== undefined) { this.equipOpen = false; this.detailsOpen = this.equipOpener === 'heroes'; this.tab = this.equipOpener; this.restoreFocusControl = this.equipReturnFocusControl || (this.equipOpener === 'heroes' ? 'detail-equip' : ''); this.contentKey = ''; this.renderNav(); this.renderContent(); return; }
    if (button.dataset.equipSlot) { this.equipSlot = button.dataset.equipSlot as 'weapon'|'armor'|'charm'; this.equipItem = state.roster.find(hero => hero.id === this.selectedHero)?.equipment[this.equipSlot] ?? ''; this.compareKey = ''; this.comparison = null; this.contentKey = ''; this.renderContent(); return; }
    if (button.dataset.equipItem) { this.equipItem = button.dataset.equipItem; this.compareKey = ''; this.comparison = null; this.contentKey = ''; this.renderContent(); return; }
    if (button.dataset.equipCycle) { this.cycleEquipHero(button.dataset.equipCycle === 'next' ? 1 : -1); return; }
    if (button.dataset.equipAuto !== undefined) { void this.autoEquipHero(); return; }
    if (button.dataset.equipLock !== undefined && this.equipItem) { void this.command({ type:'lock', gearId:this.equipItem as GameState['inventory'][number]['id'], locked:button.dataset.equipLock !== 'true' }); return; }
    if (action === 'gear-upgrades') { this.gearUpgrades = !this.gearUpgrades; this.contentKey = ''; this.renderContent(); return; }
    if (button.dataset.tab && TABS.includes(button.dataset.tab as Tab)) { this.equipOpen = false; this.detailsOpen = false; this.loadoutItemOpen = false; this.tab = button.dataset.tab as Tab; this.lockedHeroId = ''; this.stopReveal(); this.contentKey = ''; this.renderContent(); this.renderNav(); return; }
    if (button.dataset.lockedHero) { this.lockedHeroId = button.dataset.lockedHero; this.tab = 'heroes'; this.restoreFocusControl = 'howto-recruit'; this.contentKey = ''; this.renderContent(); this.renderNav(); return; }
    if (button.dataset.pushBack) { this.lockedHeroId = ''; this.contentKey = ''; this.renderContent(); return; }
    if (button.dataset.goRecruit !== undefined) { this.lockedHeroId = ''; this.tab = 'recruit'; this.contentKey = ''; this.renderContent(); this.renderNav(); return; }
    if (button.dataset.chapter) { this.stageChapter = Number(button.dataset.chapter) === 2 ? 2 : 1; this.stageSelection = (this.stageChapter - 1) * 10 + 1; this.contentKey = ''; this.renderContent(); return; }
    if (button.dataset.stageNode) { this.stageSelection = Number(button.dataset.stageNode); this.contentKey = ''; this.renderContent(); return; }
    if (button.dataset.helpToggle !== undefined) { this.tooltip.toggle(button); return; }
    if (button.dataset.detailsOpen !== undefined) { this.detailsReturnFocusControl = button.dataset.control ?? ''; this.restoreFocusControl = this.detailsReturnFocusControl; this.detailsOpener = 'heroes'; if (button.dataset.hero) this.selectedHero = button.dataset.hero; this.detailsOpen = true; this.contentKey = ''; this.renderContent(); return; }
    if (button.dataset.detailsClose !== undefined) { this.detailsOpen = false; this.tab = this.detailsOpener; this.restoreFocusControl = this.detailsReturnFocusControl; this.renderNav(); this.contentKey = ''; this.renderContent(); return; }
    if (button.dataset.loadoutClose !== undefined) { this.loadoutItemOpen = false; this.contentKey = ''; this.renderContent(); return; }
    if (button.dataset.loadoutSlot) {
      const slot = button.dataset.loadoutSlot as 'weapon' | 'armor' | 'charm'; this.slotFilter = slot;
      this.equipReturnFocusControl = button.dataset.control ?? '';
      this.openEquip(this.selectedHero, slot, 'heroes'); return;
    }
    if (button.dataset.loadoutGear) {
      this.selectedGear = button.dataset.loadoutGear; this.loadoutItemOpen = true; this.compareKey = ''; this.comparison = null; this.contentKey = ''; this.renderContent(); return;
    }
    if (button.dataset.ddToggle) { this.toggleDropdown(button.dataset.ddToggle, (event as MouseEvent).detail === 0); return; }
    if (button.dataset.ddOption) { const name = button.dataset.ddOption; this.openDropdown = null; this.choose(name, button.dataset.value ?? ''); this.root.querySelector<HTMLElement>(`[data-dd-toggle="${CSS.escape(name)}"]`)?.focus(); return; }
    if (button.dataset.hero && this.tab === 'formation') {
      const heroId = button.dataset.hero;
      if (this.formationPending) return;
      const ids = formationDrop(state.partyIds, state.roster.map(hero => hero.id), heroId, this.selectedPartySlot);
      if (ids) void this.submitFormation(ids, state.revision);
      else { this.selectedHero = heroId; this.contentKey = ''; this.renderContent(); }
      return;
    }
    if (button.dataset.hero) { this.selectedHero = button.dataset.hero; this.loadoutItemOpen = false; this.contentKey = ''; this.renderContent(); return; }
    if (button.dataset.partyWorkspace === 'heroes' || button.dataset.partyWorkspace === 'formation') { this.cancelFormationGesture(); this.partyWorkspace = button.dataset.partyWorkspace; this.tab = button.dataset.partyWorkspace; this.contentKey = ''; this.renderContent(); this.renderNav(); return; }
    if (button.dataset.heroDetail === 'ability' || button.dataset.heroDetail === 'stats' || button.dataset.heroDetail === 'items') { this.heroDetailTab = button.dataset.heroDetail; this.contentKey = ''; this.renderContent(); return; }
    if (button.dataset.partySlot !== undefined) { const index = Number(button.dataset.partySlot); this.selectedPartySlot = index === 1 || index === 2 ? index : 0; this.contentKey = ''; this.renderContent(); return; }
    if (button.dataset.assign) { if (this.formationPending) return; const ids = formationDrop(state.partyIds, state.roster.map(hero => hero.id), button.dataset.assign, this.selectedPartySlot); if (ids) void this.submitFormation(ids, state.revision); else { this.message = 'Choose a different owned hero for that slot.'; this.renderStatus(); } return; }
    if (button.dataset.lockHero) { void this.command({ type: 'lockHero', heroId: button.dataset.lockHero, locked: button.dataset.locked !== 'true' }); return; }
    if (button.dataset.gearLock && this.selectedGear) { void this.command({ type: 'lock', gearId: this.selectedGear as GameState['inventory'][number]['id'], locked: button.dataset.gearLock !== 'true' }); return; }
    if (button.dataset.gear) { this.selectedGear = button.dataset.gear; this.compareKey = ''; this.comparison = null; this.contentKey = ''; this.renderContent(); return; }
    if (button.dataset.zoom && this.compactPrefs) { this.compactPrefs = { ...this.compactPrefs, zoom: button.dataset.zoom === '2' ? 2 : 1 }; void this.settingRequest(this.client.setCompactPrefs(this.compactPrefs)); this.contentKey = ''; this.renderContent(); return; }
    if (action === 'pull-one') void this.recruitPull(1);
    else if (action === 'pull-ten') void this.recruitPull(10);
    else if (action === 'auto-party') void this.command({ type: 'autoParty', preset: state.partyPreset ?? 'balanced' });
    else if (action === 'auto-equip') void this.command({ type: 'autoEquip' });
    else if (action === 'inspect-items') { this.tab = 'gear'; const hero = state.roster.find(value => value.id === this.selectedHero); this.selectedGear = (hero?.equipment.weapon ?? hero?.equipment.armor ?? hero?.equipment.charm ?? state.inventory[0]?.id ?? '') as string; this.contentKey = ''; this.renderContent(); }
    else if (action === 'choose-0' || action === 'choose-1') void this.command({ type: 'chooseChest', keep: action === 'choose-0' ? 0 : 1 });
    else if (action === 'retry' && !this.campaignPending) { this.campaignPending = true; this.renderHeader(); void this.command({ type: 'retry' }); }
    else if (action === 'upgrade' && this.selectedGear) void this.command({ type: 'upgrade', gearId: this.selectedGear as GameState['inventory'][number]['id'] });
    else if (action === 'equip' && this.selectedGear && this.selectedHero) void this.command({ type: 'equip', heroId: this.selectedHero, gearId: this.selectedGear as GameState['inventory'][number]['id'] });
    else if (action === 'equip-selected' && this.equipItem && this.selectedHero) void this.command({ type:'equip', heroId:this.selectedHero, gearId:this.equipItem as GameState['inventory'][number]['id'] });
    else if (action === 'equip-upgrade' && this.equipItem) void this.command({ type:'upgrade', gearId:this.equipItem as GameState['inventory'][number]['id'] });
    else if (action === 'pause') { const generation = this.generation; void this.settingRequest(this.client.pause(!state.paused).then(() => this.refresh(generation))); }
    else if (action === 'mute') { this.audioValue = { ...this.audioValue, muted: !this.audioValue.muted }; void this.settingRequest(this.client.setAudio(this.audioValue)); this.contentKey = ''; this.renderContent(); }
    else if (action === 'reset-size' && this.compactPrefs) { this.compactPrefs = { ...this.compactPrefs, sourceWidth: 640, sourceHeight: 160 }; void this.settingRequest(this.client.setCompactPrefs(this.compactPrefs)); this.contentKey = ''; this.renderContent(); }
  }
  /** Dropdown commits: filters and selections re-render; the preset applies at once (as the old select did). */
  private choose(name: string, value: string): void {
    if (name === 'slot') this.slotFilter = value;
    else if (name === 'rarity') this.rarityFilter = value;
    else if (name === 'owner') this.ownerFilter = value;
    else if (name === 'hero-role') this.heroRoleFilter = value;
    else if (name === 'hero-rarity') this.heroRarityFilter = value;
    else if (name === 'hero-sort') this.heroSort = value;
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
    const signature = `${this.tab}:${this.contentSignature(state)}:${this.selectedHero}:${this.selectedGear}:${this.selectedPartySlot}:${this.partyWorkspace}:${this.heroDetailTab}:${this.detailsOpen}:${this.equipOpen}:${this.equipSlot}:${this.equipItem}:${this.loadoutItemOpen}:${this.slotFilter}:${this.rarityFilter}:${this.ownerFilter}:${this.heroRoleFilter}:${this.heroRarityFilter}:${this.heroSort}:${this.openDropdown}:${JSON.stringify(this.audioValue)}:${JSON.stringify(this.compactPrefs)}:${!!this.comparison}:${this.portraits.size}`;
    if (signature === this.contentKey) return;
    if (this.formationGesture) { this.deferredFormationRender = true; return; }
    this.tooltip.hide();
    const active = document.activeElement, hadContentFocus = active instanceof HTMLElement && (this.main.contains(active) || this.footer.contains(active)), focusId = this.restoreFocusControl || (hadContentFocus ? active.dataset.control ?? '' : ''); this.restoreFocusControl = '';
    const scroll = [...this.main.querySelectorAll<HTMLElement>('[data-scroll]')].map(node => [node.dataset.scroll, node.scrollTop, node.scrollLeft] as const);
    this.contentKey = signature; this.main.dataset.view = this.tab; this.root.dataset.view = this.tab;
    const [body, foot] = this.equipOpen ? this.equipScreen(state) : this.lockedHeroId ? this.lockedHero(state) : this.tab === 'home' ? this.home(state) : this.tab === 'heroes' || this.tab === 'formation' ? (this.partyWorkspace = this.tab === 'formation' ? 'formation' : 'heroes', this.party(state)) : this.tab === 'gear' ? (this.gearUpgrades ? this.upgrades(state) : this.stash(state)) : this.tab === 'recruit' ? this.recruit(state) : this.tab === 'stages' ? this.stages(state) : this.settings(state);
    this.main.dataset.view = this.equipOpen ? 'equip' : this.tab;
    this.main.innerHTML = body; this.footer.innerHTML = foot;
    for (const [key, top, left] of scroll) { const node = this.main.querySelector<HTMLElement>(`[data-scroll="${key}"]`); if (node) { node.scrollTop = top; node.scrollLeft = left; } }
    const equipRows = this.main.querySelector<HTMLElement>('.px-equip-rows'), equipDrawer = this.main.querySelector<HTMLElement>('.px-equip-drawer'), equipList = this.main.querySelector<HTMLElement>('.px-equip-list'), scrollCue = this.main.querySelector<HTMLElement>('.px-equip-scroll-cue');
    if (equipRows && equipDrawer && equipList && scrollCue) {
      const compare = this.main.querySelector<HTMLElement>('.px-equip-compare'), heading = equipList.querySelector<HTMLElement>('h3'), narrow = this.root.dataset.preset === '960';
      const available = equipList.clientHeight - (heading?.offsetHeight ?? 0) - scrollCue.offsetHeight;
      const gap = narrow ? 4 : 6, rowHeight = 48, usable = Math.max(rowHeight, Math.floor((available + gap) / (rowHeight + gap)) * (rowHeight + gap) - gap);
      equipRows.style.height = `${Math.min(usable, equipRows.scrollHeight)}px`;
      scrollCue.hidden = equipRows.scrollHeight <= equipRows.clientHeight + 2;
      if (compare) compare.dataset.rows = String(usable / (rowHeight + gap));
    }
    this.renderStatus();
    const focusTarget = focusId ? this.root.querySelector<HTMLElement>(`[data-control="${CSS.escape(focusId)}"]`) : null;
    if (focusTarget) focusTarget.focus({ preventScroll: true }); else if (hadContentFocus) this.main.querySelector<HTMLElement>('button:not(:disabled),[tabindex="0"]')?.focus({ preventScroll: true });
    if (this.revealUi && !this.revealHost.hidden) this.drawReveal();
    if (this.equipOpen && this.equipItem && this.selectedHero) { this.selectedGear = this.equipItem; void this.loadComparison(state); }
    else if ((this.tab === 'gear' || this.tab === 'heroes' && this.loadoutItemOpen) && this.selectedGear && this.selectedHero) void this.loadComparison(state);
  }
  private home(state: ManagementSnapshot): [string, string] {
    const progress = state.progress, stage = progress.kind === 'BOSS_READY' ? progress.bossStage : progress.stage;
    const label = progress.kind === 'BOSS_READY' ? 'Boss ready' : progress.kind === 'BOSS_FIGHT' ? 'Boss fight' : progress.kind === 'FARMING' ? `Farming ${CONFIG.stages[progress.stage - 1]?.id ?? ''}` : progress.kind === 'COMPLETE' ? 'Campaign complete' : `Pushing ${CONFIG.stages[stage - 1]?.id ?? ''}`;
    const party = state.partyIds.map((id, i) => { const hero = state.roster.find(h => h.id === id), role = getPartyHeroDefinition(id).role, hp = state.heroStats[id]?.maxHp ?? 0; return `<button class="px-home-hero" data-open-hero="${esc(id)}" ${control(`home-hero-${id}`)} aria-label="Open ${esc(shortName(id))}"><span>${['FRONT','MIDDLE','REAR'][i]}</span>${this.portrait(id, this.root.dataset.preset === '960' ? 1 : this.portraitScale(id, 96, 150))}<b>${esc(shortName(id))}</b><small>Lv ${hero?.level ?? 1} · ${hero?.stars ?? 1}★ · HP ${fmt(hp)}</small><i class="px-v2-role ${role}">${role.toUpperCase()}</i></button>`; }).join('');
    const campaignAction = progress.kind === 'BOSS_READY' ? button('home-fight-boss', 'Fight boss', 'data-action="retry"', { primary: true, className: 'px-large-action' }) : '';
    return [`<h2>Home</h2><div class="px-home-layout"><section class="px-home-campaign"><h3>Current stage</h3><strong>Stage ${esc(CONFIG.stages[stage - 1]?.id ?? '1-1')}</strong><p>${esc(label)}</p><p class="px-muted">3 waves · ${progress.kind.startsWith('BOSS') ? 'Boss encounter' : '90s timer'} · chapter ${Math.ceil(stage / 10)}</p><div class="px-home-actions">${button('home-stages', 'Open Stages', 'data-tab="stages"', { primary: true, className: 'px-large-action' })}${button('home-formation', 'Edit formation', 'data-tab="formation"')}${campaignAction}</div></section><section class="px-home-offline"><h3>Offline progress</h3><p>Farm ${esc(state.offline.stageId)} · ~${fmt(state.offline.goldPerHour)} gold/h · ~${fmt(state.offline.xpPerHour)} XP/h per hero</p><p class="px-muted">Cap ${state.offline.capHours} hours · next chest progress carries across visits.</p></section><section class="px-home-formation"><h3>Formation</h3><div class="px-home-party">${party}</div></section><section class="px-home-roster"><h3>Roster</h3><p>${state.roster.length} heroes owned · ${state.tickets} tickets</p><div>${button('home-recruit', 'Recruit', 'data-tab="recruit"')}${button('home-heroes', 'Heroes', 'data-tab="heroes"')}</div></section></div>`, ''];
  }
  private lockedHero(state: ManagementSnapshot): [string, string] {
    const definition = CONFIG.heroes.find(hero => hero.id === this.lockedHeroId);
    if (!definition || state.roster.some(hero => hero.id === definition.id)) { this.lockedHeroId = ''; return this.party(state); }
    const inRarity = CONFIG.heroes.filter(hero => hero.rarity === definition.rarity).length;
    const odds = ((state.recruit.rates[definition.rarity] ?? 0) * 100 / Math.max(1, inRarity)).toFixed(2);
    const backdrop = this.party(state)[0];
    return [`<div class="px-locked-backdrop" inert aria-hidden="true">${backdrop}</div><div class="px-howto-overlay"><section class="px-howto-card" role="dialog" aria-modal="true" data-rarity="${definition.rarity}" aria-label="How to recruit ${esc(shortName(definition.id))}"><div class="px-howto-portrait">${this.portrait(definition.id, this.portraitScale(definition.id, 96, 112))}</div><h3>${esc(shortName(definition.id))}</h3><p class="px-muted">${esc(definition.role)} · ${definition.rarity}</p><p>${esc(activeSkillName(definition.id))} · Signature</p><div class="px-howto-odds"><small>Base odds per pull</small><strong>${odds}%</strong><small>Pity raises this</small></div>${button('howto-recruit', 'Go to Recruit', 'data-go-recruit', { primary: true, className: 'px-large-action' })}</section></div>`, ''];
  }
  private stages(state: ManagementSnapshot): [string, string] {
    const current = state.progress.kind === 'BOSS_READY' ? state.progress.bossStage : state.progress.stage, chapter = this.stageChapter || (this.stageChapter = Math.ceil(current / 10));
    const nodes = Array.from({length: 10}, (_, i) => { const n = (chapter - 1) * 10 + i + 1, cleared = n <= state.highestCleared, active = n === current, selected = (this.stageSelection || current) === n; return `<button class="px-stage-node${cleared ? ' is-cleared' : ''}${active || selected ? ' is-current' : ''}${i === 9 ? ' is-boss' : ''}" data-stage-node="${n}" aria-pressed="${selected}"><b>${chapter}-${i + 1}</b><span>${i === 9 ? 'BOSS' : '3 waves'}</span><small>${cleared ? 'Cleared' : active ? 'Current' : 'Locked'}</small></button>`; }).join('');
    const campaign = campaignPresentation(state.progress, state.paused);
    const selected = this.stageSelection || current, selectedInfo = CONFIG.stages[selected - 1];
    return [`<h2>Stages</h2><div class="px-chapter-rail" role="tablist"><button class="px-chapter${chapter === 1 ? ' active' : ''}" data-chapter="1">Ch 1</button><button class="px-chapter${chapter === 2 ? ' active' : ''}" data-chapter="2">Ch 2</button></div><div class="px-stage-grid">${nodes}</div><section class="px-stage-detail"><b>Stage ${esc(selectedInfo?.id ?? '1-1')}</b><p>Chapter ${chapter} · ${selectedInfo?.isBoss ? 'Boss' : `${selectedInfo?.waves.length ?? 3} waves`} · ${selectedInfo?.timeoutSec ?? 90}s timer</p><p>First clear: ${selectedInfo?.firstClearTickets ?? 0} ticket${selectedInfo?.firstClearTickets === 1 ? '' : 's'}. Full heal between stages; HP carries between waves.</p><div>${campaign.action ? button('stage-push', campaign.action, 'data-action="retry"', { primary: true }) : ''}<span>Farm destination: ${esc(state.offline.stageId)}</span></div><small>${esc(campaign.management)}. Non-boss farm is time-scaled. Boss is not auto-retried.</small></section>`, ''];
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
    finally { if (this.pendingCompareGeneration === generation) { this.pendingCompare = false; if (this.isLive(generation) && (this.tab === 'gear' || this.equipOpen) && this.snapshotValue && this.selectedHero && this.selectedGear && this.compareKey !== `${this.snapshotValue.revision}:${JSON.stringify(this.snapshotValue.heroStats[this.selectedHero])}:${JSON.stringify(this.snapshotValue.inventory.find(item => item.id === this.selectedGear))}/${this.selectedHero}/${this.selectedGear}`) void this.loadComparison(this.snapshotValue); } }
  }
  private ownerOf(state: ManagementSnapshot, id: string) { return state.roster.find(hero => Object.values(hero.equipment).includes(id as GameState['inventory'][number]['id'])); }
  private openEquip(heroId: string, slot: 'weapon'|'armor'|'charm', opener: 'heroes'|'formation'): void {
    const state = this.snapshotValue; if (!state?.roster.some(hero => hero.id === heroId)) return;
    this.selectedHero = heroId; this.equipSlot = slot; this.equipOpener = opener; this.equipOpen = true;
    this.equipItem = state.roster.find(hero => hero.id === heroId)?.equipment[slot] ?? '';
    this.comparison = null; this.compareKey = ''; this.contentKey = ''; this.renderContent();
  }
  private cycleEquipHero(direction: number): void {
    const roster = this.snapshotValue?.roster ?? []; if (!roster.length) return;
    const index = roster.findIndex(hero => hero.id === this.selectedHero), next = (Math.max(0,index) + direction + roster.length) % roster.length;
    this.selectedHero = roster[next]!.id; this.equipItem = roster[next]!.equipment[this.equipSlot] ?? ''; this.comparison = null; this.compareKey = ''; this.contentKey = ''; this.renderContent();
  }
  private async autoEquipHero(): Promise<void> {
    const state = this.snapshotValue, hero = state?.roster.find(value => value.id === this.selectedHero); if (!state || !hero) return;
    for (const best of autoEquipBest(hero,state.inventory)) { const reply = await this.command({ type:'equip', heroId:hero.id, gearId:best.id }); if (!reply?.accepted) break; }
  }
  private equipScreen(state: ManagementSnapshot): [string,string] {
    const hero = state.roster.find(value => value.id === this.selectedHero) ?? state.roster[0]; if (!hero) return ['<p>No owned heroes.</p>',''];
    const definition = getPartyHeroDefinition(hero.id), rarity = heroConfig(hero.id).rarity;
    const current = state.inventory.find(item => item.id === hero.equipment[this.equipSlot]);
    const selected = state.inventory.find(item => item.id === this.equipItem && item.slot === this.equipSlot);
    const entries = equipList(state.inventory,state.roster,this.equipSlot);
    const baseSpeed = definition.role === 'support' ? 115 : definition.role === 'tank' ? 90 : definition.basic.style === 'melee' ? 100 : 105;
    const speedPctFor = (item: typeof current) => { const charm = this.equipSlot === 'charm' ? item : state.inventory.find(value => value.id === hero.equipment.charm); return charm ? charm.stats.speedPct * (1 + CONFIG.gear.upgrade.mainPerLevel * charm.level) : 0; };
    const speedFor = (item: typeof current) => speedPctFor(item) ? ` +${Math.round(speedPctFor(item) * 100)}%` : '';
    const stats = state.heroStats[hero.id];
    const slotCard = (slot: 'weapon'|'armor'|'charm') => { const item = state.inventory.find(value => value.id === hero.equipment[slot]); const title = slot[0]!.toUpperCase()+slot.slice(1); return `<button class="px-equip-slot${this.equipSlot===slot?' is-selected':''}${item?'':' is-empty'}" ${control(`equip-slot-${slot}`)} data-equip-slot="${slot}" aria-pressed="${this.equipSlot===slot}" data-rarity="${item?.rarity??'common'}"><span class="px-equip-slot-icon">${item?icon(SLOT_ICON[slot]!):'+'}</span><span><b>${title}</b><small>${item?`Lv ${item.level}<br>${this.itemStatLine(item).replace(/ · /g,'<br>')}`:'Empty slot'}</small></span></button>`; };
    const rows = entries.map(({gear:item,wornBy:wearer}) => `<button class="px-equip-row${this.equipItem===item.id?' is-selected':''}" ${control(`equip-item-${item.id}`)} data-rarity="${item.rarity}" data-equip-item="${item.id}"><span class="px-equip-row-icon">${shape(item.rarity)}${icon(SLOT_ICON[this.equipSlot]!)}</span><span class="px-equip-row-text"><b>${rarityText(item.rarity,`${item.rarity[0]!.toUpperCase()+item.rarity.slice(1)} ${this.equipSlot} Lv ${item.level}`)}</b><small>${esc(this.itemStatLine(item))}${wearer?` · ${wearer.id===hero.id?'Equipped':`Worn by ${shortName(wearer.id)}`}`:''}</small></span>${item.locked?'<i class="px-lock" aria-label="Locked"></i>':''}</button>`).join('') || '<p class="px-muted">No items in this slot.</p>';
    const comparison = this.comparison;
    const compareRows = selected && comparison ? ([['HP',comparison.before.maxHp,comparison.after.maxHp],['ATK',comparison.before.atk,comparison.after.atk],['DEF',comparison.before.def,comparison.after.def]] as const).map(([label,before,after])=>`<p><span>${label}</span><b class="${after>before?'px-green':after<before?'px-red':'px-muted'}">${fmt(before)} → ${fmt(after)} ${after>before?'+':''}${fmt(after-before)}</b></p>`).join('') + (() => { const beforePct = speedPctFor(current), afterPct = speedPctFor(selected), delta = (afterPct - beforePct) * baseSpeed; return `<p><span>Turn SPD</span><b class="${delta>0?'px-green':delta<0?'px-red':'px-muted'}">${baseSpeed}+${Math.round(beforePct*100)}%→${baseSpeed}+${Math.round(afterPct*100)}% ${delta>0?'+':''}${fmt(delta)}</b></p>`; })() : '<p class="px-muted">Select an item to compare.</p>';
    const owner = selected ? this.ownerOf(state,selected.id) : undefined, swap = owner && owner.id !== hero.id;
    const cost = selected ? upgradeCost(selected) : 0, canLock = selected && (selected.locked || state.inventory.filter(item=>item.locked).length < state.lockMax);
    return [`<section class="px-equip-screen" aria-label="Equip ${esc(shortName(hero.id))}"><header class="px-equip-heading"><button class="px-btn" data-equip-back ${control('equip-back')}>Back</button><h2>Equip</h2></header><div class="px-equip-stage"><button class="px-btn px-equip-prev" data-equip-cycle="prev" ${control('equip-prev')} aria-label="Previous hero">‹</button><button class="px-btn px-equip-next" data-equip-cycle="next" ${control('equip-next')} aria-label="Next hero">›</button><div class="px-equip-plate" data-rarity="${rarity}" style="background-image:url('${asset(`ui/equip-plate-${rarity}.png`)}')">${this.portrait(hero.id, this.portraitScale(hero.id, this.root.dataset.preset === '960' ? 132 : 220, this.root.dataset.preset === '960' ? 156 : 268))}</div><div class="px-equip-slot-position top">${slotCard('charm')}</div><div class="px-equip-slot-position left">${slotCard('weapon')}</div><div class="px-equip-slot-position right">${slotCard('armor')}</div><div class="px-equip-hero-meta"><b>${esc(shortName(hero.id))}</b><small>${esc(heroName(hero.id))}</small><i class="px-v2-role ${definition.role}">${definition.role.toUpperCase()}</i><p>HP ${fmt(stats?.maxHp??0)} · ATK ${fmt(stats?.atk??0)} · DEF ${fmt(stats?.def??0)} · Turn SPD ${baseSpeed}${speedFor(current)}</p></div></div><aside class="px-equip-drawer"><section class="px-equip-list"><h3>${this.equipSlot[0]!.toUpperCase()+this.equipSlot.slice(1)}</h3><div class="px-equip-rows" data-scroll="equip-list">${rows}</div><div class="px-equip-scroll-cue" aria-hidden="true"><img src="${asset('ui/icon-scroll-more.png')}" width="22" height="14"></div></section><section class="px-equip-compare"><h3>Compare</h3><div class="px-equip-deltas">${compareRows}</div>${swap?`<p class="px-equip-note">${esc(shortName(owner!.id))} loses this item.</p>`:''}<div class="px-equip-actions">${selected && selected.id !== hero.equipment[this.equipSlot] ? button('equip-apply',swap?'Swap':'Equip','data-action="equip-selected"',{primary:true,className:'px-equip-primary'}) : ''}<span class="px-sr" id="unequip-note">Unequip is not available because the management actions do not support it.</span><button class="px-btn" disabled aria-describedby="unequip-note" aria-label="Unequip unavailable" title="Unequip is not supported by the current management actions">Unequip</button>${selected?button('equip-upgrade',`Upgrade · ${fmt(cost)} gold`,'data-action="equip-upgrade"',{disabled:!cost||state.gold<cost||selected.level>=CONFIG.gear.upgrade.maxLevel}):''}<button class="px-btn" ${control('equip-lock')} data-equip-lock="${selected?.locked===true}" ${canLock?'':'disabled'}>${selected?.locked?'Unlock':'Lock'}</button><button class="px-btn" ${control('equip-auto')} data-equip-auto>Auto-equip best</button></div></section></aside></section>`, ''];
  }
  private itemStatLine(item: ManagementSnapshot['inventory'][number]): string { const mult=1+CONFIG.gear.upgrade.mainPerLevel*item.level; const values=[item.stats.hp?`HP +${fmt(item.stats.hp*mult)}`:'',item.stats.atk?`ATK +${fmt(item.stats.atk*mult)}`:'',item.stats.def?`DEF +${fmt(item.stats.def*mult)}`:'',item.stats.hpPct?`HP +${fmt(item.stats.hpPct*mult*100)}%`:'',item.stats.atkPct?`ATK +${fmt(item.stats.atkPct*mult*100)}%`:'',item.stats.speedPct?`SPD +${fmt(item.stats.speedPct*mult*100)}%`:''].filter(Boolean); return values.join(' · '); }
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
    if (this.partyWorkspace === 'formation') {
      const owned = state.roster.map(hero => `<button type="button" class="px-card px-dnd-source${hero.id === selected?.id ? ' px-sel' : ''}" ${control(`hero-${hero.id}`)} data-hero="${esc(hero.id)}" data-drag-hero="${esc(hero.id)}" aria-label="${esc(`${heroName(hero.id)}, level ${hero.level}${state.partyIds.includes(hero.id) ? `, deployed ${['Front', 'Middle', 'Rear'][state.partyIds.indexOf(hero.id)]}` : ', on bench'}. Select or drag to a slot.`)}" aria-pressed="${hero.id === selected?.id}" data-help="${esc(`${heroName(hero.id)} · level ${hero.level} · ${state.partyIds.includes(hero.id) ? `deployed ${['Front', 'Middle', 'Rear'][state.partyIds.indexOf(hero.id)]}` : 'bench'} · drag to a slot or select and Assign.`)}">${this.portrait(hero.id)}<span class="px-name">${esc(shortName(hero.id))}</span><span class="px-card-lv">Lv${hero.level}</span><span class="px-drag-grip" data-drag-grip="${esc(hero.id)}" aria-hidden="true"></span></button>`).join('');
      const formationSlots = state.partyIds.map((id, index) => { const hero = state.roster.find(value => value.id === id), role = getPartyHeroDefinition(id).role; return `<article class="px-formation px-wide-formation px-dnd-target${this.selectedPartySlot === index ? ' px-sel' : ''}" data-drag-hero="${esc(id)}"><button type="button" class="px-slot-select" ${control(`party-slot-${index}`)} data-party-slot="${index}" aria-label="Select ${['Front', 'Middle', 'Rear'][index]} slot" aria-pressed="${this.selectedPartySlot === index}" data-help="${esc(`${['Front', 'Middle', 'Rear'][index]} · changes apply at the next encounter.`)}"><span class="px-index">${['FRONT', 'MIDDLE', 'REAR'][index]}</span>${this.portrait(id, this.portraitScale(id, this.root.dataset.preset === '960' ? 96 : 112, this.root.dataset.preset === '960' ? 96 : 112))}<span class="px-slot-name">${esc(shortName(id))}</span><span class="px-stars">${'★'.repeat(hero?.stars ?? 1)}${'☆'.repeat(CONFIG.growth.starMax - (hero?.stars ?? 1))}</span><i class="px-v2-role ${role}">${role.toUpperCase()}</i></button><div class="px-slot-actions"><button type="button" class="px-v2-slot-equip" ${control(`formation-equip-${id}`)} data-equip-slot="weapon" aria-label="Equip gear for ${esc(shortName(id))}">Equip</button><button type="button" class="px-btn px-v2-slot-detail" data-open-hero="${esc(id)}" ${control(`formation-detail-${id}`)} aria-label="Open ${esc(shortName(id))} details">Details</button></div><span class="px-drag-grip" data-drag-grip="${esc(id)}" aria-hidden="true"></span>${hero?.partyLocked ? '<i class="px-lock" aria-label="Preset locked"></i>' : ''}</article>`; }).join('');
      const changed = state.partyIds.some((id, i) => state.deployedPartyIds?.[i] !== id);
      return [`<h2 >Formation</h2><section class="px-formation-view" aria-label="Party formation"><div class="px-formation-toolbar"><div class="px-formation-tools">${this.dropdown('party-preset', 'Preset', PRESETS, preset, 142, 'data-setting="party-preset"')}${button('auto-party', 'Apply preset', 'data-action="auto-party"', { primary: true })}${button('auto-equip', 'Auto-equip', 'data-action="auto-equip"')}</div><div class="px-formation-tools">${button('workspace-heroes', 'Heroes', 'data-party-workspace="heroes"', { selected: false })}${button('workspace-formation', 'Formation', 'data-party-workspace="formation"', { selected: true })}${button('formation-help', '?', 'data-help-toggle data-help="Front is nearest the enemy. Drag heroes between slots to swap or from the roster to replace. Manual assignments override preset locks and apply at the next encounter."', { aria: 'Formation help' })}</div></div><div class="px-formation-help-row"><span class="px-coverage ${coverage.length ? 'px-warn' : ''}" ${coverage.length ? `data-help="${esc(`Coverage missing: ${coverage.join(', ')}. Choose a different preset or assign heroes manually.`)}"` : 'data-help="Role coverage is complete for this preset."'}>${coverage.length ? `Missing: ${coverage.join(', ')}` : 'Coverage complete'}</span><span>${changed ? 'Formation applies at the next encounter.' : 'Drag a hero to a slot, or select and Assign.'}</span></div><div class="px-formations px-formations-large">${formationSlots}</div><div class="px-formation-roster" data-scroll="formation-roster" aria-label="Owned heroes">${owned}</div><div class="px-formation-assign">${button(`assign-${selected?.id ?? ''}`, `Assign to ${['Front', 'Middle', 'Rear'][this.selectedPartySlot]}`, `data-assign="${esc(selected?.id ?? '')}"`, { primary: true, disabled: !selected || this.formationPending, aria: `Assign ${selected ? heroName(selected.id) : 'selected hero'} to ${['Front', 'Middle', 'Rear'][this.selectedPartySlot]}` })}${selected ? button(`formation-lock-${selected.id}`, selected.partyLocked ? 'Unlock preset slot' : 'Lock preset slot', `data-lock-hero="${esc(selected.id)}" data-locked="${selected.partyLocked === true}"`, { selected: selected.partyLocked === true, disabled: this.formationPending }) : ''}<span class="px-muted">${selected ? esc(shortName(selected.id)) : 'Select a hero'}</span></div></section>`, '<span></span>'];
    }
    return this.heroLoadout(state, selected, selectedDef, stats);
  }

  private heroLoadout(state: ManagementSnapshot, selected: ManagementSnapshot['roster'][number] | undefined,
    selectedDef: ReturnType<typeof getPartyHeroDefinition> | undefined, stats: ManagementSnapshot['heroStats'][string] | undefined): [string, string] {
    const rarityOrder = CONFIG.rarity.order as readonly string[];
    const definitions = CONFIG.heroes.filter(definition => (this.heroRarityFilter === 'all' || definition.rarity === this.heroRarityFilter)
      && (this.heroRoleFilter === 'all' || getPartyHeroDefinition(definition.id).role === this.heroRoleFilter)).sort((a, b) => {
      const ownedDelta = Number(state.roster.some(hero => b.id === hero.id)) - Number(state.roster.some(hero => a.id === hero.id));
      if (ownedDelta) return ownedDelta;
      if (this.heroSort === 'name') return shortName(a.id).localeCompare(shortName(b.id));
      if (this.heroSort === 'level') return (state.roster.find(hero => hero.id === b.id)?.level ?? -1) - (state.roster.find(hero => hero.id === a.id)?.level ?? -1);
      return rarityOrder.indexOf(b.rarity) - rarityOrder.indexOf(a.rarity) || shortName(a.id).localeCompare(shortName(b.id));
    });
    const rosterCards = definitions.map(definition => {
      const hero = state.roster.find(value => value.id === definition.id), role = getPartyHeroDefinition(definition.id).role;
      const rarity = definition.rarity;
      return `<button type="button" class="px-v2-hero-card${hero ? '' : ' is-locked'}" data-rarity="${rarity}" ${control(hero ? `hero-${hero.id}` : `locked-${definition.id}`)} ${hero ? `data-hero="${esc(hero.id)}" data-details-open` : `data-locked-hero="${esc(definition.id)}"`} title="${esc(definition.name)}">`
        + `<span class="px-v2-art">${this.portrait(definition.id, 2)}<span class="px-v2-stars">${hero ? '★'.repeat(hero.stars) : ''}${'☆'.repeat(Math.max(0, CONFIG.growth.starMax - (hero?.stars ?? 0)))}</span></span>`
        + `<b>${esc(shortName(definition.id))}</b><span><i class="px-v2-role ${role}">${role.toUpperCase()}</i> ${hero ? `Lv ${hero.level}` : 'LOCKED'}</span></button>`;
    }).join('');
    if (!this.detailsOpen) return [`<div class="px-v2-roster-head"><h2>Heroes</h2><span>${state.roster.length} / ${CONFIG.heroes.length} owned · ${definitions.length} shown</span>${this.dropdown('hero-role','Role',[{value:'all',label:'Role: All'}, ...['tank','dps','support'].map(value=>({value,label:`Role: ${value}`}))],this.heroRoleFilter,128,'data-filter="hero-role"')}${this.dropdown('hero-rarity','Rarity',[{value:'all',label:'Rarity: All'}, ...CONFIG.rarity.order.map(value=>({value,label:`Rarity: ${value}`,rarity:value}))],this.heroRarityFilter,136,'data-filter="hero-rarity"')}${this.dropdown('hero-sort','Sort',[{value:'rarity',label:'Sort: Rarity'},{value:'name',label:'Sort: Name'},{value:'level',label:'Sort: Level'}],this.heroSort,128,'data-filter="hero-sort"')}</div><section class="px-v2-roster" aria-label="Hero roster">${rosterCards}</section>`, ''];
    if (!selected || !selectedDef || !stats) { this.detailsOpen = false; return this.heroLoadout(state, state.roster[0], state.roster[0] ? getPartyHeroDefinition(state.roster[0].id) : undefined, state.roster[0] ? state.heroStats[state.roster[0].id] : undefined); }
    const combatRole = selectedDef.role;
    const baseSpeed = combatRole === 'support' ? 115 : combatRole === 'tank' ? 90 : selectedDef?.basic.style === 'melee' ? 100 : 105;
    const charm = state.inventory.find(item => item.id === selected.equipment.charm);
    const speedBonus = charm ? charm.stats.speedPct * (1 + CONFIG.gear.upgrade.mainPerLevel * charm.level) : 0;
    const statsRows = [['HP', fmt(stats?.maxHp ?? 0)], ['ATK', fmt(stats?.atk ?? 0)], ['DEF', fmt(stats?.def ?? 0)], ['Turn SPD', `${baseSpeed}${speedBonus ? ` +${Math.round(speedBonus * 100)}%` : ''}`]];
    const detailScale = this.portraitScale(selected.id, this.root.dataset.preset === '960' ? 112 : 220, this.root.dataset.preset === '960' ? 112 : 208);
    const definition = getPartyHeroDefinition(selected.id);
    const mana = definition.active.manaCost ?? 60;
    const basicNames: Record<string,string> = { 'guardian-strike':'Guardian Strike', 'bruiser-strike':'Brute Strike', 'melee-cleave-strike':'Cleave', 'ranger-shot':'Ranger Shot', 'priest-heal-or-bolt':'Prayer', 'hex-bolt':'Hex Bolt', 'banner-bolt':'Banner Bolt', 'arcane-bolt':'Arcane Bolt', 'wide-cleave-strike':'Wide Cleave', 'duelist-strike':'Duelist Strike', 'long-range-shot':'Long Shot' };
    const passiveNames: Record<string,string> = { intercept:'Intercept', fourthSelfHeal:'Fourth Strike Heal', sameTargetRamp:'Focused Assault', fourthBonus:'Fourth Shot', healGuard:'Heal Guard', firstWeakenShield:'Opening Ward', livingAura:'Living Banner', thirdSplash:'Third Shot Splash', fourthGuard:'Fourth Hit Guard' };
    const passive = definition.passive;
    const passiveDescription = passive.kind === 'healGuard' ? `When healing an ally, grants ${pct(passive.coefficient ?? 0)} damage reduction for ${(passive.durationTicks ?? 0) / CONFIG.sim.ticksPerSecond}s.`
      : passive.kind === 'sameTargetRamp' ? `Repeated attacks on one target gain ${pct(passive.coefficient ?? 0)} damage, up to ${pct(passive.cap ?? 0)}.`
      : passive.kind === 'intercept' ? `Intercepts a committed hit within ${passive.range ?? 0} range; ${(passive.cooldownTicks ?? 0) / CONFIG.sim.ticksPerSecond}s cooldown.`
      : passive.kind === 'fourthSelfHeal' ? `Every fourth strike heals ${pct(passive.coefficient ?? 0)} of dealt damage.`
      : passive.kind === 'fourthBonus' ? `Every fourth shot deals ${pct(passive.coefficient ?? 0)} bonus damage.`
      : passive.kind === 'firstWeakenShield' ? `The first weaken grants a ${pct(passive.shieldFraction ?? 0)} max HP shield for ${(passive.durationTicks ?? 0) / CONFIG.sim.ticksPerSecond}s.`
      : passive.kind === 'livingAura' ? `Reduces enemy attack by ${pct(passive.atkReduction ?? 0)} while alive.`
      : passive.kind === 'thirdSplash' ? `Every third shot splashes ${pct(passive.coefficient ?? 0)} damage in ${passive.radius ?? 0} range.`
      : passive.kind === 'fourthGuard' ? `Every fourth hit grants the party a defensive guard.` : definition.strength;
    const skills = [
      ['B', basicNames[definition.basic.id] ?? 'Basic Attack', 'Basic', `${definition.basic.id === 'priest-heal-or-bolt' ? 'Heal a wounded ally; when no ally needs healing, bolt an enemy' : `${definition.basic.style} attack`} · ${definition.basic.coefficient}× coefficient${definition.basic.id === 'priest-heal-or-bolt' ? ' (0.7× damage fallback)' : ''}. Basics grant 20 mana; tanks gain 5 mana when they take direct hostile HP damage.`],
      ['S', activeSkillName(selected.id), `Signature · Mana ${mana}`, `${activeDescription(selected.id)}. Automatically casts when mana is ready.`],
      ['P', passiveNames[passive.kind] ?? 'Passive', 'Passive', passiveDescription],
    ].map(([mark, name, kind, description]) => `<article class="px-v2-skill"><i>${mark}</i><div><b>${esc(name!)}</b><small>${esc(kind!)}</small><p>${esc(description!)}</p><label>Scales with level and stars</label></div></article>`).join('');
    const gearSlots = (['weapon','armor','charm'] as const).map(slot => { const item = state.inventory.find(value => value.id === selected.equipment[slot]); return `<button type="button" class="px-v2-detail-slot" ${control(`detail-slot-${slot}`)} data-loadout-slot="${slot}" data-rarity="${item?.rarity ?? 'common'}">${icon(SLOT_ICON[slot]!)}<span><b>${slot[0]!.toUpperCase()+slot.slice(1)}</b><small>${item ? `${item.rarity} Lv ${item.level}` : 'Empty slot'}</small></span><strong>›</strong></button>`; }).join('');
    const xpNeeded = Math.round(CONFIG.growth.xpToNext.a * selected.level ** CONFIG.growth.xpToNext.p);
    return [`<div class="px-v2-detail-head">${button('details-close', this.detailsOpener === 'formation' ? 'Back to Formation' : 'Back to Heroes', 'data-details-close')}<h2>${esc(shortName(selected.id))}</h2><small>${esc(heroName(selected.id))}</small></div><section class="px-v2-detail"><article class="px-v2-hero-summary" data-rarity="${heroConfig(selected.id).rarity}"><div class="px-v2-detail-art">${this.portrait(selected.id, detailScale)}</div><h3>${esc(shortName(selected.id))}</h3><small>${esc(heroName(selected.id))}</small><p><i class="px-v2-role ${combatRole}">${combatRole.toUpperCase()}</i> ${heroConfig(selected.id).rarity.toUpperCase()}</p><p>${esc(heroConfig(selected.id).role)} · ${esc(selectedDef?.family ?? '')}</p><b>Lv ${selected.level} / 50 · ${selected.stars}★</b><small>XP ${fmt(selected.xp)} / ${fmt(xpNeeded)} to next level</small></article><section class="px-v2-detail-center"><article class="px-v2-stats">${statsRows.map(([k,v])=>`<p><span>${k}</span><b>${v}</b></p>`).join('')}</article>${skills}</section><section class="px-v2-gear">${gearSlots}${button('detail-equip', 'Equip', 'data-loadout-slot="weapon"', {primary:true})}</section></section>`, ''];
  }

  private gearInspector(state: ManagementSnapshot, item: ManagementSnapshot['inventory'][number] | undefined, withCompare: boolean): string {
    if (!item) return `<section class="px-inspector px-insp-empty"><p class="px-muted">Select gear to inspect it.</p></section>`;
    const owner = this.ownerOf(state, item.id), comparison = this.comparison, mult = 1 + CONFIG.gear.upgrade.mainPerLevel * item.level, cost = upgradeCost(item);
    const signed = (value: number, text = String(value)) => `<span class="${value > 0 ? 'px-green' : value < 0 ? 'px-red' : 'px-muted'}">${value >= 0 ? '+' : ''}${text}</span>`;
    const stats = [['HP', item.stats.hp * mult], ['ATK', item.stats.atk * mult], ['DEF', item.stats.def * mult]].filter(([, value]) => Number(value) > 0).map(([label, value]) => `${label} ${fmt(Number(value))}`)
      .concat([['HP%', item.stats.hpPct], ['ATK%', item.stats.atkPct], ['speed', item.stats.speedPct]].filter(([, value]) => Number(value) > 0).map(([label, value]) => `${label} ${fmt(Number(value) * mult * 100)}${label === 'speed' ? '%' : ''}`));
    const compare = withCompare ? `<div class="px-compare"><span class="px-label">Compare / equip to</span>${this.dropdown('hero', 'Compare or equip to', state.roster.map(hero => ({ value: hero.id, label: shortName(hero.id) })), this.selectedHero, 184, 'data-select="hero"')}</div>`
      + (comparison ? `<div class="px-deltas" aria-label="Hero before and after">${[
        ['HP', comparison.before.maxHp, comparison.after.maxHp, comparison.delta.maxHp], ['ATK', comparison.before.atk, comparison.after.atk, comparison.delta.atk], ['DEF', comparison.before.def, comparison.after.def, comparison.delta.def],
      ].map(([label, before, after, delta]) => `<p><span class="px-dl">${label}</span>${before} → ${after} ${signed(Number(delta))}</p>`).join('')}`
        + `<p><span class="px-dl">Cycle</span>${comparison.before.attackTicks} → ${comparison.after.attackTicks}</p><p><span class="px-dl">DPS</span>${signed(comparison.delta.basicDps, comparison.delta.basicDps.toFixed(2))}</p></div>`
        + `<p class="${comparison.partyUtilityGain > 0 ? 'px-green' : 'px-muted'}">Party utility gain ${comparison.partyUtilityGain >= 0 ? '+' : ''}${comparison.partyUtilityGain.toFixed(3)}${comparison.partyUtilityGain > 0 ? ' · recommended' : ''}</p>` : '<p role="status" class="px-muted">Calculating comparison…</p>') : '';
    const maxed = item.level >= CONFIG.gear.upgrade.maxLevel;
    return `<section class="px-inspector" aria-label="Gear details"><div class="px-insp-scroll" data-scroll="gear-inspector"><h3>${shape(item.rarity)}${rarityText(item.rarity, `${item.rarity} ${item.slot}`.toUpperCase())}</h3>`
      + `<p>${icon(SLOT_ICON[item.slot] ?? 'chest')} Lv ${item.level} · ${owner ? esc(shortName(owner.id)) : 'stash'}${item.acquiredAt.source === 'starter' ? ' · starter kit' : ''}</p><p class="px-stats">${stats.join(' · ') || 'No stats'}</p>`
      + `<p class="px-muted">Next level: ${maxed ? 'max level' : `x${(1 + CONFIG.gear.upgrade.mainPerLevel * (item.level + 1)).toFixed(2)} stats`}</p>${withCompare ? `<p>${button('gear-lock', item.locked ? 'Unlock gear' : 'Lock gear', `data-gear-lock="${item.locked === true}"`, { disabled: !item.locked && state.inventory.filter(value => value.locked).length >= state.lockMax })} <span class="px-muted">${state.inventory.filter(value => value.locked).length}/${state.lockMax} locked</span></p>` : ''}${compare}</div>`
      + `<div class="px-insp-foot">${withCompare ? button('equip', 'Equip', 'data-action="equip"', { primary: true }) : ''}${button('upgrade', withCompare ? `Upgrade ${cost} G` : `Upgrade ${item.slot} · ${cost} G`, 'data-action="upgrade"', { disabled: state.gold < cost || maxed, primary: !withCompare, ...(withCompare ? {} : { icon: 'gold' }) })}</div></section>`;
  }
  /** Stash (§7.2): three dropdown filters, 40×40 slot grid, chest-choice cards, gear inspector. */
  private stash(state: ManagementSnapshot): [string, string] {
    if (!state.inventory.some(value => value.id === this.selectedGear) && state.inventory[0]) { this.selectedGear = state.inventory[0].id; this.compareKey = ''; this.comparison = null; }
    const item = state.inventory.find(value => value.id === this.selectedGear), choices = state.pendingChoice ?? [];
    if (item && !state.roster.some(hero => hero.id === this.selectedHero)) this.selectedHero = state.partyIds[0] ?? state.roster[0]?.id ?? '';
    const owners: Choice[] = [{ value: 'all', label: 'All stash' }, ...state.roster.map(hero => ({ value: hero.id, label: shortName(hero.id) }))];
    const visible = state.inventory.filter(gear => (this.slotFilter === 'all' || gear.slot === this.slotFilter) && (this.rarityFilter === 'all' || gear.rarity === this.rarityFilter)
      && (this.ownerFilter === 'all' || state.roster.find(hero => hero.id === this.ownerFilter)?.equipment[gear.slot] === gear.id));
    const slots = visible.map(gear => { const by = this.ownerOf(state, gear.id);
      return `<button type="button" class="px-slot${this.selectedGear === gear.id ? ' px-sel' : ''}" data-rarity="${gear.rarity}" ${control(`gear-${gear.id}`)} data-gear="${gear.id}" aria-pressed="${this.selectedGear === gear.id}" aria-label="${esc(`${gear.rarity} ${gear.slot}, level ${gear.level}${by ? `, on ${heroName(by.id)}` : ''}`)}">${shape(gear.rarity)}${icon(SLOT_ICON[gear.slot] ?? 'chest')}${gear.level ? `<span class="px-count">+${gear.level}</span>` : ''}${gear.locked ? '<i class="px-lock" aria-label="Locked"></i>' : ''}${by ? '<i class="px-worn"></i>' : ''}</button>`; }).join('');
    const score = (gear: { stats: { hp: number; atk: number; def: number; hpPct: number; atkPct: number; speedPct: number } }) => gear.stats.hp / 8 + gear.stats.atk + gear.stats.def + 100 * (gear.stats.hpPct + gear.stats.atkPct + gear.stats.speedPct);
    const pair = choices[0];
    const pending = pair ? `<section class="px-chest" aria-label="Chest choice"><div class="px-heading"><h3>CHEST: PICK 1 OF 2</h3>${choices.length > 1 ? `<span class="px-muted">${choices.length - 1} more waiting</span>` : ''}</div><div class="px-chest-cards">${pair.map((gear, index) => {
      const better = score(gear) >= score(pair[1 - index] ?? gear);
      return `<div class="px-chest-card" data-rarity="${gear.rarity}">${shape(gear.rarity)}${icon(SLOT_ICON[gear.slot] ?? 'chest')}${rarityText(gear.rarity, `${gear.rarity.toUpperCase()} ${gear.slot}`)}${button(`choose-${index}`, `Keep ${index + 1}`, `data-action="choose-${index}"`, { primary: better })}</div>`; }).join('')}</div></section>` : '';
    const fortuneLimit = CONFIG.v14.fortune.legendaryEvery > 0 ? 100 : 0;
    const fortune = fortuneLimit > 0 ? `<section class="px-v2-fortune"><b>Fortune</b><span>in ${Math.max(0, fortuneLimit - (state.gearFortune ?? 0))}</span><div><i style="width:${Math.min(100, Math.round((state.gearFortune ?? 0) * 100 / fortuneLimit))}%"></i></div><small>${state.gearFortune ?? 0}/${fortuneLimit}</small></section>` : '';
    return [`<h2 >Gear</h2>${fortune}<div class="px-filters">${this.dropdown('slot', 'Slot', ['all', 'weapon', 'armor', 'charm'].map(value => ({ value, label: value === 'all' ? 'All slots' : value })), this.slotFilter, 96, 'data-filter="slot"')}`
      + `${this.dropdown('rarity', 'Rarity', [{ value: 'all', label: 'All rarity' }, ...CONFIG.rarity.order.map(value => ({ value, label: value, rarity: value }))], this.rarityFilter, 96, 'data-filter="rarity"')}${this.dropdown('owner', 'Owner', owners, this.ownerFilter, 136, 'data-filter="owner"')}</div>`
      + `<div class="px-left" data-scroll="stash">${pending}<div class="px-grid">${slots}</div>${slots ? '' : `<p class="px-muted px-empty-grid">${state.inventory.length ? 'No matching gear.' : 'No gear yet. Defeat a wave.'}</p>`}</div>${this.gearInspector(state, item, true)}`,
      `${button('stash-auto-equip', 'Auto-equip best', 'data-action="auto-equip"')}${button('gear-upgrades', 'Upgrades', 'data-action="gear-upgrades"')}<p class="px-muted">${state.inventory.length}/${CONFIG.gear.inventoryCap} items</p>`];
  }
  /** Recruit: one banner, distinct odds and pity panels, history, and footer pull actions. */
  private recruit(state: ManagementSnapshot): [string, string] {
    const meters = CONFIG.ui.pityMeters.recruit, epic = state.recruit.epicPlusRemaining, legend = state.recruit.legendaryRemaining, fresh = state.recruit.newHeroRemaining;
    const pityEnabled = activeV14Rules().includes('recruitPity'), rosterComplete = state.roster.length >= CONFIG.heroes.length;
    const meter = (label: string, remaining: number, total: number, color: string) => `<div class="px-pity-meter"><span>${label}</span><b>${rosterComplete ? 'Roster complete' : `${remaining} / ${total}`}</b><i><em style="width:${rosterComplete ? 100 : Math.round((total - remaining) * 100 / total)}%;background:${color}"></em></i></div>`;
    const pity = meter('Epic+ · every 30', epic, EPIC_PITY_PULLS, meters.colors.epicSegment)
      + (pityEnabled && legend !== null ? meter('Legend · every 60', legend, 60, meters.colors.legendSegment) : '')
      + (pityEnabled && fresh !== null ? meter('New hero · every 20', fresh, 20, meters.colors.newSegment) : '');
    const owned = new Set(state.roster.map(hero => hero.id)), heroesByRarity = (rarity: string) => CONFIG.heroes.filter(hero => hero.rarity === rarity).map(hero => hero.id);
    const featured = heroesByRarity('legendary').find(id => !owned.has(id)) ?? heroesByRarity('legendary')[0] ?? CONFIG.heroes[0]!.id;
    const odds = Object.entries(state.recruit.rates).map(([rarity, value]) => `${rarity}: ${Number((value * 100).toFixed(2))}%`).join(' · ');
    const history = [...state.recentPulls].reverse().map(result => `<li data-rarity="${esc(result.rarity)}">${shape(result.rarity)}${esc(shortName(result.heroId))}${result.duplicate ? ' <span class="px-badge">+1★</span>' : ' <span class="px-badge px-green">NEW</span>'}${result.pity ? ' <span class="px-badge px-gold">PITY</span>' : ''}</li>`).join('') || '<li class="px-muted">No pulls yet.</li>';
    const cost = state.recruit.cost;
    return [`<h2>Recruit</h2><div class="px-banners px-recruit-layout"><section class="px-banner" aria-label="All heroes banner"><h3>ALL HEROES</h3><span class="px-pview">${this.portrait(featured, 2)}</span><p class="px-gold px-b">${cost} TICKET${cost === 1 ? '' : 'S'}</p><p class="px-muted">${state.tickets} tickets · ${state.roster.length}/${CONFIG.heroes.length} owned</p></section>
      <section class="px-odds" aria-label="Recruit odds"><h3>RECRUIT INFO</h3><div class="px-recruit-rates"><b>Rates</b> ${odds}</div><p class="px-recruit-rules">Duplicates add +1★ up to ${CONFIG.growth.starMax}★, then grant ${CONFIG.runtime.duplicateGold} × rarity gold. Owned heroes remain in the pool.</p>${button('recruit-help', 'Odds & pity details', `data-help-toggle data-help="${esc(`Epic+ guaranteed every ${EPIC_PITY_PULLS} pulls.${pityEnabled ? ` Legend guaranteed every ${CONFIG.v14.recruit.legendaryPityEvery} pulls; new hero every ${CONFIG.v14.recruit.newHeroGuaranteeEvery} pulls.` : ''} Duplicate rules: +1 star up to ${CONFIG.growth.starMax}, then rarity-scaled gold.`)}"`, { aria: 'Show recruit pity details' })}</section></div><section class="px-recruit-pity" aria-label="Pity meters">${pity}</section>`
      + `<section class="px-history"><div class="px-heading px-heading-left"><h3>HISTORY</h3><span class="px-muted">${state.stats.pulls} PULLS</span></div><ol class="px-list" data-scroll="history">${history}</ol></section>`,
      `<span></span><div class="px-row">${button('pull-one', 'Recruit x1', 'data-action="pull-one" style="width:132px"', { disabled: state.tickets < cost, primary: true })}${button('pull-ten', 'Recruit x10', 'data-action="pull-ten" style="width:140px"', { disabled: state.tickets < cost * 10, primary: true })}</div>`];
  }
  /** Upgrades (§7.4): 48 px rows of equipped gear with the wearer portrait and cost, plus the gear inspector. */
  private upgrades(state: ManagementSnapshot): [string, string] {
    const equipped = state.inventory.filter(item => this.ownerOf(state, item.id));
    if (!equipped.some(item => item.id === this.selectedGear) && equipped[0]) this.selectedGear = equipped[0].id;
    const selected = equipped.find(item => item.id === this.selectedGear);
    const rows = equipped.map(item => { const by = this.ownerOf(state, item.id), cost = upgradeCost(item), affordable = state.gold >= cost;
      return `<button type="button" class="px-urow${this.selectedGear === item.id ? ' px-sel' : ''}" data-rarity="${item.rarity}" ${control(`gear-${item.id}`)} data-gear="${item.id}" aria-pressed="${this.selectedGear === item.id}">`
        + `<span class="px-urow-portrait">${by ? this.portrait(by.id) : ''}</span>${icon(SLOT_ICON[item.slot] ?? 'chest')}${shape(item.rarity)}<span class="px-urow-text">${rarityText(item.rarity, `${item.rarity.toUpperCase()} ${item.slot}`)}<span>Lv ${item.level} · ${by ? esc(shortName(by.id)) : ''} · <span class="${affordable ? 'px-gold' : 'px-red'}">${cost} G</span></span></span></button>`; }).join('');
    return [`<h2 >Upgrades</h2><p class="px-hint" style="top:0">Gold ${fmt(state.gold)}. Select equipped gear to upgrade.</p><div class="px-left px-urows" data-scroll="upgrades">${rows || '<p class="px-muted">No equipped items.</p>'}</div>${this.gearInspector(state, selected, false)}`,
      `${button('gear-upgrades', 'Back to Gear', 'data-action="gear-upgrades"')}<p class="px-muted">Upgrade uses the current progression cost.</p>`];
  }
  /** Settings (§7.5): pause and mute toggles, four volume sliders (master + buses), zoom pair, placement dropdown, notes. */
  private settings(state: ManagementSnapshot): [string, string] {
    const prefs = this.compactPrefs, width = this.root.dataset.preset === '960' ? 280 : 400, zoom = String(prefs?.zoom ?? 1);
    const nextChest = Math.max(0, Math.ceil(state.offline.secondsUntilNextChest)), chestTime = nextChest >= 3600
      ? `${Math.floor(nextChest / 3600)}h ${Math.ceil(nextChest % 3600 / 60)}m` : `${Math.ceil(nextChest / 60)}m`;
    return [`<h2>Settings</h2><div class="px-settings px-v2-settings">
      <section class="px-offline-summary px-setting-group" aria-label="Offline progress"><div class="px-offline-rate"><h3>Offline progress</h3><span class="px-badge ${state.offline.earned ? 'px-green' : ''}">${state.offline.earned ? 'Earned' : 'Estimate'}</span></div><p>Farm ${esc(state.offline.stageId)} · ~${fmt(state.offline.goldPerHour)} gold/h · ~${fmt(state.offline.xpPerHour)} XP/h per hero</p><p>Cap ${state.offline.capHours} hours · next chest in ${chestTime}. Partial gold, XP, tickets, and chest progress carry across visits.</p></section>
      <section class="px-setting-group" aria-label="Simulation and audio"><h3>Simulation and audio</h3><div class="px-srow">${toggle('pause', 'pause', !state.paused, state.paused ? 'Resume simulation' : 'Pause simulation', 'Simulation running')}</div><div class="px-srow">${toggle('mute', 'mute', this.audioValue.muted, this.audioValue.muted ? 'Unmute audio' : 'Mute audio', 'Audio muted')}</div>${slider('master', 'Volume', this.audioValue.volume, width)}${slider('music', 'Music', this.sliderValue('music'), width)}${slider('sfx', 'SFX', this.sliderValue('sfx'), width)}${slider('ui', 'UI', this.sliderValue('ui'), width)}</section>
      <section class="px-setting-group" aria-label="Window"><h3>Window</h3><div class="px-srow px-zoomrow"><span class="px-slider-label">Zoom</span><span class="px-pair" role="group" aria-label="Zoom">${['1', '2'].map(value => button(`zoom-${value}`, `${value}×`, `data-zoom="${value}"`, { selected: zoom === value, className: 'px-zoom' })).join('')}</span></div><div class="px-srow">${this.dropdown('placement', 'Placement', [{ value: 'free', label: 'Free' }, { value: 'snapped', label: 'Snap to bottom' }], prefs?.placement ?? 'free', 160, 'data-setting="placement"')}${button('reset-size', 'Reset size', 'data-action="reset-size"')}</div><p>Integer zoom. Letterbox instead of fractional scaling.</p></section>
      <section class="px-setting-group" aria-label="Recovery"><h3>Save recovery</h3><p>If a save cannot be loaded, use the game window recovery panel to export it or discard it.</p>${button('recovery-help', 'Recovery help', 'data-help-toggle data-help="If a save cannot be loaded, use the game window recovery panel to export it or discard it."', { aria: 'Explain save recovery' })}</section></div>`, ''];
  }
}
