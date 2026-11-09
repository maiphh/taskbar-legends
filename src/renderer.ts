import { CONFIG, enemyKindSchema, heroConfig, ticksForSeconds } from './config';
import { AtlasLibrary } from './atlas';
import type { AnimationName } from './atlas';
import { PixelUI } from './pixel-ui';
import type { GameEvent, GameState, Unit } from './core/model';
export interface HitRegion { kind: 'hud' | 'panel'; id: string; x: number; y: number; width: number; height: number }
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private width = CONFIG.view.defaultWidth;
  private dpr = 1;
  private resizes = 0;
  readonly atlases = new AtlasLibrary();
  readonly ui: PixelUI;
  constructor(private readonly canvas: HTMLCanvasElement, controls: HTMLElement) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.ctx = ctx; this.ui = new PixelUI(this.atlases, controls);
  }
  getHitRegions(): HitRegion[] { return this.ui.sourceRegions().map(rect => ({ ...rect, x: rect.x / this.dpr, y: rect.y / this.dpr, width: rect.width / this.dpr, height: rect.height / this.dpr })); }
  getLayout() {
    const height = this.ui.height();
    return { width: this.width, height, coreY: height - CONFIG.ui.closed.coreHeight, baselineY: height - CONFIG.ui.closed.coreHeight + CONFIG.ui.closed.baselineCoreLocalY,
      cssHeight: height / this.dpr, dpr: this.dpr, resizeCount: this.resizes, sourceHitRegions: this.ui.sourceRegions(), ui: this.ui.stateForDebug() };
  }
  resize(cssWidth: number): void {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(CONFIG.view.minWidth, Math.floor(cssWidth * dpr));
    const height = this.ui.height();
    if (this.canvas.width !== width || this.canvas.height !== height || this.dpr !== dpr) {
      this.width = width; this.dpr = dpr; this.canvas.width = width; this.canvas.height = height; this.resizes += 1;
      this.canvas.style.width = `${width / dpr}px`; this.canvas.style.height = `${height / dpr}px`;
      if (this.canvas.parentElement) this.canvas.parentElement.style.height = `${height / dpr}px`;
      // Native-pixel q=1 mode: backing dimensions are physical, CSS dimensions divide by DPR.
      this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.imageSmoothingEnabled = false;
    }
  }
  private field() { const compact = this.width < 1000; return { x: compact ? 216 : 304, width: Math.max(0, this.width - (compact ? 432 : 608)) }; }
  private position(unit: Unit, state: GameState): number {
    const field = this.field(), compact = field.width < 300;
    if (unit.side === 'hero') return Math.round(field.x + field.width * (compact ? [0.60, 0.38, 0.16][unit.slot] ?? 0.16 : [0.46, 0.39, 0.32][unit.slot] ?? 0.32));
    const front = state.party.find(hero => hero.hp > 0);
    const rangeX = (front?.x ?? CONFIG.sim.heroSlotX[0] ?? 140) + unit.range;
    const approach = Math.max(0, unit.x - rangeX) / CONFIG.sim.enemySpawnX;
    return Math.round(field.x + field.width * ((compact ? 0.75 + unit.slot * 0.2 : 0.54 + unit.slot * 0.07) + (compact ? 0 : approach * 0.35)));
  }
  private latest(state: GameState, predicate: (event: GameEvent) => boolean): GameEvent | undefined {
    for (let i = state.events.length - 1; i >= 0; i -= 1) { const event = state.events[i]; if (event && predicate(event)) return event; }
    return undefined;
  }
  private animation(state: GameState, unit: Unit, key: string | undefined): { name: AnimationName; ageMs: number } {
    const age = (event: GameEvent | undefined): number => event ? (state.tick - event.tick) * 1000 / CONFIG.sim.ticksPerSecond : Infinity;
    const dead = this.latest(state, event => event.data.type === 'death' && event.data.unitId === unit.id);
    if (unit.hp <= 0) return { name: 'death', ageMs: Number.isFinite(age(dead)) ? age(dead) : 0 };
    const hurt = this.latest(state, event => event.data.type === 'hit' && event.data.targetId === unit.id);
    if (age(hurt) < (key ? this.atlases.durationMs(key, 'hit') ?? CONFIG.view.hurtFallbackMs : CONFIG.view.hurtFallbackMs)) return { name: 'hit', ageMs: age(hurt) };
    const attack = this.latest(state, event => ((event.data.type === 'hit' && event.data.attackerId === unit.id) || (event.data.type === 'heal' && event.data.sourceId === unit.id)) || (event.data.type === 'skill' && event.data.unitId === unit.id));
    if (age(attack) < (key ? this.atlases.durationMs(key, 'attack') ?? CONFIG.view.attackFallbackMs : CONFIG.view.attackFallbackMs)) return { name: 'attack', ageMs: age(attack) };
    const front = state.party.find(hero => hero.hp > 0);
    const moving = unit.side === 'enemy' && front && unit.x - front.x > unit.range;
    return { name: moving ? 'run' : 'idle', ageMs: (state.tick - unit.bornTick) * 1000 / CONFIG.sim.ticksPerSecond };
  }
  render(state: GameState, paused = false): void {
    const ctx = this.ctx, view = CONFIG.view, palette = CONFIG.ui.palette, height = this.ui.height();
    const coreY = height - CONFIG.ui.closed.coreHeight, baselineY = coreY + CONFIG.ui.closed.baselineCoreLocalY;
    ctx.clearRect(0, 0, this.width, height);
    ctx.fillStyle = palette.base; ctx.fillRect(0, coreY, this.width, CONFIG.ui.closed.coreHeight);
    ctx.fillStyle = palette.edge; ctx.fillRect(0, coreY, this.width, 1);
    const field = this.field();
    ctx.save(); ctx.beginPath(); ctx.rect(field.x, 0, field.width, height); ctx.clip();
    ctx.fillStyle = '#293c35'; ctx.fillRect(field.x, coreY + 48, field.width, 32);
    ctx.fillStyle = '#3f5542'; ctx.fillRect(field.x, coreY + 48, field.width, 2);
    for (let x = field.x + 5; x < field.x + field.width; x += 28) { ctx.fillStyle = x % 3 ? '#52664a' : '#223d32'; ctx.fillRect(x, coreY + 51, 2, 2); ctx.fillRect(x + 12, coreY + 65, 3, 1); }
    const enemies = field.width < 300 ? state.enemies.slice(0, 2) : state.enemies;
    const units = [...state.party, ...enemies].sort((a, b) => this.position(a, state) - this.position(b, state));
    for (const unit of units) {
      const x = this.position(unit, state);
      const color = unit.side === 'hero' ? view.roleColors[heroConfig(unit.sourceId).role] : view.enemyColors[enemyKindSchema.parse(unit.sourceId)];
      const key = unit.side === 'hero' ? Object.entries(view.heroAssets).find(([id]) => id === unit.sourceId)?.[1] : view.enemyAssets[enemyKindSchema.parse(unit.sourceId)];
      const anim = this.animation(state, unit, key);
      const lastHit = this.latest(state, event => event.data.type === 'hit' && event.data.targetId === unit.id);
      const flash = lastHit !== undefined && (state.tick - lastHit.tick) * 1000 / CONFIG.sim.ticksPerSecond < view.hitFlashMs;
      if (!key || !this.atlases.draw(ctx, key, anim.name, anim.ageMs, x, baselineY, unit.side === 'enemy', 1, flash)) {
        ctx.fillStyle = unit.hp <= 0 ? '#52616b' : color; ctx.fillRect(x - view.heroWidth / 2, baselineY - view.heroHeight, view.heroWidth, view.heroHeight);
      }
      if (unit.hp <= 0) continue;
      const hpWidth = unit.side === 'hero' ? 34 : 32, hpY = coreY + CONFIG.ui.unitHpBars.coreLocalY;
      ctx.fillStyle = palette.ink; ctx.fillRect(x - hpWidth / 2, hpY, hpWidth, CONFIG.ui.unitHpBars.height);
      ctx.fillStyle = '#29362e'; ctx.fillRect(x - hpWidth / 2 + 1, hpY + 1, hpWidth - 2, CONFIG.ui.unitHpBars.height - 2);
      ctx.fillStyle = unit.side === 'hero' ? palette.green : palette.red; ctx.fillRect(x - hpWidth / 2 + 1, hpY + 1, Math.round((hpWidth - 2) * unit.hp / unit.maxHp), CONFIG.ui.unitHpBars.height - 2);
      if (unit.shield > 0) { ctx.strokeStyle = palette.blue; ctx.strokeRect(x - 17.5, baselineY - 49.5, 35, 50); }
    }
    const lifetime = ticksForSeconds(CONFIG.runtime.damageLabelSeconds), bucket = ticksForSeconds(CONFIG.runtime.damageCoalesceSeconds);
    const groups = new Map<string, { targetId: string; tick: number; amount: number; heal: boolean }>();
    for (const event of state.events) {
      const data = event.data;
      if (state.tick - event.tick > lifetime || (data.type !== 'hit' && data.type !== 'heal')) continue;
      const key = `${data.targetId}:${data.type}:${Math.floor(event.tick / bucket)}`, old = groups.get(key);
      const amount = data.type === 'hit' ? data.damage : data.amount;
      if (old) old.amount += amount; else groups.set(key, { targetId: data.targetId, tick: event.tick, amount, heal: data.type === 'heal' });
    }
    const counts = new Map<string, number>();
    for (const group of [...groups.values()].sort((a, b) => b.tick - a.tick)) {
      const count = counts.get(group.targetId) ?? 0; if (count >= CONFIG.runtime.damageLabelMaxPerTarget) continue;
      counts.set(group.targetId, count + 1);
      const unit = units.find(unit => unit.id === group.targetId); if (!unit) continue;
      const age = state.tick - group.tick, x = this.position(unit, state) - 10 + count * 6;
      const y = Math.max(8, baselineY - 64 - Math.round(CONFIG.runtime.damageRisePx * age / lifetime) - count * 10);
      const label = `${group.heal ? '+' : '-'}${group.amount}`;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) this.ui.text(ctx, label, x + (dx ?? 0), y + (dy ?? 0), palette.ink, 16, true);
      this.ui.text(ctx, label, x, y, group.heal ? palette.green : palette.gold, 16, true);
    }
    if (state.enemies.length > enemies.length) this.ui.text(ctx, `+${state.enemies.length - enemies.length}`, field.x + field.width - 32, coreY + 3, palette.muted, 16);
    ctx.restore();
    this.ui.draw(ctx, state, this.width, coreY, paused, 1 / this.dpr);
  }
}
