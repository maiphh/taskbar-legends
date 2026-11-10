import { CONFIG, heroConfig } from '../config';
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
  getAudio(): Promise<{ muted: boolean; volume: number }>;
  setAudio(value: { muted: boolean; volume: number }): Promise<void>;
  getCompactPrefs(): Promise<CompactPrefs>;
  setCompactPrefs(value: CompactPrefs): Promise<void>;
  close(): void;
}
type Tab = 'party' | 'stash' | 'recruit' | 'upgrades' | 'settings';
const esc = (value: string): string => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
const fmt = (value: number): string => Math.round(value).toLocaleString();
const heroName = (id: string): string => heroConfig(id).name
  .replace(/\s*\([^)]*\)/g, '')
  .replace(/\s*(?:\||[-–])\s*(?:asset|pack|sprite|sheet)\b.*$/ig, '').trim();
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

/** Persistent DOM shell; polling updates values and only replaces tab contents when data or selection changes. */
export class ManagementView {
  private tab: Tab = 'party';
  private snapshotValue: ManagementSnapshot | null = null;
  private selectedHero = '';
  private selectedGear = '';
  private selectedPartySlot: 0 | 1 | 2 = 0;
  private slotFilter = 'all';
  private rarityFilter = 'all';
  private ownerFilter = 'all';
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
  private audioValue = { muted: false, volume: 0.5 };
  private compactPrefs: CompactPrefs | null = null;
  private pendingRebuild = false;
  private readonly header: HTMLElement;
  private readonly nav: HTMLElement;
  private readonly status: HTMLElement;
  private readonly main: HTMLElement;
  private readonly abort = new AbortController();
  constructor(private readonly root: HTMLElement, private readonly client: ManagementClient, private readonly onClose: () => void) {
    this.root.innerHTML = '<header class="management-header"><div><strong>Management</strong><span data-wallet></span></div><button data-close aria-label="Close management">×</button></header><nav aria-label="Management tabs"></nav><div class="management-status" role="status" aria-live="polite"></div><main></main>';
    this.header = this.root.querySelector('.management-header')!; this.nav = this.root.querySelector('nav')!;
    this.status = this.root.querySelector('.management-status')!; this.main = this.root.querySelector('main')!;
    const tabs: Tab[] = ['party', 'stash', 'recruit', 'upgrades', 'settings'];
    this.nav.innerHTML = tabs.map(tab => `<button data-tab="${tab}" aria-pressed="false">${tab[0]!.toUpperCase()}${tab.slice(1)}</button>`).join('');
    this.nav.addEventListener('click', event => { if (this.closed) return; const target = event.target; if (!(target instanceof HTMLButtonElement) || !target.dataset.tab) return; this.tab = target.dataset.tab as Tab; this.contentKey = ''; this.renderContent(); this.renderNav(); }, { signal: this.abort.signal });
    this.header.querySelector('[data-close]')?.addEventListener('click', () => this.close(), { signal: this.abort.signal });
    this.root.addEventListener('click', event => this.onClick(event), { signal: this.abort.signal });
    this.root.addEventListener('change', event => this.onChange(event), { signal: this.abort.signal });
    this.root.addEventListener('focusout', () => queueMicrotask(() => { if (!this.closed && this.pendingRebuild && !this.hasActiveFormControl()) { this.pendingRebuild = false; this.contentKey = ''; this.renderContent(); } }), { signal: this.abort.signal });
    this.root.addEventListener('keydown', event => { if (!this.closed && event.key === 'Escape' && !this.hasActiveFormControl()) { event.preventDefault(); event.stopPropagation(); this.close(); } }, { signal: this.abort.signal });
  }
  async open(): Promise<void> {
    if (!this.closed) return;
    this.closed = false; const generation = ++this.generation; this.clientId = crypto.randomUUID(); this.sequence = 0; this.root.hidden = false;
    try { [this.audioValue, this.compactPrefs] = await Promise.all([this.client.getAudio(), this.client.getCompactPrefs()]); } catch { /* window settings remain available from the main view */ }
    if (!this.isLive(generation)) return;
    await this.refresh(generation);
    if (!this.isLive(generation)) return;
    this.timer = window.setInterval(() => { if (this.isLive(generation)) void this.refresh(generation); }, 200);
    this.nav.querySelector<HTMLButtonElement>('[data-tab]')?.focus();
  }
  close(): void {
    this.generation += 1; window.clearInterval(this.timer); this.timer = 0;
    if (this.closed) return;
    this.closed = true; this.client.close(); this.onClose();
  }
  dispose(): void { this.close(); this.generation += 1; this.abort.abort(); this.root.replaceChildren(); }
  private isLive(generation: number): boolean { return !this.closed && this.generation === generation; }
  private hasActiveFormControl(): boolean {
    const active = document.activeElement;
    return active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement;
  }
  private isNewer(next: ManagementSnapshot, current: ManagementSnapshot | null): boolean {
    return current === null || next.revision > current.revision || next.revision === current.revision && next.tick >= current.tick;
  }
  private async refresh(generation = this.generation): Promise<void> {
    if (!this.isLive(generation)) return;
    try {
      const fresh = await this.client.snapshot(); if (!this.isLive(generation) || !this.isNewer(fresh, this.snapshotValue)) return;
      const prior = this.snapshotValue; this.snapshotValue = fresh; this.renderHeader(); this.renderNav();
      if (!prior || this.contentSignature(prior) !== this.contentSignature(fresh)) {
        if (this.hasActiveFormControl()) this.pendingRebuild = true;
        else this.renderContent();
      }
    } catch (error) { if (this.isLive(generation)) { this.message = `Management could not refresh: ${String(error)}`; this.renderStatus(); } }
  }
  private contentSignature(value: ManagementSnapshot): string {
    const content = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'revision' && key !== 'tick')); return JSON.stringify(content);
  }
  private renderHeader(): void {
    const state = this.snapshotValue; if (!state) return;
    const wallet = this.header.querySelector<HTMLElement>('[data-wallet]');
    if (wallet) wallet.textContent = `${fmt(state.gold)} gold · ${state.tickets} tickets`;
  }
  private renderNav(): void {
    for (const button of this.nav.querySelectorAll<HTMLButtonElement>('[data-tab]')) button.setAttribute('aria-pressed', String(button.dataset.tab === this.tab));
  }
  private renderStatus(): void { this.status.textContent = this.message; }
  private async settingRequest(operation: Promise<unknown>): Promise<void> {
    const generation = this.generation;
    try { await operation; }
    catch (error) { if (this.isLive(generation)) { this.message = `Setting could not be saved: ${String(error)}`; this.renderStatus(); } }
  }
  private async command(action: Action | { type: 'pullMany'; count: 1 | 10 }): Promise<void> {
    const generation = this.generation, current = this.snapshotValue; if (!current || !this.isLive(generation)) return;
    try {
      const reply = await this.client.execute(action, current.revision, `${this.clientId}:${++this.sequence}`);
      if (!this.isLive(generation)) return;
      if (this.isNewer(reply.snapshot, this.snapshotValue)) this.snapshotValue = reply.snapshot;
      else await this.refresh(generation);
      if (!this.isLive(generation)) return;
      this.message = reply.accepted ? 'Updated.' : reply.reason ?? 'Action rejected. State refreshed.';
      this.renderHeader(); this.renderNav(); this.contentKey = ''; this.renderContent(); this.renderStatus();
    } catch (error) { if (this.isLive(generation)) { this.message = `Action was not applied: ${String(error)}`; await this.refresh(generation); if (this.isLive(generation)) this.renderStatus(); } }
  }
  private onClick(event: Event): void {
    if (this.closed) return;
    const target = event.target; if (!(target instanceof HTMLElement)) return;
    const button = target.closest<HTMLButtonElement>('button'); if (!button || !this.snapshotValue) return;
    const action = button.dataset.action, state = this.snapshotValue;
    if (button.dataset.hero) { this.selectedHero = button.dataset.hero; this.contentKey = ''; this.renderContent(); return; }
    if (button.dataset.partySlot !== undefined) { const index = Number(button.dataset.partySlot); this.selectedPartySlot = index === 1 || index === 2 ? index : 0; this.contentKey = ''; this.renderContent(); return; }
    if (button.dataset.assign) { const ids = [...state.partyIds]; ids[this.selectedPartySlot] = button.dataset.assign; if (ids.every(Boolean) && new Set(ids).size === 3) void this.command({ type: 'party', heroIds: ids }); else { this.message = 'Each formation slot needs a different owned hero.'; this.renderStatus(); } return; }
    if (button.dataset.lockHero) { void this.command({ type: 'lockHero', heroId: button.dataset.lockHero, locked: button.dataset.locked !== 'true' }); return; }
    if (button.dataset.gear) { this.selectedGear = button.dataset.gear; this.compareKey = ''; this.comparison = null; this.contentKey = ''; this.renderContent(); return; }
    if (action === 'pull-one') void this.command({ type: 'pullMany', count: 1 });
    else if (action === 'pull-ten') void this.command({ type: 'pullMany', count: 10 });
    else if (action === 'auto-party') void this.command({ type: 'autoParty', preset: state.partyPreset ?? 'balanced' });
    else if (action === 'auto-equip') void this.command({ type: 'autoEquip' });
    else if (action === 'choose-0' || action === 'choose-1') void this.command({ type: 'chooseChest', keep: action === 'choose-0' ? 0 : 1 });
    else if (action === 'retry') void this.command({ type: 'retry' });
    else if (action === 'upgrade' && this.selectedGear) void this.command({ type: 'upgrade', gearId: this.selectedGear as GameState['inventory'][number]['id'] });
    else if (action === 'equip' && this.selectedGear && this.selectedHero) void this.command({ type: 'equip', heroId: this.selectedHero, gearId: this.selectedGear as GameState['inventory'][number]['id'] });
    else if (action === 'pause') { const generation = this.generation; void this.settingRequest(this.client.pause(!state.paused).then(() => this.refresh(generation))); }
    else if (action === 'mute') { this.audioValue = { ...this.audioValue, muted: !this.audioValue.muted }; void this.settingRequest(this.client.setAudio(this.audioValue)); this.contentKey = ''; this.renderContent(); }
    else if (action === 'volume') { /* range inputs are handled in onChange */ }
    else if (button.dataset.zoom && this.compactPrefs) { this.compactPrefs = { ...this.compactPrefs, zoom: button.dataset.zoom === '2' ? 2 : 1 }; void this.settingRequest(this.client.setCompactPrefs(this.compactPrefs)); this.contentKey = ''; this.renderContent(); }
    else if (action === 'reset-size' && this.compactPrefs) { this.compactPrefs = { ...this.compactPrefs, sourceWidth: 640, sourceHeight: 160 }; void this.settingRequest(this.client.setCompactPrefs(this.compactPrefs)); this.contentKey = ''; this.renderContent(); }
  }
  private onChange(event: Event): void {
    if (this.closed) return;
    const target = event.target; if (!(target instanceof HTMLSelectElement || target instanceof HTMLInputElement)) return;
    if (target.dataset.filter === 'slot') this.slotFilter = target.value;
    else if (target.dataset.filter === 'rarity') this.rarityFilter = target.value;
    else if (target.dataset.filter === 'owner') this.ownerFilter = target.value;
    else if (target.dataset.select === 'hero') this.selectedHero = target.value;
    else if (target.dataset.setting === 'party-preset') { void this.command({ type: 'autoParty', preset: target.value as 'balanced' | 'fastFarm' | 'bossSustain' }); return; }
    else if (target.dataset.action === 'volume' && target instanceof HTMLInputElement) { this.audioValue = { ...this.audioValue, volume: Number(target.value) }; void this.settingRequest(this.client.setAudio(this.audioValue)); return; }
    else if (target.dataset.setting === 'placement' && this.compactPrefs) { this.compactPrefs = { ...this.compactPrefs, placement: target.value as 'free' | 'snapped', ...(target.value === 'snapped' ? { snapEdge: 'bottom' as const } : {}) }; if (target.value === 'free') delete this.compactPrefs.snapEdge; void this.settingRequest(this.client.setCompactPrefs(this.compactPrefs)); }
    this.contentKey = ''; this.renderContent();
  }
  private renderContent(): void {
    const state = this.snapshotValue; if (!state || this.closed) return;
    const signature = `${this.tab}:${this.contentSignature(state)}:${this.selectedHero}:${this.selectedGear}:${this.selectedPartySlot}:${this.slotFilter}:${this.rarityFilter}:${this.ownerFilter}:${this.audioValue.muted}:${this.audioValue.volume}:${!!this.comparison}`;
    if (signature === this.contentKey) return;
    const scrollTop = this.main.scrollTop; this.contentKey = signature;
    switch (this.tab) {
      case 'party': this.main.innerHTML = this.party(state); break;
      case 'stash': this.main.innerHTML = this.stash(state); break;
      case 'recruit': this.main.innerHTML = this.recruit(state); break;
      case 'upgrades': this.main.innerHTML = this.upgrades(state); break;
      case 'settings': this.main.innerHTML = this.settings(state); break;
    }
    this.main.scrollTop = scrollTop; this.renderStatus();
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
  private party(state: ManagementSnapshot): string {
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
    const cycle = stats ? realizedBasicCycleTicks(stats) : 6;
    const basicDps = stats && selected ? partyBasicDpsForStats(selected.id, stats) : 0;
    const activeText = selectedDef ? activeDescription(selectedDef.id) : '';
    const passiveText = selectedDef ? passiveDescription(selectedDef.id) : '';
    return `<h2>Party</h2><p>Choose three distinct owned heroes for formation. Presets preserve deployed locks.</p><label>Preset<select data-setting="party-preset"><option value="balanced" ${preset === 'balanced' ? 'selected' : ''}>Balanced</option><option value="fastFarm" ${preset === 'fastFarm' ? 'selected' : ''}>Fast farm</option><option value="bossSustain" ${preset === 'bossSustain' ? 'selected' : ''}>Boss sustain</option></select></label><button data-action="auto-party">Apply preset</button><button data-action="auto-equip">Auto-equip</button><p>${coverage.length ? `Recommended coverage missing: ${coverage.map(esc).join(', ')}.` : 'Recommended role coverage is present.'}</p><div class="formation">${state.partyIds.map((id, index) => `<button data-party-slot="${index}" aria-pressed="${this.selectedPartySlot === index}">Slot ${index + 1}: ${esc(heroName(id))}${state.roster.find(hero => hero.id === id)?.partyLocked ? ' · locked' : ''}</button>`).join('')}</div>
      <h3>Owned roster</h3><div class="management-cards">${state.roster.map(hero => `<article><button data-hero="${esc(hero.id)}" aria-pressed="${hero.id === selected?.id}">${esc(heroName(hero.id))} · Lv ${hero.level} · ★${hero.stars}</button><button data-assign="${esc(hero.id)}" aria-label="Assign ${esc(heroName(hero.id))} to slot ${this.selectedPartySlot + 1}">Assign slot ${this.selectedPartySlot + 1}</button><button data-lock-hero="${esc(hero.id)}" data-locked="${hero.partyLocked === true}" aria-pressed="${hero.partyLocked === true}">${hero.partyLocked ? 'Unlock preset slot' : 'Lock preset slot'}</button></article>`).join('')}</div>
      ${selected ? `<section class="selection"><h3>${esc(heroName(selected.id))}</h3><p>Level ${selected.level}, ${selected.xp} XP, ${selected.stars} stars · ${selectedDef?.role}</p><p>HP ${fmt(stats?.maxHp ?? 0)} · ATK ${fmt(stats?.atk ?? 0)} · DEF ${fmt(stats?.def ?? 0)} · basic ${basicDps.toFixed(1)} DPS · realized cycle ${cycle} ticks</p><p>Active: ${esc(activeText)}. Passive: ${esc(passiveText)}.</p><p>Strength: ${esc(selectedDef?.strength ?? '')}. Weakness: ${esc(selectedDef?.weakness ?? '')}.</p><small>Combat uses equipment and party changes at the next encounter boundary.</small></section>` : ''}`;
  }
  private stash(state: ManagementSnapshot): string {
    const item = state.inventory.find(value => value.id === this.selectedGear), choices = state.pendingChoice ?? [];
    const compareOwners = state.roster.map(hero => `<option value="${esc(hero.id)}" ${this.selectedHero === hero.id ? 'selected' : ''}>${esc(heroName(hero.id))}</option>`).join('');
    const filterOwners = `<option value="all" ${this.ownerFilter === 'all' ? 'selected' : ''}>All stash</option>${state.roster.map(hero => `<option value="${esc(hero.id)}" ${this.ownerFilter === hero.id ? 'selected' : ''}>${esc(heroName(hero.id))}</option>`).join('')}`;
    const visible = state.inventory.filter(gear => (this.slotFilter === 'all' || gear.slot === this.slotFilter) && (this.rarityFilter === 'all' || gear.rarity === this.rarityFilter)
      && (this.ownerFilter === 'all' || state.roster.find(hero => hero.id === this.ownerFilter)?.equipment[gear.slot] === gear.id));
    const owner = item ? state.roster.find(hero => Object.values(hero.equipment).includes(item.id)) : undefined;
    const comparison = this.comparison, mult = item ? 1 + CONFIG.gear.upgrade.mainPerLevel * item.level : 1;
    return `<h2>Stash</h2><div class="filters"><label>Slot<select data-filter="slot">${['all', 'weapon', 'armor', 'charm'].map(v => `<option ${this.slotFilter === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>Rarity<select data-filter="rarity">${['all', ...CONFIG.rarity.order].map(v => `<option ${this.rarityFilter === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>Owner<select data-filter="owner">${filterOwners}</select></label></div>
      <div class="management-cards">${visible.map(gear => `<button data-gear="${gear.id}" aria-pressed="${this.selectedGear === gear.id}">${gear.rarity} ${gear.slot} · Lv ${gear.level} · drop stage ${gear.dropStage}</button>`).join('') || '<p>No matching gear.</p>'}</div>
      ${item ? `<section class="selection"><h3>Selected ${item.rarity} ${item.slot}</h3><p>Owned by ${owner ? esc(heroName(owner.id)) : 'stash'} · upgrade level ${item.level}</p><p>Effective gear stats: HP ${fmt(item.stats.hp * mult)} · ATK ${fmt(item.stats.atk * mult)} · DEF ${fmt(item.stats.def * mult)} · HP% ${fmt(item.stats.hpPct * mult * 100)} · ATK% ${fmt(item.stats.atkPct * mult * 100)} · speed ${fmt(item.stats.speedPct * mult * 100)}%</p><label>Compare/equip to<select data-select="hero">${compareOwners}</select></label>${comparison ? `<p>Hero before → after: HP ${comparison.before.maxHp} → ${comparison.after.maxHp} (${comparison.delta.maxHp >= 0 ? '+' : ''}${comparison.delta.maxHp}); ATK ${comparison.before.atk} → ${comparison.after.atk} (${comparison.delta.atk >= 0 ? '+' : ''}${comparison.delta.atk}); DEF ${comparison.before.def} → ${comparison.after.def} (${comparison.delta.def >= 0 ? '+' : ''}${comparison.delta.def}); interval ${comparison.before.attackTicks} → ${comparison.after.attackTicks} ticks; basic DPS ${comparison.delta.basicDps >= 0 ? '+' : ''}${comparison.delta.basicDps.toFixed(2)}. Party utility gain ${comparison.partyUtilityGain >= 0 ? '+' : ''}${comparison.partyUtilityGain.toFixed(3)}${comparison.partyUtilityGain > 0 ? ' · positive role-weighted recommendation' : ' · no positive party-wide recommendation'}.</p>` : '<p role="status">Calculating comparison…</p>'}<button data-action="equip">Equip</button><button data-action="upgrade" ${state.gold < upgradeCost(item) || item.level >= CONFIG.gear.upgrade.maxLevel ? 'disabled' : ''}>Upgrade · ${upgradeCost(item)} gold</button></section>` : ''}
      ${choices.length ? `<section class="selection"><h3>Pending chest choices (${choices.length})</h3>${choices.map((pair, index) => `<article>Choice ${index + 1}: ${pair.map(gear => `${gear.rarity} ${gear.slot}`).join(' vs ')} ${index === 0 ? '<button data-action="choose-0">Keep first</button><button data-action="choose-1">Keep second</button>' : ''}</article>`).join('')}</section>` : ''}`;
  }
  private recruit(state: ManagementSnapshot): string {
    return `<h2>Recruit</h2><p>Tickets: ${state.tickets} · cost ${state.recruit.cost} per pull. Rarity odds: ${Object.entries(state.recruit.rates).map(([rarity, odds]) => `${rarity} ${(odds * 100).toFixed(2)}%`).join(' · ')}</p><p>Epic+ guaranteed in ${state.recruit.epicPlusRemaining} pulls${state.recruit.legendaryRemaining === null ? '' : ` · Legendary in ${state.recruit.legendaryRemaining}`}${state.recruit.newHeroRemaining === null ? '' : ` · New hero in ${state.recruit.newHeroRemaining}`}</p><button data-action="pull-one" ${state.tickets < state.recruit.cost ? 'disabled' : ''}>Recruit ×1</button><button data-action="pull-ten" ${state.tickets < state.recruit.cost * 10 ? 'disabled' : ''}>Recruit ×10</button><h3>Recent results</h3><ol>${[...state.recentPulls].reverse().map(result => `<li>${esc(heroName(result.heroId))} · ${result.rarity}${result.duplicate ? ' · duplicate' : ' · new'}${result.pity ? ` · pity ${result.pity}` : ''}</li>`).join('') || '<li>No pulls yet.</li>'}</ol><p>${state.stats.pulls} total pulls · ${state.roster.length}/${CONFIG.heroes.length} heroes owned.</p>`;
  }
  private upgrades(state: ManagementSnapshot): string {
    const equipped = state.inventory.filter(item => state.roster.some(hero => Object.values(hero.equipment).includes(item.id)));
    const selected = state.inventory.find(item => item.id === this.selectedGear);
    return `<h2>Upgrades</h2><p>Gold: ${fmt(state.gold)}. Select an equipped item to upgrade it using the current progression cost.</p><div class="management-cards">${equipped.map(item => `<button data-gear="${item.id}" aria-pressed="${this.selectedGear === item.id}">${item.rarity} ${item.slot} · Lv ${item.level} · ${upgradeCost(item)} gold</button>`).join('') || '<p>No equipped items.</p>'}</div>${selected ? `<button data-action="upgrade" ${state.gold < upgradeCost(selected) || selected.level >= CONFIG.gear.upgrade.maxLevel ? 'disabled' : ''}>Upgrade ${selected.slot} · ${upgradeCost(selected)} gold</button>` : ''}`;
  }
  private settings(state: ManagementSnapshot): string {
    return `<h2>Settings</h2><button data-action="pause">${state.paused ? 'Resume' : 'Pause'} simulation</button><button data-action="mute">${this.audioValue.muted ? 'Unmute' : 'Mute'} audio</button><label>Volume<input data-action="volume" type="range" min="0" max="1" step="0.05" value="${this.audioValue.volume}"></label><p>Viewport zoom and placement</p><div class="formation"><button data-zoom="1" aria-pressed="${this.compactPrefs?.zoom === 1}">1×</button><button data-zoom="2" aria-pressed="${this.compactPrefs?.zoom === 2}">2×</button><label>Placement<select data-setting="placement"><option value="free" ${this.compactPrefs?.placement === 'free' ? 'selected' : ''}>Free</option><option value="snapped" ${this.compactPrefs?.placement === 'snapped' ? 'selected' : ''}>Snap to bottom</option></select></label><button data-action="reset-size">Reset size</button></div><p>Party v2 preview uses a separate save key; the legacy account stays untouched.</p><p>${state.progress.kind === 'BOSS_READY' ? `Boss ${state.progress.bossStage} is ready. Starting it requires an explicit action.` : state.progress.kind === 'FARMING' ? 'The next push starts automatically when its timer or retry condition is met.' : 'Campaign is active.'}</p>${state.progress.kind === 'BOSS_READY' || state.progress.kind === 'FARMING' ? '<button data-action="retry">Start / retry encounter</button>' : ''}<p>If a save cannot be loaded, use the game window recovery panel to export it or discard it.</p>`;
  }
}


