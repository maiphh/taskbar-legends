import { CONFIG, TICK_MS, heroConfig, isBossEnemyId, stageConfig, statusEffectsConfig, ticksForSeconds } from './config';
import { AtlasLibrary } from './atlas';
import type { AnimationName } from './atlas';
import { PixelUI, roundHalfEven } from './pixel-ui';
import { BODY, SMALL, loadFonts } from './font';
import { bannerFrame, popupFrame } from './motion';
import { itemId } from './core/model';
import type { GameEvent, GameState, Unit } from './core/model';
import { bossHpBar, stageCue, upgradePopups } from './core/selectors';
import { ellipsize } from './text-fit';
import { enemyFormationX, presentationCombatTime } from './core/party-combat';
import { activePartyEffects } from './core/party-effects';
import { getPartyEnemyDefinition } from './core/party-enemies';
import { isStatusBoss } from './core/status-effects';
import { skillShortName } from './skill-names';
import {
  STATUS_GLYPH_IDS, STATUS_GOLD, STATUS_LIGHT, STATUS_MUTED,
  compareStatusDisplay, drawDigit3x5, drawOverflowChip, drawStatusGlyph,
  statusFrameFor, type StatusGlyphId,
} from './core/status-icons';
import { formationScreenX } from './core/turn/formation-view';
import { actionBoundaries, sampleActionPresentation } from './core/turn/animation-timing';
import { easeReturn } from './core/turn/presentation';
import { gaugeRatio } from './core/turn/action-bar';
import { stepCombatCamera, type CombatCameraInput } from './party-camera';
import { compactLaneLayout } from './compact-lane-layout';
import { LegendaryEffects } from './legendary-effects';
import { consumeNewEvents, triggerLegendaryEvent } from './legendary-events';
import { effectRandom } from './legendary-effects';
import { dropCardSize, LanePositionCache, presentationHitstop, PresentationLaneClock } from './legendary-presentation';
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
  private frameLaneTime: number | null = null;
  private frameLaneSample = 0;
  private readonly laneClock = new PresentationLaneClock();
  private framePaused = false;
  private frameLaneRate = 1;
  private frameSimJump = 0;
  private priorLaneSim: number | null = null;
  private readonly lanePositions = new LanePositionCache();
  private rendering = false;
  private pixelFontReady = false;
  readonly atlases = new AtlasLibrary();
  readonly ui: PixelUI;
  readonly legendaryEffects = new LegendaryEffects();
  private effectEventSeq = 0;
  private effectEventsInitialized = false;
  baselineLegendaryEvents(seq: number): void { this.effectEventSeq = seq; this.effectEventsInitialized = true; this.legendaryEffects.clear(); this.laneClock.reset(); this.lanePositions.reset(); }
  private holySheet: HTMLImageElement | null = null;
  private signatureSheet: HTMLImageElement | null = null;
  private treasureSheet: HTMLImageElement | null = null;
  private legendarySword: HTMLImageElement | null = null;
  private legendaryArmor: HTMLImageElement | null = null;
  private legendaryCharm: HTMLImageElement | null = null;
  constructor(private readonly canvas: HTMLCanvasElement, controls: HTMLElement) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.ctx = ctx; this.ui = new PixelUI(this.atlases, controls);
    void loadFonts().then(() => document.fonts.load('700 16px GamePixel')).then(() => { this.pixelFontReady = true; this.ui.onRedraw?.(); }).catch(() => { /* no FontFace (tests/headless): keep fallback font */ });
    this.holySheet = this.loadVfx('holy-smite'); this.signatureSheet = this.loadVfx('pvfx-crit-hit-gold'); this.treasureSheet = this.loadVfx('treasure-glint');
    this.legendarySword = this.loadUiIcon('sword'); this.legendaryArmor = this.loadUiIcon('armor'); this.legendaryCharm = this.loadUiIcon('potion');
  }
  private loadUiIcon(name: string): HTMLImageElement { const image = new Image(); image.src = new URL(`${import.meta.env.BASE_URL}ui/icon-${name}.png`, window.location.href).href; return image; }
  private loadVfx(name: string): HTMLImageElement { const image = new Image(); image.src = new URL(`${import.meta.env.BASE_URL}assets/vfx/${name.startsWith('cs5475-') || name.startsWith('pvfx-') ? name : `pvfx-${name}`}/sprites.png`, window.location.href).href; image.onerror = () => { image.dataset.unavailable = 'true'; }; return image; }
  /** Debug capture uses the same caster resolver as retained combat events without touching sim state. */
  debugLegendaryShowcase(kind: 'skill' | 'drop', state: GameState, slot: 'weapon' | 'armor' | 'charm' = 'weapon'): void {
    const anchor = state.party[0];
    if (!anchor) throw new Error('Legendary showcase needs a rendered party anchor');
    if (kind === 'skill') { this.legendaryEffects.trigger('skill', performance.now(), 'HEAVY SINGLE BURST', { anchorId: anchor.id }); return; }
    const event: GameEvent = { seq: state.eventSeq, tick: state.tick, data: { type: 'gear', gearId: itemId(state.seed, 0), slot, rarity: 'legendary' } };
    triggerLegendaryEvent(event, state.party, state.enemies, value => this.legendaryEffects.trigger(value.kind, performance.now(), value.label, value));
  }
  seekLegendaryShowcase(ms: number): void { this.legendaryEffects.seek(ms); }
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
    if (!this.rendering) { this.frameCamera = null; this.frameLaneTime = null; }
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
        const age = event.combatEncounter === state.encounter ? this.lanePresentationTime(state) - (event.combatTick ?? event.tick) : null;
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
    if (this.frameLaneTime === null) this.lanePresentationTime(state);
    const input = this.cameraInput(state, field) ?? { fieldWidth: field.width, laneWidth: CONFIG.sim.laneWidthPx, partyXs: [], threats: [] };
    const next = stepCombatCamera(this.cameraTranslation, input);
    const effect = this.legendaryEffects.current(performance.now(), this.ui.reducedMotion);
    const hitstop = effect?.layers.find(layer => layer.type === 'hitstop');
    const hold = Number(hitstop?.params.holdMs ?? 0), slow = Number(hitstop?.params.slowFactor ?? 1);
    const applied = presentationHitstop(hitstop && effect ? { holdMs: hold, slowFactor: slow } : null, this.frameSimJump, TICK_MS);
    if (applied && effect && effect.age < applied.holdMs) { this.frameCamera = this.cameraTranslation; return this.cameraTranslation; }
    const factor = applied ? applied.slowFactor : 1;
    const interpolated = this.cameraTranslation + (next - this.cameraTranslation) * Math.max(0, Math.min(1, factor));
    this.cameraTranslation = interpolated;
    this.frameCamera = interpolated;
    return interpolated;
  }
  private lanePresentationTime(state: GameState): number {
    if (this.frameLaneTime !== null) return this.frameLaneTime;
    const now = performance.now(), base = presentationCombatTime(state);
    const prior = this.priorLaneSim;
    this.priorLaneSim = base;
    this.frameSimJump = prior === null || base < prior ? 0 : base - prior;
    const effect = this.legendaryEffects.current(now, false), hitstop = effect?.layers.find(layer => layer.type === 'hitstop');
    const hold = Number(hitstop?.params.holdMs ?? 0), slow = Number(hitstop?.params.slowFactor ?? 1);
    const applied = presentationHitstop(hitstop && effect ? { holdMs: hold, slowFactor: slow } : null, this.frameSimJump, TICK_MS);
    const sample = this.laneClock.sample(base, applied, effect?.age ?? 0, this.framePaused, this.ui.reducedMotion, `${state.seed}:${state.encounter}`);
    this.frameLaneSample = base;
    this.frameLaneRate = sample.rate; this.frameLaneTime = sample.time; return sample.time;
  }
  private lanePosition(id: string, target: number, rate = this.frameLaneRate): number {
    if (!this.rendering) return Math.round(target);
    return this.lanePositions.sample(id, target, rate, this.frameLaneSample);
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
    const now = this.lanePresentationTime(state);
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
    // Leap placement already follows the presentation clock above, so its target delta is slowed there.
    const rate = action && (action.state === 'windup' || action.state === 'recovery') && action.delivery === 'leap' ? 1 : this.frameLaneRate;
    return this.lanePosition(unit.id, Math.round(field.x + screenX), rate);
  }
  private latest(state: GameState, predicate: (event: GameEvent) => boolean): GameEvent | undefined {
    for (let i = state.events.length - 1; i >= 0; i -= 1) { const event = state.events[i]; if (event && predicate(event)) return event; }
    return undefined;
  }
  private animation(state: GameState, unit: Unit, key: string | undefined): { name: AnimationName; ageMs: number; returning?: boolean } {
    const now = this.lanePresentationTime(state);
    const age = (event: GameEvent | undefined): number => {
      if (!event) return Infinity;
      const ticks = event.combatEncounter !== state.encounter ? null : this.lanePresentationTime(state) - (event.combatTick ?? event.tick);
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
    this.framePaused = paused;
    this.frameCamera = null;
    this.frameLaneTime = null;
    this.lanePositions.beginFrame();
    this.lanePresentationTime(state);
    const ctx = this.ctx, view = CONFIG.view, palette = CONFIG.ui.palette, height = this.ui.height();
    if (!this.effectEventsInitialized) { this.effectEventSeq = state.eventSeq; this.effectEventsInitialized = true; }
    this.effectEventSeq = consumeNewEvents(state.eventSeq, this.effectEventSeq, state.events, event => {
      triggerLegendaryEvent(event, state.party, state.enemies, value => this.legendaryEffects.trigger(value.kind, performance.now(), value.label, value));
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
    const bossBar = bossHpBar(state);
    // Boss plate sits at the top of the effects ceiling so scale-2 sprites keep the core strip
    // and party HP / status rows (around coreY - 6) never collide with the name or telegraph.
    const bossBarX = Math.round(field.x + 24), bossBarW = Math.max(120, Math.round(field.width - 48));
    const bossBarH = Math.max(14, BODY + 2);
    const bossTelegraphGap = 2;
    const bossTelegraphH = bossBar?.telegraph ? BODY + 2 : 0;
    const bossPlateBlock = bossBarH + (bossTelegraphH > 0 ? bossTelegraphGap + bossTelegraphH : 0);
    const bossBarY = bossBar ? 8 : coreY;
    const bossPlateBottom = bossBar ? bossBarY + bossPlateBlock : coreY;
    const unitHpBaseY = coreY + CONFIG.ui.unitHpBars.coreLocalY;
    const enemies = state.enemies;
    const units = [...state.party, ...enemies].sort((a, b) => this.position(a, state) - this.position(b, state));
    const turnActor = units.find(unit => {
      const action = unit.action;
      return unit.hp > 0 && action && (action.state === 'windup' || action.state === 'recovery');
    });
    const dimOthers = !!turnActor && !this.ui.reducedMotion;
    for (const unit of units) {
      const x = this.position(unit, state);
      const depth = unit.side === 'hero' ? unit.slot * 4 : 0;
      const unitBaseline = baselineY - depth;
      const enemyDef = unit.side === 'enemy' ? getPartyEnemyDefinition(unit.sourceId) : undefined;
      const enemyVisual = enemyDef?.visualKind;
      const color = unit.side === 'hero' ? view.roleColors[heroConfig(unit.sourceId).role] : view.enemyColors[enemyVisual!];
      const key = unit.side === 'hero'
        ? Object.entries(view.heroAssets).find(([id]) => id === unit.sourceId)?.[1]
        : (enemyDef?.heroSprite ?? view.enemyAssets[enemyVisual!]);
      const anim = this.animation(state, unit, key);
      const lastHit = this.latest(state, event => event.data.type === 'hit' && event.data.targetId === unit.id);
      const lastHitAge = lastHit && lastHit.combatEncounter === state.encounter ? this.lanePresentationTime(state) - (lastHit.combatTick ?? lastHit.tick) : null;
      const flash = lastHit !== undefined && lastHitAge !== null && lastHitAge * TICK_MS < view.hitFlashMs;
      const flip = anim.returning ? unit.side === 'hero' : unit.facing === -1;
      const bossScale = unit.boss && enemyDef?.scale ? Math.max(1, Math.round(enemyDef.scale)) : 1;
      const isLaneBoss = !!(unit.boss && isBossEnemyId(unit.sourceId));
      const isTurnActor = turnActor?.id === unit.id;
      if (isLaneBoss && enemyDef?.outline) {
        // Ground mark only; tint/outline live on the sprite itself.
        ctx.fillStyle = enemyDef.outline;
        ctx.fillRect(Math.round(x - 18 * bossScale), unitBaseline - 2, Math.round(36 * bossScale), 3);
      }
      if (isTurnActor) {
        // 2 px role-coloured floor under the acting sprite (windup or recovery).
        // Drawn after the lane-boss mark so the full 2 px stays visible under a boss windup.
        ctx.fillStyle = color;
        ctx.fillRect(Math.round(x - 16 * bossScale), unitBaseline, Math.round(32 * bossScale), 2);
      }
      // Plate is painted after units, so scale-2 bosses stay unclipped and read as large.
      const tint = isLaneBoss ? enemyDef?.tint : undefined;
      const outline = isLaneBoss ? enemyDef?.outline : undefined;
      const dimSprite = dimOthers && !isTurnActor && unit.hp > 0;
      if (dimSprite) { ctx.save(); ctx.globalAlpha = 0.7; }
      if (!key || !this.atlases.draw(ctx, key, anim.name, anim.ageMs, x, unitBaseline, flip, bossScale, flash, tint, outline)) {
        const w = unit.boss ? view.bossWidth * bossScale : view.heroWidth, h = unit.boss ? view.bossHeight * bossScale : view.heroHeight;
        ctx.fillStyle = unit.hp <= 0 ? '#52616b' : (enemyDef?.tint ?? color);
        ctx.fillRect(x - w / 2, unitBaseline - h, w, h);
      }
      if (dimSprite) ctx.restore();
      if (unit.hp <= 0) continue;
      const hpWidth = unit.side === 'hero' ? 34 : 32;
      // Boss status icons hang just under the plate; party bars keep their usual ceiling slot.
      const statusClearance = (statusEffectsConfig()?.display.rowOffsetAboveHpPx ?? 13) + 2;
      const hpY = isLaneBoss ? bossPlateBottom + statusClearance : unitHpBaseY - depth;
      // Boss uses the top-of-lane HP plate; skip the tiny per-unit bar, but still draw status icons.
      if (!isLaneBoss) {
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
      this.drawStatusRow(ctx, state, unit, x, hpY);
    }
    if (turnActor && turnActor.action?.state === 'windup') {
      this.drawTurnSkillName(ctx, state, turnActor, baselineY, bossPlateBottom);
    }
    if (bossBar) {
      const barX = bossBarX, barW = bossBarW, barY = bossBarY, barH = bossBarH;
      const measure = (value: string): number => this.ui.measureText(value, BODY, true);
      ctx.fillStyle = palette.ink; ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
      ctx.fillStyle = '#1a1014'; ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = bossBar.enraged ? '#ff6b3d' : '#d44a4a';
      ctx.fillRect(barX, barY, Math.max(0, Math.round(barW * bossBar.ratio)), barH);
      ctx.fillStyle = '#3a2024'; ctx.fillRect(barX, barY + barH - 2, barW, 2);
      const hpRaw = `${bossBar.hp}/${bossBar.maxHp}${bossBar.enraged ? '  ENRAGED' : ''}`;
      const hpText = ellipsize(hpRaw, barW, measure);
      const hpWidth = measure(hpText);
      const nameMax = Math.max(0, barW - hpWidth - 8);
      const nameText = ellipsize(bossBar.name, nameMax > 0 ? nameMax : barW, measure);
      const textY = barY + Math.round((barH - BODY) / 2);
      this.ui.text(ctx, nameText, barX + 2, textY, '#f2e9cf', BODY, true);
      this.ui.text(ctx, hpText, barX + barW - hpWidth - 2, textY, '#f2e9cf', BODY, true);
      if (bossBar.telegraph) {
        const telegraphY = barY + barH + bossTelegraphGap;
        const telegraphWidth = measure(bossBar.telegraph);
        const telegraphX = barX + Math.round((barW - telegraphWidth) / 2);
        ctx.fillStyle = 'rgba(40,12,12,.92)';
        ctx.fillRect(Math.max(barX, telegraphX - 6), telegraphY, Math.min(barW, telegraphWidth + 12), bossTelegraphH);
        this.ui.text(ctx, bossBar.telegraph, telegraphX, telegraphY + Math.round((bossTelegraphH - BODY) / 2), '#ffd16e', BODY, true);
      }
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
          const enemyDef = getPartyEnemyDefinition(enemy.sourceId);
          const plateOwnsTelegraph = !!(enemy.boss && isBossEnemyId(enemy.sourceId) && bossBar?.telegraph);
          let telegraphLabel = special.global ? 'GLOBAL' : null;
          if (enemyDef.enrage && special.abilityId === enemyDef.enrage.abilityId) telegraphLabel = enemyDef.enrage.telegraphLabel;
          else if (enemyDef.special && (enemyDef.special.kind === 'bossLocal' || enemyDef.special.kind === 'bossGlobal')) telegraphLabel = enemyDef.special.telegraphLabel;
          if (special.global) {
            for (const ally of state.party.filter(unit => unit.hp > 0)) { const allyX = this.position(ally, state); ctx.beginPath(); ctx.arc(allyX, baselineY - 18, 20, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
          } else {
            ctx.beginPath(); ctx.arc(sx(special.centerX), baselineY - 18, special.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
          // Boss plate already owns the telegraph label; skip the world cue so it cannot overlap the name.
          if (telegraphLabel && !plateOwnsTelegraph) {
            const labelX = Math.max(field.x + 30, Math.min(field.x + field.width - 30, sx(special.centerX)));
            this.ui.text(ctx, telegraphLabel, labelX, baselineY - 52, special.global ? '#ff7772' : '#ffd16e', BODY, true);
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
        const direction = Math.sign(destination - projectile.x) || 1, x = this.lanePosition(projectile.id, sx(projectile.x)), y = baselineY - 27;
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
    const labelClock = this.lanePresentationTime(state);
    const statusDisplay = statusEffectsConfig()?.display;
    const groups = new Map<string, { targetId: string; tick: number; amount: number; heal: boolean; dot: boolean }>();
    for (const event of state.events) {
      const data = event.data;
      const ageTicks = event.combatEncounter === state.encounter ? labelClock - (event.combatTick ?? event.tick) : null;
      if (ageTicks === null || ageTicks > lifetime || (data.type !== 'hit' && data.type !== 'heal')) continue;
      const eventTick = labelClock - ageTicks;
      const isDot = data.type === 'hit' && Boolean(data.dot);
      const key = data.type === 'hit'
        ? (isDot ? `${data.targetId}:dot:${Math.floor(eventTick / bucket)}` : `${data.targetId}:hit:${Math.floor(eventTick / bucket)}`)
        : `${data.targetId}:heal:${Math.floor(eventTick / bucket)}`;
      const old = groups.get(key);
      const amount = data.type === 'hit' ? data.damage : data.amount;
      if (old) old.amount += amount; else groups.set(key, { targetId: data.targetId, tick: eventTick, amount, heal: data.type === 'heal', dot: isDot });
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
      const color = group.heal
        ? (statusDisplay?.hotNumber ?? palette.green)
        : group.dot ? (statusDisplay?.dotNumber ?? '#de7c80') : palette.gold;
      this.ui.text(ctx, label, x, y, color, BODY, true);
    }
    // STUN / RESIST floating labels from presentation status events.
    for (const event of state.events) {
      const data = event.data;
      if (data.type !== 'status' || (data.kind !== 'skip' && data.kind !== 'resist')) continue;
      const ageTicks = event.combatEncounter === state.encounter ? labelClock - (event.combatTick ?? event.tick) : null;
      if (ageTicks === null) continue;
      const maxAge = data.kind === 'skip' ? ticksForSeconds(0.6) : ticksForSeconds(0.5);
      if (ageTicks > maxAge) continue;
      const unit = units.find(unit => unit.id === data.targetId); if (!unit || unit.hp <= 0) continue;
      const text = data.kind === 'skip' ? 'STUN' : 'RESIST';
      const color = data.kind === 'skip' ? STATUS_GOLD : STATUS_MUTED;
      const x = this.position(unit, state);
      const y = Math.max(8, baselineY - 56);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) this.ui.text(ctx, text, x + (dx ?? 0), y + (dy ?? 0), palette.ink, BODY, true);
      this.ui.text(ctx, text, x, y, color, BODY, true);
    }
    ctx.restore();
    this.ui.draw(ctx, state, this.width, coreY, paused, this.zoom / this.dpr);
    this.drawFeedback(ctx, state, units, field, coreY);
    this.drawLegendaryEffect(ctx, state, field, coreY);
    this.lanePositions.endFrame();
    this.rendering = false; this.frameLaneTime = null;
  }
  /** One-line skill callout above a windup actor; skipped for lane bosses and while a legendary skill showcase owns the strip. */
  private drawTurnSkillName(ctx: CanvasRenderingContext2D, state: GameState, actor: Unit, baselineY: number, bossPlateBottom: number): void {
    if (actor.boss && isBossEnemyId(actor.sourceId)) return;
    const showcase = this.legendaryEffects.current(performance.now(), this.ui.reducedMotion);
    if (showcase?.kind === 'skill') return;
    const name = skillShortName(actor.action && 'abilityId' in actor.action ? actor.action.abilityId : undefined);
    if (!name) return;
    const depth = actor.side === 'hero' ? actor.slot * 4 : 0;
    const unitBaseline = baselineY - depth;
    const x = this.position(actor, state);
    const field = this.field();
    const color = actor.side === 'hero'
      ? CONFIG.view.roleColors[heroConfig(actor.sourceId).role]
      : CONFIG.view.enemyColors[getPartyEnemyDefinition(actor.sourceId)?.visualKind ?? 'grunt'];
    const y = Math.max(bossPlateBottom + 2, unitBaseline - 54);
    // Clamp into the field with 1 px for the ink outline so rear-slot names (x≈20) stay fully visible.
    const clampNameX = (width: number): number => {
      const minX = field.x + 1;
      const maxX = field.x + field.width - 1 - Math.ceil(width);
      return Math.max(minX, Math.min(maxX, Math.round(x - width / 2)));
    };
    if (!this.pixelFontReady) {
      const width = this.ui.measureText(name, SMALL, true);
      this.ui.text(ctx, name, clampNameX(width), y, color, SMALL, true);
      return;
    }
    ctx.save();
    ctx.font = `700 ${SMALL}px "Galmuri11", monospace`;
    ctx.textBaseline = 'top';
    const width = ctx.measureText(name).width;
    const tx = clampNameX(width);
    ctx.fillStyle = CONFIG.ui.palette.ink;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) ctx.fillText(name, tx + dx, y + dy);
    ctx.fillStyle = color;
    ctx.fillText(name, tx, y);
    ctx.restore();
  }
  private drawStatusRow(ctx: CanvasRenderingContext2D, state: GameState, unit: Unit, x: number, hpY: number): void {
    const config = statusEffectsConfig();
    if (!config) return;
    const display = config.display;
    const iconPx = display.iconPx, gap = display.gapPx;
    const maxVisible = isStatusBoss(unit) ? display.maxVisibleBoss : display.maxVisible;
    const expireGrey = '#536276';
    const expireHold = ticksForSeconds(0.16);
    type RowItem = {
      glyph: StatusGlyphId; id: string; turnsLeft: number; stacks: number; appliedAtTick: number;
      showCounter: boolean; flash: boolean; grey: boolean; pop: boolean;
    };
    const now = this.lanePresentationTime(state);
    const reduced = this.ui.reducedMotion;
    const items: RowItem[] = [];
    const glyphSet = new Set<string>(STATUS_GLYPH_IDS);
    const livingIds = new Set<string>();
    for (const status of unit.statuses ?? []) {
      if (status.targetId !== unit.id) continue;
      const glyphId = (status.display === 'crushed' ? 'crushed' : status.id);
      if (!glyphSet.has(glyphId)) continue;
      livingIds.add(glyphId);
      const applied = state.events.filter(event =>
        event.data.type === 'status' && event.data.targetId === unit.id && event.data.statusId === status.id
        && (event.data.kind === 'apply' || event.data.kind === 'refresh' || event.data.kind === 'stack')
        && event.combatEncounter === state.encounter).at(-1);
      const age = applied ? now - (applied.combatTick ?? applied.tick) : 999;
      const kind = applied && applied.data.type === 'status' ? applied.data.kind : undefined;
      items.push({
        glyph: glyphId as StatusGlyphId, id: glyphId, turnsLeft: status.turnsLeft, stacks: status.stacks,
        appliedAtTick: status.appliedAtTick ?? 0, showCounter: true,
        flash: !reduced && age >= 0 && age < 2,
        pop: !reduced && kind === 'apply' && age >= 0 && age < 2,
        grey: false,
      });
    }
    // Expiry hold: keep the icon grey for 160 ms after the expire event (skip under reduced motion).
    if (!reduced) {
      for (const event of state.events) {
        const data = event.data;
        if (data.type !== 'status' || data.kind !== 'expire' || data.targetId !== unit.id) continue;
        if (event.combatEncounter !== state.encounter) continue;
        const displayId = data.statusId;
        if (!glyphSet.has(displayId) || livingIds.has(displayId)) continue;
        const age = now - (event.combatTick ?? event.tick);
        if (age < 0 || age > expireHold) continue;
        items.push({
          glyph: displayId as StatusGlyphId, id: displayId, turnsLeft: 0, stacks: data.stacks,
          appliedAtTick: event.combatTick ?? event.tick, showCounter: false,
          flash: false, pop: false, grey: true,
        });
      }
    }
    if (unit.shield > 0 && unit.shieldUntilTick > presentationCombatTime(state)) {
      items.push({
        glyph: 'shield', id: 'shield', turnsLeft: 99, stacks: 1, appliedAtTick: unit.shieldUntilTick,
        showCounter: false, flash: false, pop: false, grey: false,
      });
    }
    items.sort((a, b) => compareStatusDisplay(
      { id: a.id, turnsLeft: a.turnsLeft, appliedAtTick: a.appliedAtTick },
      { id: b.id, turnsLeft: b.turnsLeft, appliedAtTick: b.appliedAtTick },
    ));
    const overflow = items.length > maxVisible ? items.length - (maxVisible - 1) : 0;
    const visible = overflow > 0 ? items.slice(0, maxVisible - 1) : items.slice(0, maxVisible);
    const chipW = overflow > 0 ? 7 : 0;
    const rowW = visible.length * iconPx + Math.max(0, visible.length - 1) * gap + (overflow > 0 ? gap + chipW : 0);
    const rowLeft = Math.round(x - rowW / 2);
    const rowTop = Math.round(hpY - display.rowOffsetAboveHpPx);
    let cursor = rowLeft;
    for (const item of visible) {
      const y = rowTop - (item.pop ? 1 : 0);
      const base = statusFrameFor(item.id);
      const colors = item.grey
        ? { frame: expireGrey, fill: base.fill }
        : item.flash ? { frame: STATUS_LIGHT, fill: base.fill } : base;
      drawStatusGlyph(ctx, item.glyph, cursor, y, colors, item.grey ? expireGrey : undefined);
      if (item.showCounter && item.turnsLeft >= 1 && item.turnsLeft <= 9) {
        const digitColor = item.grey ? expireGrey : item.turnsLeft === 1 ? (display.lastTurnDigit ?? STATUS_GOLD) : STATUS_LIGHT;
        ctx.fillStyle = '#0d121b';
        ctx.fillRect(cursor + 4, y + 2, 5, 7);
        drawDigit3x5(ctx, item.turnsLeft, cursor + 5, y + 3, digitColor);
      }
      if (item.glyph === 'dot' && item.stacks >= 2) {
        ctx.fillStyle = '#0d121b';
        ctx.fillRect(cursor, y, 5, 7);
        drawDigit3x5(ctx, item.stacks, cursor + 1, y + 1, item.grey ? expireGrey : STATUS_LIGHT);
      }
      cursor += iconPx + gap;
    }
    if (overflow > 0) drawOverflowChip(ctx, overflow, cursor, rowTop);
  }

  private drawLegendaryEffect(ctx: CanvasRenderingContext2D, state: GameState, field: { x: number; width: number }, coreY: number): void {
    const reducedMotion = this.ui.reducedMotion;
    const effect = this.legendaryEffects.current(performance.now(), reducedMotion); if (!effect) return;
    const gold = CONFIG.ui.rarity.legendary.frame;
    const bannerX = Math.floor(field.x + field.width / 2);
    const anchor = effect.anchorId ? [...state.party, ...state.enemies].find(unit => unit.id === effect.anchorId) : undefined;
    const anchorX = anchor ? this.position(anchor, state) : bannerX;
    const cy = coreY + 10;
    const has = (type: string) => effect.layers.find(layer => layer.type === type);
    ctx.save(); ctx.imageSmoothingEnabled = false;
    const shake = has('shake');
    if (shake && !reducedMotion) { const cadence = Number(shake.params.cadenceMs ?? 45), offset = Math.floor(effectRandom(effect.seed, Math.floor((effect.age - shake.startMs) / cadence)) * 5) - 2; ctx.translate(offset, 0); }
    if (reducedMotion) {
      if (effect.kind === 'drop') this.drawLegendaryDropCard(ctx, anchorX, cy + 23, gold, effect.slot, 48, true);
      this.drawLegendaryBanner(ctx, effect.label, bannerX, 8, gold, 4, effect.age, effect.spec.durationMs, true);
    } else {
      if (has('flash')) {
        const age = effect.age - has('flash')!.startMs;
        const pulse = age < 100 || age >= 210 && age < 315 ? 1 : age < 175 || age >= 315 ? 0.45 : 0.15;
        ctx.save(); this.drawPixelFrame(ctx, field, coreY, gold, pulse * Number(has('flash')!.params.intensity ?? 1)); ctx.restore();
      }
      if (has('borderPulse')) { const pulse = Math.floor((effect.age - has('borderPulse')!.startMs) / 220) % 2 === 0 ? 1 : 0.55; ctx.save(); this.drawPixelFrame(ctx, field, coreY, gold, pulse * 0.85); ctx.restore(); }
      if (effect.kind === 'skill') {
        const sheet = has('sheet');
        if (has('flash')) { ctx.save(); ctx.globalAlpha = effect.age < 110 ? 0.20 : effect.age < 330 ? 0.10 : 0; ctx.fillStyle = gold; ctx.fillRect(field.x, 0, field.width, coreY + 54); ctx.restore(); }
        if (sheet) {
          const age = effect.age - sheet.startMs, frameMs = Number(sheet.params.frameMs ?? 80), frame = Math.floor(age / frameMs);
          const sheetOpacity = age < 190 ? 1 : age < 760 ? 0.88 : age < 880 ? 0.66 : age < 1000 ? 0.44 : 0.22;
          ctx.save(); ctx.globalAlpha = sheetOpacity;
          if (this.signatureSheet?.complete && this.signatureSheet.naturalWidth) { const frameCount = Math.floor(this.signatureSheet.naturalWidth / 96); ctx.drawImage(this.signatureSheet, Math.min(frameCount - 1, frame) * 96, 0, 96, 80, anchorX - 96, cy - 80, 192, 160); }
          else if (this.holySheet?.complete && this.holySheet.naturalWidth) { const holyFrame = Math.min(Math.floor(this.holySheet.naturalWidth / 80) - 1, Math.floor(age / frameMs)); ctx.drawImage(this.holySheet, holyFrame * 80, 0, 80, 120, anchorX - 60, cy - 60, 120, 120); }
          ctx.restore();
        }
        const rayLayer = has('rays'), particleLayer = has('particles');
        if (rayLayer || particleLayer) this.drawLegendaryBurst(ctx, anchorX, cy, effect, gold, rayLayer, particleLayer);
        const banner = has('banner');
        this.drawLegendaryBanner(ctx, effect.label, bannerX, 8, gold, this.bannerScale(effect.age - (banner?.startMs ?? 0), Number(banner?.params.stepMs ?? 48), Number(banner?.params.entranceMs ?? 240)), effect.age, Number(banner?.params.holdMs ?? 1120), false);
      } else {
        const beam = has('beam'); if (beam) this.drawDropBeam(ctx, anchorX, effect.age - beam.startMs, beam.endMs - beam.startMs, gold, Number(beam.params.width ?? 24));
        const sheet = has('sheet');
        if (sheet && this.treasureSheet?.complete && this.treasureSheet.naturalWidth) {
          const age = effect.age - sheet.startMs, frame = Math.min(Math.floor(this.treasureSheet.naturalWidth / 48) - 1, Math.floor(age / Number(sheet.params.frameMs ?? 62)));
          const sheetOpacity = age < 760 ? 1 : age < 880 ? 0.75 : age < 1000 ? 0.5 : age < 1120 ? 0.25 : 0;
          ctx.save(); ctx.globalAlpha = sheetOpacity; ctx.drawImage(this.treasureSheet, frame * 48, 0, 48, 48, anchorX - 48, cy - 48, 96, 96); ctx.restore();
        }
        const particles = has('particles'), rays = has('rays'); if (particles || rays) this.drawLegendaryBurst(ctx, anchorX, cy, effect, gold, rays, particles);
        const card = has('cardPop'); if (card) {
          const age = effect.age - card.startMs, stage = dropCardSize(age, Number(card.params.stepMs ?? 48), Number(card.params.popMs ?? 240));
          const fadeAge = age - Number(card.params.fadeStartMs ?? 1740), fadeStep = Number(card.params.fadeStepMs ?? 90);
          const alpha = fadeAge < 0 ? 1 : fadeAge < fadeStep ? 0.75 : fadeAge < fadeStep * 2 ? 0.5 : 0.25;
          ctx.save(); ctx.globalAlpha = alpha; this.drawLegendaryDropCard(ctx, anchorX, cy + 23, gold, effect.slot, stage, false, effect.age); ctx.restore();
        }
        const banner = has('banner');
        this.drawLegendaryBanner(ctx, effect.label, bannerX, 8, gold, this.bannerScale(effect.age - (banner?.startMs ?? 0), Number(banner?.params.stepMs ?? 48), Number(banner?.params.entranceMs ?? 240)), effect.age, Number(banner?.params.holdMs ?? 1450), false);
      }
    }
    ctx.restore();
  }
  private bannerScale(age: number, stepMs: number, entranceMs: number): number { return age < entranceMs ? [0, 1, 2, 3, 4][Math.min(4, Math.floor(age / stepMs))]! : 4; }
  private drawLegendaryBanner(ctx: CanvasRenderingContext2D, label: string, cx: number, y: number, gold: string, stage: number, age: number, holdMs: number, staticMode: boolean): void {
    if (!this.pixelFontReady) return;
    const width = Math.min(340, Math.max(208, label.length * 9 + 42)), height = 34, visibleWidth = Math.floor(width * stage / 4), x = Math.floor(cx - visibleWidth / 2);
    if (!visibleWidth) return;
    ctx.save(); ctx.globalAlpha = staticMode ? 1 : age <= holdMs ? 1 : age < holdMs + 180 ? 0.5 : 0;
    ctx.beginPath(); ctx.rect(x, y, visibleWidth, height); ctx.clip();
    ctx.fillStyle = '#101c27'; ctx.fillRect(x, y, width, height); ctx.fillStyle = '#735329'; ctx.fillRect(x + 3, y + 3, width - 6, height - 6);
    ctx.fillStyle = '#202c39'; ctx.fillRect(x + 5, y + 5, width - 10, height - 10); ctx.fillStyle = gold; ctx.fillRect(x, y, width, 3); ctx.fillRect(x, y + height - 3, width, 3); ctx.fillRect(x, y, 3, height); ctx.fillRect(x + width - 3, y, 3, height);
    ctx.fillStyle = '#fff4bf'; ctx.fillRect(x + 8, y + 8, 3, 3); ctx.fillRect(x + width - 11, y + 8, 3, 3);
    ctx.font = '700 9px "Galmuri11", monospace'; ctx.textBaseline = 'top'; ctx.fillStyle = '#fff4bf'; ctx.fillText('LEGENDARY', x + 12, y + 5);
    ctx.font = '700 12px "Galmuri11", monospace'; const text = label.toUpperCase(), textWidth = ctx.measureText(text).width, tx = Math.floor(cx - textWidth / 2), ty = y + 17;
    ctx.fillStyle = '#101720'; for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) ctx.fillText(text, tx + dx!, ty + dy!);
    ctx.fillStyle = '#fff0b1'; ctx.fillText(text, tx, ty);
    if (!staticMode && age < 920) { ctx.globalAlpha = 0.8; ctx.fillStyle = '#fff'; const shineX = x + 8 + Math.floor((age % 460) / 460 * (width - 16)); ctx.fillRect(shineX, y + 5, 3, height - 10); }
    ctx.restore();
  }
  private drawPixelFrame(ctx: CanvasRenderingContext2D, field: { x: number; width: number }, coreY: number, gold: string, alpha: number): void {
    const h = coreY + 54; ctx.globalAlpha = alpha; ctx.fillStyle = gold; ctx.fillRect(field.x, 0, field.width, 4); ctx.fillRect(field.x, h - 4, field.width, 4); ctx.fillRect(field.x, 0, 4, h); ctx.fillRect(field.x + field.width - 4, 0, 4, h);
    ctx.globalAlpha = alpha * 0.55; ctx.fillStyle = '#fff4bf'; ctx.fillRect(field.x + 4, 4, field.width - 8, 2); ctx.fillRect(field.x + 4, h - 6, field.width - 8, 2); ctx.fillRect(field.x + 4, 4, 2, h - 8); ctx.fillRect(field.x + field.width - 6, 4, 2, h - 8);
  }
  private drawLegendaryBurst(ctx: CanvasRenderingContext2D, cx: number, cy: number, effect: NonNullable<ReturnType<LegendaryEffects['current']>>, gold: string, rayLayer?: { startMs: number; endMs: number; params: Record<string, number | string | boolean> }, particleLayer?: { startMs: number; endMs: number; params: Record<string, number | string | boolean> }): void {
    const layer = rayLayer ?? particleLayer; if (!layer) return;
    const age = effect.age - layer.startMs, duration = layer.endMs - layer.startMs, growth = Math.min(1, age / 240), shrink = age < duration * 0.55 ? 1 : Math.max(0, 1 - (age - duration * 0.55) / (duration * 0.45));
    const radius = Math.floor((14 + 60 * growth) * shrink), alpha = age < 180 ? 1 : age < duration * 0.7 ? 0.85 : 0.42;
    if (rayLayer) {
      const count = Number(rayLayer.params.count ?? 8);
      for (let i = 0; i < count; i++) {
        const angle = i * Math.PI * 2 / count + Math.floor(age / Number(rayLayer.params.cadenceMs ?? 90)) * 0.035, outer = radius + (i % 2) * 7;
        const x2 = Math.round(cx + Math.cos(angle) * outer), y2 = Math.round(cy + Math.sin(angle) * outer);
        ctx.save(); ctx.globalAlpha = alpha * 0.68; ctx.fillStyle = i % 2 ? '#fff4bf' : gold;
        let x = cx, y = cy; const dx = Math.abs(x2 - x), sx = x < x2 ? 1 : -1, dy = -Math.abs(y2 - y), sy = y < y2 ? 1 : -1; let err = dx + dy;
        for (;;) { ctx.fillRect(x, y, 2, 2); if (x === x2 && y === y2) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x += sx; } if (e2 <= dx) { err += dx; y += sy; } }
        ctx.restore();
      }
    }
    ctx.globalAlpha = alpha; ctx.fillStyle = '#fff4bf'; ctx.fillRect(cx - 5, cy - 5, 10, 10); ctx.fillStyle = gold; ctx.fillRect(cx - 2, cy - 2, 4, 4);
    if (particleLayer) {
      const count = Number(particleLayer.params.count ?? 28);
      const particleAge = effect.age - particleLayer.startMs, particleDuration = particleLayer.endMs - particleLayer.startMs;
      for (let i = 0; i < count; i++) {
        const angle = effectRandom(effect.seed, i) * Math.PI * 2, speed = 0.035 + effectRandom(effect.seed, i + 80) * 0.07, t = Math.max(0, particleAge - 80), x = Math.round(cx + Math.cos(angle) * t * speed), y = Math.round(cy + Math.sin(angle) * t * speed + t * t * 0.000055), life = Math.max(0, 1 - t / (particleDuration * 0.9));
        ctx.save(); ctx.globalAlpha = (life > 0.66 ? 1 : life > 0.33 ? 0.65 : 0.32) * alpha; ctx.fillStyle = i % 3 ? gold : '#fff4bf'; ctx.fillRect(x, y, i % 4 === 0 ? 2 : 1, i % 4 === 0 ? 2 : 1); ctx.restore();
      }
    }
  }
  private drawDropBeam(ctx: CanvasRenderingContext2D, cx: number, age: number, duration: number, gold: string, maxWidth: number): void {
    if (age >= duration) return; const width = age < 120 ? 4 + Math.floor(age / 4) : age < Math.floor(duration * 0.53) ? maxWidth + 10 : Math.max(8, maxWidth + 10 - Math.floor((age - Math.floor(duration * 0.53)) / 15));
    ctx.save(); ctx.globalAlpha = age < 300 ? 0.78 : age < 540 ? 0.55 : 0.25; ctx.fillStyle = gold; ctx.fillRect(cx - Math.floor(width / 2), 0, width, 104); ctx.globalAlpha *= 0.55; ctx.fillRect(cx - Math.floor(width / 2) - 4, 0, 3, 104); ctx.fillRect(cx + Math.floor(width / 2) + 1, 0, 3, 104); ctx.globalAlpha = 0.95; ctx.fillStyle = '#fff4bf'; ctx.fillRect(cx - 3, 0, 6, 104); ctx.restore();
  }
  private drawLegendaryDropCard(ctx: CanvasRenderingContext2D, cx: number, cy: number, gold: string, slot: string | undefined, size: number, staticMode: boolean, age = 0): void {
    const x = Math.floor(cx - size / 2), y = Math.floor(cy - size / 2), pulse = staticMode ? 0 : Math.floor(age / 120) % 2;
    ctx.save();
    ctx.fillStyle = '#101720'; ctx.fillRect(x - 4, y - 4, size + 8, size + 8); ctx.fillStyle = '#735329'; ctx.fillRect(x, y, size, size); ctx.fillStyle = '#202c39'; ctx.fillRect(x + 3, y + 3, size - 6, size - 6);
    ctx.fillStyle = pulse ? '#fff4bf' : gold; ctx.fillRect(x - 3, y - 3, size + 6, 2); ctx.fillRect(x - 3, y + size + 1, size + 6, 2); ctx.fillRect(x - 3, y - 3, 2, size + 6); ctx.fillRect(x + size + 1, y - 3, 2, size + 6);
    ctx.fillStyle = staticMode || pulse ? gold : '#fff4bf'; ctx.fillRect(x - 5, y - 5, size + 10, 1); ctx.fillRect(x - 5, y + size + 4, size + 10, 1);
    const icon = slot === 'armor' ? this.legendaryArmor : slot === 'charm' ? this.legendaryCharm : this.legendarySword, inset = Math.floor((size - 32) / 2);
    if (icon?.complete && icon.naturalWidth) ctx.drawImage(icon, x + inset, y + inset, 32, 32);
    else { ctx.fillStyle = gold; ctx.fillRect(cx - 2, y + inset, 4, 28); ctx.fillRect(cx - 7, y + inset + 16, 14, 4); }
    ctx.fillStyle = '#fff4bf'; ctx.fillRect(cx - 2, y - 8, 4, 12); ctx.fillRect(cx - 6, y - 4, 12, 4); ctx.restore();
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
