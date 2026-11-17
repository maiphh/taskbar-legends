import { CONFIG, TICK_MS, heroConfig, stageConfig, ticksForSeconds } from './config';
import { AtlasLibrary } from './atlas';
import type { AnimationName } from './atlas';
import { PixelUI, roundHalfEven } from './pixel-ui';
import { BODY } from './font';
import { bannerFrame, popupFrame } from './motion';
import { itemId } from './core/model';
import type { GameEvent, GameState, Unit } from './core/model';
import { stageCue, upgradePopups } from './core/selectors';
import { combatEventAge, enemyFormationX, presentationCombatTime } from './core/party-combat';
import { activePartyEffects } from './core/party-effects';
import { getPartyEnemyDefinition } from './core/party-enemies';
import { formationScreenX } from './core/turn/formation-view';
import { actionBoundaries, sampleActionPresentation } from './core/turn/animation-timing';
import { easeReturn } from './core/turn/presentation';
import { gaugeRatio } from './core/turn/action-bar';
import { stepCombatCamera, type CombatCameraInput } from './party-camera';
import { compactLaneLayout } from './compact-lane-layout';
import { LegendaryEffects } from './legendary-effects';
import { consumeNewEvents, triggerLegendaryEvent } from './legendary-events';
export interface HitRegion { kind: 'hud' | 'panel'; id: string; x: number; y: number; width: number; height: number }
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private width = CONFIG.view.defaultWidth;
  private dpr = 1;
  private compact = false;
  private zoom = 1;
  private resizes = 0;
  private cameraTranslation = 0;
  private frameCamera: number | null = null;
  private rendering = false;
  readonly atlases = new AtlasLibrary();
  readonly ui: PixelUI;
  readonly legendaryEffects = new LegendaryEffects();
  private effectEventSeq = 0;
  private effectEventsInitialized = false;
  baselineLegendaryEvents(seq: number): void { this.effectEventSeq = seq; this.effectEventsInitialized = true; this.legendaryEffects.clear(); }
  private holySheet: HTMLImageElement | null = null;
  private treasureSheet: HTMLImageElement | null = null;
  private dropBurstSheet: HTMLImageElement | null = null;
  constructor(private readonly canvas: HTMLCanvasElement, controls: HTMLElement) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.ctx = ctx; this.ui = new PixelUI(this.atlases, controls);
    this.holySheet = this.loadVfx('holy-smite'); this.treasureSheet = this.loadVfx('treasure-glint'); this.dropBurstSheet = this.loadVfx('cs5475-explosion-gold-48');
  }
  private loadVfx(name: string): HTMLImageElement { const image = new Image(); image.src = new URL(`${import.meta.env.BASE_URL}assets/vfx/${name.startsWith('cs5475-') ? name : `pvfx-${name}`}/sprites.png`, window.location.href).href; image.onerror = () => { image.dataset.unavailable = 'true'; }; return image; }
  /** Debug capture uses the same caster resolver as retained combat events without touching sim state. */
  debugLegendaryShowcase(kind: 'skill' | 'drop', state: GameState): void {
    const event: GameEvent = kind === 'skill'
      ? { seq: state.eventSeq, tick: state.tick, data: { type: 'skill', unitId: 'hero-mh3', skill: 'heavy-single-burst' } }
      : { seq: state.eventSeq, tick: state.tick, data: { type: 'gear', gearId: itemId(state.seed, 0), slot: 'weapon', rarity: 'legendary' } };
    const caster = state.party[0] ? { ...state.party[0], id: 'hero-mh3', sourceId: 'mh3', side: 'hero' as const } : undefined;
    triggerLegendaryEvent(event, caster ? [caster] : state.party, state.enemies, (effectKind, label) => this.legendaryEffects.trigger(effectKind, performance.now(), label));
  }
  getHitRegions(): HitRegion[] {
    const origin = this.canvas.getBoundingClientRect();
    return this.ui.sourceRegions().map(rect => ({ ...rect, x: origin.left + rect.x * this.zoom / this.dpr, y: origin.top + rect.y * this.zoom / this.dpr, width: rect.width * this.zoom / this.dpr, height: rect.height * this.zoom / this.dpr }));
  }
  getLayout() {
    const height = this.ui.height();
    return { width: this.width, height, coreY: height - CONFIG.ui.closed.coreHeight, baselineY: height - CONFIG.ui.closed.coreHeight + CONFIG.ui.closed.baselineCoreLocalY,
      cssHeight: height * this.zoom / this.dpr, dpr: this.dpr, zoom: this.zoom, compact: this.compact, resizeCount: this.resizes, sourceHitRegions: this.ui.sourceRegions(), ui: this.ui.stateForDebug() };
  }
  getCombatProjection(state: GameState) {
    if (!this.rendering) this.frameCamera = null;
    const field = this.field(), cameraLeft = this.cameraLeft(state, field);
    const sx = (worldX: number) => Math.round(field.x + worldX - cameraLeft), baselineY = this.ui.height() - CONFIG.ui.closed.coreHeight + CONFIG.ui.closed.baselineCoreLocalY;
    const allUnits = [...state.party, ...state.enemies];
    const statusNames: Record<string, string> = { 'party-atk-buff': 'ATK up', 'enemy-atk-weaken': 'ATK down', 'enemy-def-weaken': 'DEF down', 'healing-guard': 'Damage guard', 'party-guard-aura': 'Damage guard', 'bruiser-guard': 'Damage guard' };
    const statusRows = new Map<string, number>();
    const statusCues = allUnits.filter(unit => unit.hp > 0).flatMap(unit => activePartyEffects(state, unit.id).flatMap(effect => {
      const label = statusNames[effect.group]; if (!label) return [];
      const row = statusRows.get(unit.id) ?? 0; statusRows.set(unit.id, row + 1);
      return [{ targetId: unit.id, side: unit.side, screenX: this.position(unit, state), y: baselineY - 56 - row * 12, label, kind: effect.kind }];
    }));
    return { fieldLeft: field.x, fieldWidth: field.width, cameraLeft,
      units: [...state.party, ...state.enemies].map(unit => ({ id: unit.id, worldX: unit.x, screenX: this.position(unit, state) })),
      edgeMarkers: this.edgeMarkers(state, field),
      projectiles: (state.projectiles ?? []).map(projectile => ({ id: projectile.id, screenX: sx(projectile.x), y: baselineY - 27,
        delivery: projectile.delivery, direction: Math.sign((projectile.delivery === 'ground' ? projectile.centerX ?? projectile.x : allUnits.find(unit => unit.id === projectile.targetId)?.x ?? projectile.x) - projectile.x) })),
      statusCues,
      guardCues: state.events.flatMap(event => {
        const age = combatEventAge(state, event);
        return event.data.type === 'guard' && age !== null && age >= 0 && age <= ticksForSeconds(0.8)
          ? [{ guardianId: event.data.guardianId, fromTargetId: event.data.fromTargetId, toTargetId: event.data.toTargetId, age }] : [];
      }) };
  }
  setCompactViewport(enabled: boolean, zoom: 1 | 2 = 1): void {
    this.compact = enabled; this.zoom = enabled ? zoom : 1; this.ui.setCompactMode(enabled); this.resize(window.innerWidth);
  }
  resize(cssWidth: number): void {
    const dpr = window.devicePixelRatio || 1;
    const backingWidth = Math.max(CONFIG.view.minWidth, Math.floor(cssWidth * dpr));
    const width = Math.max(1, Math.floor(backingWidth / this.zoom));
    const height = this.ui.height();
    if (this.canvas.width !== backingWidth || this.canvas.height !== height * this.zoom || this.dpr !== dpr) {
      this.width = width; this.dpr = dpr; this.canvas.width = backingWidth; this.canvas.height = height * this.zoom; this.resizes += 1;
      this.canvas.style.width = `${backingWidth / dpr}px`; this.canvas.style.height = `${height * this.zoom / dpr}px`;
      if (this.canvas.parentElement) this.canvas.parentElement.style.height = `${height * this.zoom / dpr}px`;
      // Native-pixel q=1 mode: backing dimensions are physical, CSS dimensions divide by DPR.
      this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.imageSmoothingEnabled = false;
    }
  }
  private field() {
    return compactLaneLayout(this.width).field;
  }
  private cameraInput(state: GameState, field: { x: number; width: number }): CombatCameraInput | null {
    if (field.width >= CONFIG.sim.laneWidthPx) return null;
    const party = state.party.filter(unit => unit.hp > 0).map(unit => unit.x);
    if (!party.length) return null;
    const partyById = new Map(state.party.filter(unit => unit.hp > 0).map(unit => [unit.id, unit]));
    const threats: CombatCameraInput['threats'] = [];
    for (const enemy of state.enemies.filter(unit => unit.hp > 0)) {
      const action = enemy.action, special = enemy.specialAction;
      if (action?.state === 'windup') {
        const target = partyById.get(action.targetId);
        if (target) threats.push({ deadline: action.impactTick, focusX: target.x, xs: [enemy.x, target.x] });
      }
      if (special?.state === 'areaMark') {
        const target = partyById.get(special.targetId);
        threats.push({ deadline: special.impactTick, focusX: target?.x ?? special.centerX, xs: [enemy.x, special.centerX - special.radius, special.centerX + special.radius, ...(target ? [target.x] : [])] });
      } else if (special?.state === 'assassinMark' || special?.state === 'assassinDash') {
        const target = partyById.get(special.targetId);
        if (target) threats.push({ deadline: special.impactTick, focusX: target.x, xs: [enemy.x, target.x, ...(special.state === 'assassinDash' ? [special.targetX] : [])] });
      }
    }
    for (const projectile of state.projectiles ?? []) if (projectile.sourceSide === 'enemy' && projectile.targetSide === 'hero') {
      const target = partyById.get(projectile.targetId);
      threats.push({ deadline: projectile.impactNotBeforeTick, focusX: target?.x ?? projectile.x, xs: [projectile.x, ...(target ? [target.x] : [])] });
    }
    const formationXs = state.enemies.filter(unit => unit.hp > 0).map(unit => enemyFormationX(unit.slot));
    return { fieldWidth: field.width, laneWidth: CONFIG.sim.laneWidthPx, partyXs: party, threats, formationXs };
  }
  private cameraLeft(state: GameState, field: { x: number; width: number }): number {
    if (this.frameCamera !== null) return this.frameCamera;
    const input = this.cameraInput(state, field) ?? { fieldWidth: field.width, laneWidth: CONFIG.sim.laneWidthPx, partyXs: [], threats: [] };
    const next = stepCombatCamera(this.cameraTranslation, input);
    this.cameraTranslation = next;
    this.frameCamera = next;
    return next;
  }
  private edgeMarkers(state: GameState, field: { x: number; width: number }): { threatId: string; worldX: number; screenX: number; edge: 'left' | 'right'; label: string }[] {
    const camera = this.cameraLeft(state, field), markers: { threatId: string; worldX: number; screenX: number; edge: 'left' | 'right'; label: string }[] = [];
    const add = (threatId: string, worldX: number, label: string): void => {
      const rawScreenX = Math.round(field.x + worldX - camera);
      if (rawScreenX >= field.x + 8 && rawScreenX <= field.x + field.width - 8) return;
      const edge = rawScreenX < field.x ? 'left' : 'right';
      const screenX = Math.max(field.x + 8, Math.min(field.x + field.width - 8, rawScreenX));
      markers.push({ threatId, worldX, screenX, edge, label });
    };
    for (const enemy of state.enemies.filter(unit => unit.hp > 0)) {
      if (enemy.action?.state === 'windup' || enemy.specialAction) {
        add(enemy.id, enemy.x, enemy.sourceId === 'assassin' ? 'A' : enemy.sourceId === 'bomber' ? 'B' : '!');
      }
    }
    for (const projectile of state.projectiles ?? []) if (projectile.sourceSide === 'enemy' && projectile.targetSide === 'hero') add(projectile.id, projectile.x, '>');
    return markers;
  }
  private position(unit: Unit, state: GameState): number {
    const field = this.field();
    const enemyCount = state.enemies.length;
    const side = unit.side;
    let screenX = formationScreenX(side, unit.slot, enemyCount, field.width);
    const action = unit.action;
    const now = presentationCombatTime(state);
    if (action && (action.state === 'windup' || action.state === 'recovery') && action.delivery === 'leap') {
      const target = [...state.party, ...state.enemies].find(other => other.id === action.targetId);
      const targetSide = target?.side ?? action.targetSide;
      const targetSlot = target?.slot ?? action.targetSlot;
      if (targetSide && targetSlot !== undefined) {
        const timeline = actionBoundaries(unit.sourceId, action.delivery, action);
        const sample = sampleActionPresentation(action.delivery, timeline, now);
        const home = formationScreenX(side, unit.slot, enemyCount, field.width);
        const targetScreen = formationScreenX(targetSide, targetSlot, action.targetCount ?? enemyCount, field.width);
        const contact = targetScreen - Math.sign(targetScreen - home || 1) * 18;
        if (sample.phase === 'approach') screenX = home + (contact - home) * sample.progress;
        else if (sample.phase === 'attack') screenX = contact;
        else if (sample.phase === 'return') screenX = contact + (home - contact) * easeReturn(sample.progress);
        else screenX = home;
      }
    } else if (unit.side === 'enemy' && unit.moving) {
      const spawnX = CONFIG.sim.enemySpawnX + unit.slot * CONFIG.sim.enemySpawnSpacingPx;
      const home = enemyFormationX(unit.slot);
      const t = spawnX === home ? 0 : Math.max(0, Math.min(1, (unit.x - home) / (spawnX - home)));
      screenX += t * (field.width + 16 - screenX);
    }
    return Math.round(field.x + screenX);
  }
  private latest(state: GameState, predicate: (event: GameEvent) => boolean): GameEvent | undefined {
    for (let i = state.events.length - 1; i >= 0; i -= 1) { const event = state.events[i]; if (event && predicate(event)) return event; }
    return undefined;
  }
  private animation(state: GameState, unit: Unit, key: string | undefined): { name: AnimationName; ageMs: number; returning?: boolean } {
    const now = presentationCombatTime(state);
    const age = (event: GameEvent | undefined): number => {
      if (!event) return Infinity;
      const ticks = combatEventAge(state, event);
      return ticks === null ? Infinity : ticks * TICK_MS;
    };
    const dead = this.latest(state, event => event.data.type === 'death' && event.data.unitId === unit.id);
    if (unit.hp <= 0) return { name: 'death', ageMs: Number.isFinite(age(dead)) ? age(dead) : 0 };
    const action = unit.action;
    if (action && (action.state === 'windup' || action.state === 'recovery')) {
      const delivery = action.delivery ?? (action.kind === 'heal' ? 'cast' : 'leap');
      const timeline = actionBoundaries(unit.sourceId, delivery, action);
      const sample = sampleActionPresentation(delivery, timeline, now);
      if (sample.phase !== 'done') return { name: sample.animation, ageMs: sample.ageMs, returning: sample.phase === 'return' };
    }
    const hurt = this.latest(state, event => event.data.type === 'hit' && event.data.targetId === unit.id);
    if (age(hurt) < (key ? this.atlases.durationMs(key, 'hit') ?? CONFIG.view.hurtFallbackMs : CONFIG.view.hurtFallbackMs)) return { name: 'hit', ageMs: age(hurt) };
    return { name: unit.moving ? 'run' : 'idle', ageMs: Math.max(0, now - (unit.nativeBornTick ?? unit.bornTick)) * TICK_MS };
  }
  render(state: GameState, paused = false): void {
    this.rendering = true;
    this.frameCamera = null;
    const ctx = this.ctx, view = CONFIG.view, palette = CONFIG.ui.palette, height = this.ui.height();
    if (!this.effectEventsInitialized) { this.effectEventSeq = state.eventSeq; this.effectEventsInitialized = true; }
    this.effectEventSeq = consumeNewEvents(state.eventSeq, this.effectEventSeq, state.events, event => {
      triggerLegendaryEvent(event, state.party, state.enemies, (kind, label) => this.legendaryEffects.trigger(kind, performance.now(), label));
    });
    const coreY = height - CONFIG.ui.closed.coreHeight, baselineY = coreY + CONFIG.ui.closed.baselineCoreLocalY;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.zoom, 0, 0, this.zoom, 0, 0);
    ctx.fillStyle = palette.base; ctx.fillRect(0, coreY, this.width, CONFIG.ui.closed.coreHeight);
    ctx.fillStyle = palette.edge; ctx.fillRect(0, coreY, this.width, 1);
    const field = this.field();
    ctx.save(); ctx.beginPath(); ctx.rect(field.x, 0, field.width, height); ctx.clip();
    ctx.fillStyle = '#293c35'; ctx.fillRect(field.x, coreY + 48, field.width, 32);
    ctx.fillStyle = '#3f5542'; ctx.fillRect(field.x, coreY + 48, field.width, 2);
    for (let x = field.x + 5; x < field.x + field.width; x += 28) { ctx.fillStyle = x % 3 ? '#52664a' : '#223d32'; ctx.fillRect(x, coreY + 51, 2, 2); ctx.fillRect(x + 12, coreY + 65, 3, 1); }
    const enemies = state.enemies;
    const units = [...state.party, ...enemies].sort((a, b) => this.position(a, state) - this.position(b, state));
    for (const unit of units) {
      const x = this.position(unit, state);
      const depth = unit.side === 'hero' ? unit.slot * 4 : 0;
      const unitBaseline = baselineY - depth;
      const enemyVisual = unit.side === 'enemy' ? getPartyEnemyDefinition(unit.sourceId).visualKind : undefined;
      const color = unit.side === 'hero' ? view.roleColors[heroConfig(unit.sourceId).role] : view.enemyColors[enemyVisual!];
      const key = unit.side === 'hero' ? Object.entries(view.heroAssets).find(([id]) => id === unit.sourceId)?.[1] : view.enemyAssets[enemyVisual!];
      const anim = this.animation(state, unit, key);
      const lastHit = this.latest(state, event => event.data.type === 'hit' && event.data.targetId === unit.id);
      const lastHitAge = lastHit ? combatEventAge(state, lastHit) : null;
      const flash = lastHit !== undefined && lastHitAge !== null && lastHitAge * TICK_MS < view.hitFlashMs;
      const flip = anim.returning ? unit.side === 'hero' : unit.facing === -1;
      if (!key || !this.atlases.draw(ctx, key, anim.name, anim.ageMs, x, unitBaseline, flip, 1, flash)) {
        ctx.fillStyle = unit.hp <= 0 ? '#52616b' : color; ctx.fillRect(x - view.heroWidth / 2, unitBaseline - view.heroHeight, view.heroWidth, view.heroHeight);
      }
      if (unit.hp <= 0) continue;
      const hpWidth = unit.side === 'hero' ? 34 : 32, hpY = coreY + CONFIG.ui.unitHpBars.coreLocalY - depth;
      ctx.fillStyle = palette.ink; ctx.fillRect(x - hpWidth / 2, hpY, hpWidth, CONFIG.ui.unitHpBars.height);
      ctx.fillStyle = '#29362e'; ctx.fillRect(x - hpWidth / 2 + 1, hpY + 1, hpWidth - 2, CONFIG.ui.unitHpBars.height - 2);
      ctx.fillStyle = unit.side === 'hero' ? palette.green : palette.red; ctx.fillRect(x - hpWidth / 2 + 1, hpY + 1, Math.round((hpWidth - 2) * unit.hp / unit.maxHp), CONFIG.ui.unitHpBars.height - 2);
      {
        ctx.fillStyle = palette.ink; ctx.fillRect(x - hpWidth / 2, hpY - 3, hpWidth, 2);
        ctx.fillStyle = '#29362e'; ctx.fillRect(x - hpWidth / 2 + 1, hpY - 3, hpWidth - 2, 2);
        ctx.fillStyle = palette.gold; ctx.fillRect(x - hpWidth / 2 + 1, hpY - 3, Math.round((hpWidth - 2) * gaugeRatio(unit.gauge)), 2);
        if (unit.side === 'hero') {
          const manaCap = unit.sourceId === 'mh2' ? 40 : ['wiz', 'mw3', 'ew2', 'mk2', 'mh3'].includes(unit.sourceId) ? 80 : 60;
          const mana = Math.min(manaCap, unit.mana ?? 0);
          ctx.fillStyle = palette.ink; ctx.fillRect(x - hpWidth / 2, hpY + CONFIG.ui.unitHpBars.height, hpWidth, 2);
          ctx.fillStyle = '#182a38'; ctx.fillRect(x - hpWidth / 2 + 1, hpY + CONFIG.ui.unitHpBars.height + 1, hpWidth - 2, 1);
          ctx.fillStyle = mana >= manaCap ? '#63d6ff' : '#438bb4'; ctx.fillRect(x - hpWidth / 2 + 1, hpY + CONFIG.ui.unitHpBars.height + 1, Math.round((hpWidth - 2) * mana / manaCap), 1);
        }
      }
      if (unit.shield > 0) { ctx.strokeStyle = palette.blue; ctx.strokeRect(x - 17.5, unitBaseline - 49.5, 35, 50); }
    }
    {
      const allUnits = [...state.party, ...state.enemies];
      const camera = this.cameraLeft(state, field), sx = (worldX: number): number => Math.round(field.x + worldX - camera);
      const combatProjection = this.getCombatProjection(state);
      for (const enemy of state.enemies) {
        const special = enemy.specialAction;
        if (!special) continue;
        if (special.state === 'areaMark') {
          ctx.save(); ctx.strokeStyle = special.global ? '#ff6b68' : '#ffbd59'; ctx.fillStyle = special.global ? 'rgba(255,75,72,.13)' : 'rgba(255,177,56,.16)'; ctx.lineWidth = 2;
          if (special.global) {
            for (const ally of state.party.filter(unit => unit.hp > 0)) { const allyX = this.position(ally, state); ctx.beginPath(); ctx.arc(allyX, baselineY - 18, 20, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
            this.ui.text(ctx, 'GLOBAL', Math.max(field.x + 30, Math.min(field.x + field.width - 30, sx(special.centerX))), coreY + 12, '#ff7772', BODY, true);
          } else {
            ctx.beginPath(); ctx.arc(sx(special.centerX), baselineY - 18, special.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
          ctx.restore();
        } else if (special.state === 'assassinMark') {
          const target = allUnits.find(unit => unit.id === special.targetId);
          if (target) this.ui.text(ctx, '!', this.position(target, state), baselineY - 48, '#ff605c', BODY, true);
        } else if (special.state === 'assassinDash') {
          ctx.save(); ctx.strokeStyle = 'rgba(255,96,92,.8)'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(this.position(enemy, state), baselineY - 14); ctx.lineTo(sx(special.targetX), baselineY - 14); ctx.stroke(); ctx.restore();
        }
      }
      // Combat cues use the same translated world coordinates as units; projection is read-only.
      for (const projectile of state.projectiles ?? []) {
        const target = allUnits.find(unit => unit.id === projectile.targetId && unit.hp > 0);
        const destination = projectile.delivery === 'ground' ? projectile.centerX ?? projectile.x : target?.x ?? projectile.x;
        const direction = Math.sign(destination - projectile.x) || 1, x = sx(projectile.x), y = baselineY - 27;
        ctx.save();
        if (projectile.delivery === 'ground') {
          ctx.fillStyle = '#ffd16e'; ctx.strokeStyle = '#fff0bd'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = 'rgba(255,190,72,.35)'; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.strokeStyle = '#fff1b0'; ctx.fillStyle = '#ffcb54'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x - direction * 8, y + 3); ctx.lineTo(x + direction * 3, y); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x + direction * 5, y); ctx.lineTo(x - direction * 1, y - 4); ctx.lineTo(x - direction * 1, y + 4); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }
      for (const cue of combatProjection.statusCues) {
        const width = Math.max(38, cue.label.length * 6 + 8), x = cue.screenX, y = cue.y;
        ctx.fillStyle = cue.side === 'enemy' ? 'rgba(48,24,25,.9)' : 'rgba(19,33,31,.88)'; ctx.fillRect(x - width / 2, y - 7, width, 10);
        const color = cue.kind === 'atkReduction' || cue.kind === 'defReduction' ? '#ffd1ad' : '#d8f2c2';
        this.ui.text(ctx, cue.label, x, y + 1, color, BODY, true);
      }
      for (const cue of combatProjection.guardCues) {
        const guardian = state.party.find(unit => unit.id === cue.guardianId), original = state.party.find(unit => unit.id === cue.fromTargetId);
        if (!guardian) continue;
        const gx = this.position(guardian, state), ox = original ? this.position(original, state) : gx;
        ctx.save(); ctx.strokeStyle = 'rgba(123,205,255,.82)'; ctx.fillStyle = 'rgba(75,160,220,.20)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ox, baselineY - 34); ctx.quadraticCurveTo((ox + gx) / 2, baselineY - 60, gx, baselineY - 34); ctx.stroke();
        ctx.beginPath(); ctx.arc(gx, baselineY - 36, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        this.ui.text(ctx, 'Guard', gx, baselineY - 33, '#d8f2ff', BODY, true); ctx.restore();
      }
      // A camera may prioritize the next impact when committed threats cannot all fit.
      // Give every off-screen source/projectile its own restrained edge cue.
      const edgeMarkers = combatProjection.edgeMarkers;
      edgeMarkers.forEach((item, row) => {
        const left = item.edge === 'left', x = left ? field.x + 2 : field.x + field.width - 16, y = coreY + 14 + (row % 5) * 11;
        ctx.fillStyle = '#321b20'; ctx.strokeStyle = '#ff716d'; ctx.lineWidth = 1; ctx.fillRect(x, y - 6, 14, 12); ctx.strokeRect(x + 0.5, y - 5.5, 13, 11);
        ctx.fillStyle = '#ff8a83'; ctx.beginPath();
        if (left) { ctx.moveTo(x + 2, y - 4); ctx.lineTo(x + 7, y); ctx.lineTo(x + 2, y + 4); }
        else { ctx.moveTo(x + 12, y - 4); ctx.lineTo(x + 7, y); ctx.lineTo(x + 12, y + 4); }
        ctx.fill(); this.ui.text(ctx, item.label, left ? x + 10 : x + 5, y + 2, '#ffd1cc', BODY, true);
      });
      for (const source of units) {
        const target = allUnits.find(unit => unit.id === source.targetId && unit.hp > 0);
        if (!target) continue;
        const targetX = this.position(target, state);
        ctx.fillStyle = '#f4d37e'; ctx.fillRect(targetX - 2, coreY + 11, 4, 2); ctx.fillRect(targetX - 1, coreY + 13, 2, 2);
      }
    }
    const lifetime = ticksForSeconds(CONFIG.runtime.damageLabelSeconds), bucket = ticksForSeconds(CONFIG.runtime.damageCoalesceSeconds);
    const labelClock = presentationCombatTime(state);
    const groups = new Map<string, { targetId: string; tick: number; amount: number; heal: boolean }>();
    for (const event of state.events) {
      const data = event.data;
      const ageTicks = combatEventAge(state, event);
      if (ageTicks === null || ageTicks > lifetime || (data.type !== 'hit' && data.type !== 'heal')) continue;
      const eventTick = labelClock - ageTicks;
      const key = `${data.targetId}:${data.type}:${Math.floor(eventTick / bucket)}`, old = groups.get(key);
      const amount = data.type === 'hit' ? data.damage : data.amount;
      if (old) old.amount += amount; else groups.set(key, { targetId: data.targetId, tick: eventTick, amount, heal: data.type === 'heal' });
    }
    const counts = new Map<string, number>();
    for (const group of [...groups.values()].sort((a, b) => b.tick - a.tick)) {
      const count = counts.get(group.targetId) ?? 0; if (count >= CONFIG.runtime.damageLabelMaxPerTarget) continue;
      counts.set(group.targetId, count + 1);
      const unit = units.find(unit => unit.id === group.targetId); if (!unit) continue;
      const age = labelClock - group.tick, x = this.position(unit, state) - 10 + count * 6;
      const y = Math.max(8, baselineY - 64 - Math.round(CONFIG.runtime.damageRisePx * age / lifetime) - count * 10);
      const label = `${group.heal ? '+' : '-'}${group.amount}`;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) this.ui.text(ctx, label, x + (dx ?? 0), y + (dy ?? 0), palette.ink, BODY, true);
      this.ui.text(ctx, label, x, y, group.heal ? palette.green : palette.gold, BODY, true);
    }
    ctx.restore();
    this.ui.draw(ctx, state, this.width, coreY, paused, this.zoom / this.dpr);
    this.drawFeedback(ctx, state, units, field, coreY);
    this.drawLegendaryEffect(ctx, field, coreY);
    this.rendering = false;
  }
  private drawLegendaryEffect(ctx: CanvasRenderingContext2D, field: { x: number; width: number }, coreY: number): void {
    const effect = this.legendaryEffects.current(performance.now()); if (!effect) return;
    const reducedMotion = this.ui.reducedMotion;
    const cx = field.x + Math.floor(field.width / 2), cy = coreY + 30, progress = effect.age / (effect.kind === 'skill' ? 1100 : 1000);
    const gold = CONFIG.ui.rarity.legendary.frame;
    ctx.save(); ctx.imageSmoothingEnabled = false;
    if (reducedMotion) {
      const alpha = Math.max(0, 1 - effect.age / 450);
      ctx.globalAlpha = alpha; ctx.fillStyle = '#101c27'; ctx.fillRect(cx - 112, cy - 37, 224, 24);
      ctx.strokeStyle = gold; ctx.strokeRect(cx - 112.5, cy - 37.5, 225, 25);
      ctx.fillStyle = gold; ctx.fillRect(cx - 4, cy - 4, 9, 9);
      this.ui.text(ctx, effect.label, cx - Math.min(104, effect.label.length * 3.5), cy - 31, '#ffe38c', 16, true);
    } else if (effect.kind === 'skill') {
      const radius = 10 + Math.floor(progress * 42), alpha = Math.max(0, 1 - progress);
      if (!this.ui.reducedMotion && !this.compact) { ctx.globalAlpha = alpha * 0.22; ctx.fillStyle = gold; ctx.fillRect(field.x, 0, field.width, coreY + 54); }
      ctx.globalAlpha = alpha;
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6, x = Math.round(cx + Math.cos(a) * radius), y = Math.round(cy + Math.sin(a) * radius * 0.55); ctx.fillStyle = i % 2 ? '#fff4bf' : gold; ctx.fillRect(x, y, 3, 3); }
      ctx.fillStyle = '#fff4bf'; ctx.fillRect(cx - 3, cy - 3, 7, 7);
      if (this.holySheet?.complete && this.holySheet.naturalWidth) {
        const frame = Math.min(13, Math.floor(effect.age / 80)); ctx.globalAlpha = alpha;
        ctx.drawImage(this.holySheet, frame * 80, 0, 80, 120, cx - 24, cy - 50, 48, 72);
      }
      ctx.globalAlpha = alpha; ctx.fillStyle = '#101c27'; ctx.fillRect(cx - 112, cy - 37, 224, 24); ctx.strokeStyle = gold; ctx.strokeRect(cx - 112.5, cy - 37.5, 225, 25);
      this.ui.text(ctx, effect.label, cx - Math.min(104, effect.label.length * 3.5), cy - 31, '#ffe38c', 16, true);
    } else {
      const alpha = Math.max(0, 1 - progress), radius = 12 + Math.floor(progress * 38);
      ctx.globalAlpha = alpha * 0.7; ctx.strokeStyle = gold; ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + progress * Math.PI / 2; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7); ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius); ctx.stroke(); }
      const size = 8 + Math.min(8, Math.floor(effect.age / 60)); ctx.globalAlpha = alpha; ctx.fillStyle = gold; ctx.fillRect(cx - size / 2, cy - size / 2, size, size); ctx.strokeRect(cx - size / 2 - 2, cy - size / 2 - 2, size + 4, size + 4);
      if (this.treasureSheet?.complete && this.treasureSheet.naturalWidth) {
        const frame = Math.min(15, Math.floor(effect.age / 62)); ctx.drawImage(this.treasureSheet, frame * 48, 0, 48, 48, cx - 24, cy - 24, 48, 48);
      }
      if (this.dropBurstSheet?.complete && this.dropBurstSheet.naturalWidth) {
        const frame = Math.min(11, Math.floor(effect.age / 84)); ctx.globalAlpha = alpha;
        ctx.drawImage(this.dropBurstSheet, frame * 48, 0, 48, 48, cx - 24, cy - 24, 48, 48);
      }
    }
    ctx.restore();
  }
  /**
   * Upgrade popups and stage/boss banners (ui.md §10, ui-tokens coreLoopFeedback). Everything is derived from the event log and
   * the sim tick, so a given tick always draws the same frame. Timings are specified on a 40 ms clock; the 20 Hz sim samples it.
   */
  private drawFeedback(ctx: CanvasRenderingContext2D, state: GameState, units: Unit[], field: { x: number; width: number }, coreY: number): void {
    const spec = CONFIG.ui.coreLoopFeedback, still = this.ui.reducedMotion, chip = this.ui.panel !== null;
    const popups = upgradePopups(state).sort((a, b) => b.seq - a.seq).slice(0, chip ? spec.upgradePopup.panelChip.maxVisible : spec.upgradePopup.maxStacked);
    for (const [index, popup] of popups.entries()) {
      const frame = popupFrame(popup.age * CONFIG.view.upgradePopupSeconds * 1000, chip, still), segments = popup.delta.segments;
      if (!frame) continue;
      ctx.save(); ctx.globalAlpha = frame.alpha;
      if (chip) this.ui.drawPanelChip(ctx, segments, frame.rise);
      else {
        const hero = units.find(unit => unit.side === 'hero' && unit.sourceId === popup.delta.heroId);
        const width = this.ui.popupWidth(segments), centre = hero ? this.position(hero, state) : this.ui.feedbackAnchorX(popup.delta.heroId ? 'heroes' : 'gear');
        const x = Math.max(spec.upgradePopup.clampMarginPx, Math.min(this.width - spec.upgradePopup.clampMarginPx - width, roundHalfEven(centre - width / 2)));
        this.ui.drawPopupText(ctx, segments, x, coreY + spec.upgradePopup.startTopCoreLocal - frame.rise - index * spec.upgradePopup.stackGapPx);
      }
      ctx.restore();
    }
    const cue = chip ? null : stageCue(state), frame = cue ? bannerFrame(cue.age * CONFIG.view.stageCueSeconds * 1000, still) : null;
    if (cue && frame) {
      const banner = spec.stageBanner, boss = cue.kind === 'boss', id = stageConfig(cue.stage).id;
      ctx.save(); ctx.globalAlpha = frame.alpha;
      // Drawn last: tall sprite effects pass behind the plate. Window y is relative to the closed overlay's top.
      this.ui.drawBanner(ctx, (boss ? banner.boss.label : banner.stage.label).replace('{id}', id), boss, field.width > 0 ? field.x + field.width / 2 : this.width / 2, coreY - CONFIG.ui.closed.coreHeight + frame.y);
      ctx.restore();
    }
  }
}
