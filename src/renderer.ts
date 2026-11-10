import { CONFIG, TICK_MS, enemyKindSchema, heroConfig, stageConfig, ticksForSeconds } from './config';
import { AtlasLibrary } from './atlas';
import type { AnimationName } from './atlas';
import { PixelUI, roundHalfEven } from './pixel-ui';
import { BODY } from './font';
import { bannerFrame, popupFrame } from './motion';
import type { GameEvent, GameState, Unit } from './core/model';
import { stageCue, upgradePopups } from './core/selectors';
import { combatEventAge, PARTY_V2, presentationCombatTime } from './core/party-combat';
import { activePartyEffects } from './core/party-effects';
import { getPartyEnemyDefinition } from './core/party-enemies';
export interface HitRegion { kind: 'hud' | 'panel'; id: string; x: number; y: number; width: number; height: number }
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private width = CONFIG.view.defaultWidth;
  private dpr = 1;
  private compact = false;
  private zoom = 1;
  private resizes = 0;
  readonly atlases = new AtlasLibrary();
  readonly ui: PixelUI;
  constructor(private readonly canvas: HTMLCanvasElement, controls: HTMLElement) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.ctx = ctx; this.ui = new PixelUI(this.atlases, controls);
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
    const field = this.field(), cameraLeft = this.cameraLeft(state, field);
    const sx = (worldX: number) => Math.round(field.x + worldX - cameraLeft), baselineY = this.ui.height() - CONFIG.ui.closed.coreHeight + CONFIG.ui.closed.baselineCoreLocalY;
    const allUnits = [...state.party, ...state.enemies];
    const statusNames: Record<string, string> = { 'party-atk-buff': 'ATK up', 'enemy-atk-weaken': 'ATK down', 'enemy-def-weaken': 'DEF down', 'healing-guard': 'Damage guard', 'party-guard-aura': 'Damage guard', 'bruiser-guard': 'Damage guard' };
    const statusRows = new Map<string, number>();
    const statusCues = state.combatRules === 'party-v2' ? allUnits.filter(unit => unit.hp > 0).flatMap(unit => activePartyEffects(state, unit.id).flatMap(effect => {
      const label = statusNames[effect.group]; if (!label) return [];
      const row = statusRows.get(unit.id) ?? 0; statusRows.set(unit.id, row + 1);
      return [{ targetId: unit.id, side: unit.side, screenX: this.position(unit, state), y: baselineY - 56 - row * 12, label, kind: effect.kind }];
    })) : [];
    return { fieldLeft: field.x, fieldWidth: field.width, cameraLeft,
      units: [...state.party, ...state.enemies].map(unit => ({ id: unit.id, worldX: unit.x, screenX: this.position(unit, state) })),
      edgeMarkers: this.edgeMarkers(state, field),
      projectiles: (state.projectiles ?? []).map(projectile => ({ id: projectile.id, screenX: sx(projectile.x), y: baselineY - 27,
        delivery: projectile.delivery, direction: Math.sign((projectile.delivery === 'ground' ? projectile.centerX ?? projectile.x : allUnits.find(unit => unit.id === projectile.targetId)?.x ?? projectile.x) - projectile.x) })),
      statusCues,
      guardCues: state.combatRules === 'party-v2' ? state.events.flatMap(event => {
        const age = combatEventAge(state, event);
        return event.data.type === 'guard' && age !== null && age >= 0 && age <= ticksForSeconds(0.8)
          ? [{ guardianId: event.data.guardianId, fromTargetId: event.data.fromTargetId, toTargetId: event.data.toTargetId, age }] : [];
      }) : [] };
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
    // Compact lane (compact-menu.md §2.1): the field is the token rect (216, 280) at W=640 and grows with W. Narrower source
    // widths (480..639) keep the full-width field so units stay readable; the islands then overlap its ends.
    if (this.compact) { const lane = CONFIG.ui.compactMenu.lane, [fx = 216, , fw = 280] = lane.field; return this.width >= lane.width ? { x: fx, width: fw + this.width - lane.width } : { x: 8, width: Math.max(0, this.width - 16) }; }
    const compact = this.width < 1000; return { x: compact ? 216 : 304, width: Math.max(0, this.width - (compact ? 432 : 608)) };
  }
  private cameraLeft(state: GameState, field: { x: number; width: number }): number {
    if (state.combatRules !== 'party-v2' || field.width >= CONFIG.sim.laneWidthPx) return 0;
    const party = state.party.filter(unit => unit.hp > 0).map(unit => unit.x);
    if (!party.length) return 0;
    let min = Math.min(...party), max = Math.max(...party);
    const partyById = new Map(state.party.filter(unit => unit.hp > 0).map(unit => [unit.id, unit]));
    const threats: { deadline: number; focusX: number; xs: number[] }[] = [];
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
    const all = [...party, ...threats.flatMap(threat => threat.xs)];
    min = Math.min(...all); max = Math.max(...all);
    const usable = Math.max(1, field.width - 48);
    if (max - min <= usable) return Math.max(0, Math.min(CONFIG.sim.laneWidthPx - field.width, (min + max - field.width) / 2));
    const nearest = threats.sort((a, b) => a.deadline - b.deadline || Math.abs(a.focusX - (min + max) / 2) - Math.abs(b.focusX - (min + max) / 2))[0];
    if (nearest) {
      const focusMin = Math.min(...party, nearest.focusX), focusMax = Math.max(...party, nearest.focusX);
      if (focusMax - focusMin <= usable) return Math.max(0, Math.min(CONFIG.sim.laneWidthPx - field.width, (focusMin + focusMax - field.width) / 2));
      return Math.max(0, Math.min(CONFIG.sim.laneWidthPx - field.width, nearest.focusX - field.width / 2));
    }
    return Math.max(0, Math.min(CONFIG.sim.laneWidthPx - field.width, (Math.min(...party) + Math.max(...party) - field.width) / 2));
  }
  private edgeMarkers(state: GameState, field: { x: number; width: number }): { threatId: string; worldX: number; screenX: number; edge: 'left' | 'right'; label: string }[] {
    if (state.combatRules !== 'party-v2') return [];
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
    if (state.combatRules === 'party-v2') return Math.round(field.x + unit.x - this.cameraLeft(state, field));
    const compact = field.width < 300;
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
    const now = state.combatRules === 'party-v2' ? presentationCombatTime(state) : state.tick;
    const age = (event: GameEvent | undefined): number => {
      if (!event) return Infinity;
      const ticks = combatEventAge(state, event);
      return ticks === null ? Infinity : ticks * TICK_MS;
    };
    const dead = this.latest(state, event => event.data.type === 'death' && event.data.unitId === unit.id);
    if (unit.hp <= 0) return { name: 'death', ageMs: Number.isFinite(age(dead)) ? age(dead) : 0 };
    if (state.combatRules === 'party-v2') {
      const action = unit.action;
      if (action && action.state !== 'idle' && now < action.startTick + PARTY_V2.timing.windupTicks + PARTY_V2.timing.animationRecoveryTicks) {
        const name: AnimationName = action.kind === 'heal' ? 'cast' : 'attack';
        const duration = key ? this.atlases.durationMs(key, name) ?? CONFIG.view.attackFallbackMs : CONFIG.view.attackFallbackMs;
        const fraction = action.kind === 'heal' ? PARTY_V2.animation.healImpactFraction : PARTY_V2.animation.attackImpactFraction;
        const windupTicks = Math.max(1, action.impactTick - action.startTick);
        const elapsed = now - action.startTick;
        const ageMs = elapsed <= windupTicks
          ? duration * fraction * Math.max(0, elapsed) / windupTicks
          : duration * fraction + duration * (1 - fraction) * Math.min(1, (elapsed - windupTicks) / PARTY_V2.timing.animationRecoveryTicks);
        return { name, ageMs };
      }
    }
    const hurt = this.latest(state, event => event.data.type === 'hit' && event.data.targetId === unit.id);
    if (age(hurt) < (key ? this.atlases.durationMs(key, 'hit') ?? CONFIG.view.hurtFallbackMs : CONFIG.view.hurtFallbackMs)) return { name: 'hit', ageMs: age(hurt) };
    if (state.combatRules === 'party-v2') {
      return { name: unit.moving ? 'run' : 'idle', ageMs: Math.max(0, now - (unit.nativeBornTick ?? unit.bornTick)) * TICK_MS };
    }
    const attack = this.latest(state, event => ((event.data.type === 'hit' && event.data.attackerId === unit.id) || (event.data.type === 'heal' && event.data.sourceId === unit.id)) || (event.data.type === 'skill' && event.data.unitId === unit.id));
    if (age(attack) < (key ? this.atlases.durationMs(key, 'attack') ?? CONFIG.view.attackFallbackMs : CONFIG.view.attackFallbackMs)) return { name: 'attack', ageMs: age(attack) };
    const front = state.party.find(hero => hero.hp > 0);
    const moving = unit.side === 'enemy' && front && unit.x - front.x > unit.range;
    return { name: moving ? 'run' : 'idle', ageMs: (state.tick - unit.bornTick) * 1000 / CONFIG.sim.ticksPerSecond };
  }
  render(state: GameState, paused = false): void {
    const ctx = this.ctx, view = CONFIG.view, palette = CONFIG.ui.palette, height = this.ui.height();
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
    const enemies = state.combatRules !== 'party-v2' && field.width < 300 ? state.enemies.slice(0, 2) : state.enemies;
    const units = [...state.party, ...enemies].sort((a, b) => this.position(a, state) - this.position(b, state));
    for (const unit of units) {
      const x = this.position(unit, state);
      const depth = state.combatRules === 'party-v2' && unit.side === 'hero' ? unit.slot * 4 : 0;
      const unitBaseline = baselineY - depth;
      const enemyVisual = unit.side === 'enemy'
        ? state.combatRules === 'party-v2' ? getPartyEnemyDefinition(unit.sourceId).visualKind : enemyKindSchema.parse(unit.sourceId)
        : undefined;
      const color = unit.side === 'hero' ? view.roleColors[heroConfig(unit.sourceId).role] : view.enemyColors[enemyVisual!];
      const key = unit.side === 'hero' ? Object.entries(view.heroAssets).find(([id]) => id === unit.sourceId)?.[1] : view.enemyAssets[enemyVisual!];
      const anim = this.animation(state, unit, key);
      const lastHit = this.latest(state, event => event.data.type === 'hit' && event.data.targetId === unit.id);
      const lastHitAge = lastHit ? combatEventAge(state, lastHit) : null;
      const flash = lastHit !== undefined && lastHitAge !== null && lastHitAge * TICK_MS < view.hitFlashMs;
      const flip = state.combatRules === 'party-v2' ? unit.facing === -1 : unit.side === 'enemy';
      if (!key || !this.atlases.draw(ctx, key, anim.name, anim.ageMs, x, unitBaseline, flip, 1, flash)) {
        ctx.fillStyle = unit.hp <= 0 ? '#52616b' : color; ctx.fillRect(x - view.heroWidth / 2, unitBaseline - view.heroHeight, view.heroWidth, view.heroHeight);
      }
      if (unit.hp <= 0) continue;
      const hpWidth = unit.side === 'hero' ? 34 : 32, hpY = coreY + CONFIG.ui.unitHpBars.coreLocalY - depth;
      ctx.fillStyle = palette.ink; ctx.fillRect(x - hpWidth / 2, hpY, hpWidth, CONFIG.ui.unitHpBars.height);
      ctx.fillStyle = '#29362e'; ctx.fillRect(x - hpWidth / 2 + 1, hpY + 1, hpWidth - 2, CONFIG.ui.unitHpBars.height - 2);
      ctx.fillStyle = unit.side === 'hero' ? palette.green : palette.red; ctx.fillRect(x - hpWidth / 2 + 1, hpY + 1, Math.round((hpWidth - 2) * unit.hp / unit.maxHp), CONFIG.ui.unitHpBars.height - 2);
      if (unit.shield > 0) { ctx.strokeStyle = palette.blue; ctx.strokeRect(x - 17.5, unitBaseline - 49.5, 35, 50); }
    }
    if (state.combatRules === 'party-v2') {
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
    const labelClock = state.combatRules === 'party-v2' ? presentationCombatTime(state) : state.tick;
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
    if (state.enemies.length > enemies.length) this.ui.text(ctx, `+${state.enemies.length - enemies.length}`, field.x + field.width - 32, coreY + 3, palette.muted, BODY);
    ctx.restore();
    this.ui.draw(ctx, state, this.width, coreY, paused, this.zoom / this.dpr);
    this.drawFeedback(ctx, state, units, field, coreY);
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
