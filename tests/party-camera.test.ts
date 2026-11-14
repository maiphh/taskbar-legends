import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/config';
import { createPartyState, createState, step } from '../src/core/game';
import { spawnWave } from '../src/core/combat';
import { enemyFormationX } from '../src/core/party-combat';
import { formationScreenX } from '../src/core/turn/formation-view';
import type { GameState, Unit } from '../src/core/model';
import { stepCombatCamera, type CombatCameraInput } from '../src/party-camera';

function hold(unit: Unit): void {
  unit.action = { state: 'idle' };
  unit.moving = false;
  unit.gauge = 0;
  unit.statuses = [{ id: 'petrification', sourceId: 'hold', targetId: unit.id, stacks: 1, magnitude: 1, turnsLeft: 9999 }];
  unit.cooldown = Number.MAX_SAFE_INTEGER;
}

function cameraInputFromState(state: GameState, fieldWidth = 208): CombatCameraInput {
  const party = state.party.filter(unit => unit.hp > 0).map(unit => unit.x);
  const formationXs = state.enemies.filter(unit => unit.hp > 0).map(unit => enemyFormationX(unit.slot));
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
  return { fieldWidth, laneWidth: CONFIG.sim.laneWidthPx, partyXs: party, threats, formationXs };
}

function settle(input: CombatCameraInput, previous = 0): number {
  let translation = previous;
  for (let i = 0; i < 80; i += 1) translation = stepCombatCamera(translation, input);
  return translation;
}

function mockRendererDom(): void {
  vi.stubGlobal('window', {
    ...globalThis,
    location: { href: 'http://localhost/' },
    devicePixelRatio: 1,
    innerWidth: 640,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0, height: 0,
          getContext: () => ({
            setTransform() {}, clearRect() {}, drawImage() {}, fillRect() {},
            getImageData: () => ({ data: new Uint8ClampedArray(4) }),
            putImageData() {}, save() {}, restore() {},
            measureText: () => ({ width: 0 }),
            canvas: { width: 1, height: 1 },
            imageSmoothingEnabled: false,
            globalCompositeOperation: 'source-over',
            fillStyle: '',
          }),
          style: {},
        };
      }
      return {
        style: {}, classList: { add() {}, remove() {} },
        addEventListener() {}, removeEventListener() {},
        appendChild() { return null; }, setAttribute() {}, textContent: '',
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
      };
    },
    getElementById: () => null,
  });
  // @ts-expect-error Image stub for atlas load
  globalThis.Image = class { src = ''; decode = async () => undefined; naturalWidth = 1; naturalHeight = 1; };
  globalThis.matchMedia = (() => ({ matches: false, media: '', onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } })) as typeof matchMedia;
}

function makeRenderer() {
  mockRendererDom();
  const canvas = {
    width: 0, height: 0, style: {}, parentElement: { style: {} },
    getContext() {
      return {
        setTransform() {}, clearRect() {}, imageSmoothingEnabled: false,
        fillRect() {}, drawImage() {}, save() {}, restore() {},
        fillText() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
        measureText: () => ({ width: 0 }),
        canvas: { width: 0, height: 0 },
        font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
        translate() {}, scale() {},
      };
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 160 }),
  };
  const controls = { querySelectorAll: () => [], appendChild() { return null; }, removeChild() {}, addEventListener() {}, style: {} };
  return { canvas, controls };
}

describe('party-v2 compact combat camera', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('returns an integer translation', () => {
    const next = stepCombatCamera(0, {
      fieldWidth: 208,
      laneWidth: CONFIG.sim.laneWidthPx,
      partyXs: [140, 95, 50],
      threats: [{ deadline: 39, focusX: 50, xs: [292, 50, 82] }],
    });
    expect(Number.isInteger(next)).toBe(true);
  });

  it('slews at most 4px on every consecutive step of a free-party assassin leap while hero x stays fixed', () => {
    const state = createPartyState(252);
    state.highestCleared = 11;
    state.progress = { kind: 'PUSHING', stage: 12 };
    state.wave = 1;
    spawnWave(state);
    const assassin = state.enemies.find(unit => unit.sourceId === 'assassin')!;
    state.enemies = [assassin];
    assassin.action = { state: 'idle' };
    assassin.moving = false;
    assassin.x = 400;
    assassin.gauge = 10000;
    const partyXs = state.party.map(unit => unit.x);

    let translation = 0;
    const translations: number[] = [translation];
    let sawLeap = false;
    for (let i = 0; i < 80; i += 1) {
      step(state);
      const action = state.enemies.find(unit => unit.id === assassin.id)?.action;
      if (action?.state === 'windup' && action.delivery === 'leap') sawLeap = true;
      translation = stepCombatCamera(translation, cameraInputFromState(state));
      translations.push(translation);
      expect(state.party.map(unit => unit.x)).toEqual(partyXs);
    }
    expect(sawLeap).toBe(true);
    for (const value of translations) expect(Number.isInteger(value)).toBe(true);
    for (let i = 1; i < translations.length; i += 1) {
      expect(Math.abs(translations[i]! - translations[i - 1]!)).toBeLessThanOrEqual(4);
    }
  });

  it('moves at most 1px when a settled party x moves 1px across the fit boundary', () => {
    const fieldWidth = 208;
    const settledInput: CombatCameraInput = {
      fieldWidth,
      laneWidth: CONFIG.sim.laneWidthPx,
      partyXs: [0, 160],
      threats: [],
    };
    const translation = settle(settledInput);
    expect(translation).toBe(0);
    const shifted: CombatCameraInput = {
      ...settledInput,
      partyXs: [0, 161],
    };
    const next = stepCombatCamera(translation, shifted);
    expect(Math.abs(next - translation)).toBeLessThanOrEqual(1);
  });

  it('moves at most 1px per settled step when one party x walks 1px', () => {
    const fieldWidth = 208;
    let translation = 0;
    for (let far = 150; far <= 180; far += 1) {
      const input: CombatCameraInput = {
        fieldWidth,
        laneWidth: CONFIG.sim.laneWidthPx,
        partyXs: [100, far],
        threats: [],
      };
      translation = settle(input, translation);
      const next = stepCombatCamera(translation, {
        ...input,
        partyXs: [100, far + 1],
      });
      expect(Math.abs(next - translation)).toBeLessThanOrEqual(1);
      translation = next;
    }
  });

  it('keeps every living party x on screen when they fit in fieldWidth - 48', () => {
    const fieldWidth = 208;
    const input: CombatCameraInput = {
      fieldWidth,
      laneWidth: CONFIG.sim.laneWidthPx,
      partyXs: [200, 240],
      threats: [{ deadline: 10, focusX: 240, xs: [84, 200, 240] }],
    };
    expect(Math.max(...input.partyXs) - Math.min(...input.partyXs)).toBe(40);
    const translation = settle(input, 116);
    for (const x of input.partyXs) {
      expect(x).toBeGreaterThanOrEqual(translation);
      expect(x).toBeLessThanOrEqual(translation + fieldWidth);
    }
  });

  it('does not change a settled party translation for an assassin at x=400 beyond the party movement', () => {
    const fieldWidth = 208;
    const partyNear: CombatCameraInput = {
      fieldWidth,
      laneWidth: CONFIG.sim.laneWidthPx,
      partyXs: [224.5, 212, 115],
      threats: [],
    };
    const settled = settle(partyNear);
    const withAssassin: CombatCameraInput = {
      ...partyNear,
      threats: [{ deadline: 36, focusX: 115, xs: [400, 115] }],
    };
    expect(settle(withAssassin, settled)).toBe(settled);
    const partyMoved: CombatCameraInput = {
      fieldWidth,
      laneWidth: CONFIG.sim.laneWidthPx,
      partyXs: [225.5, 212, 115],
      threats: [{ deadline: 36, focusX: 115, xs: [400, 115] }],
    };
    const next = stepCombatCamera(settled, partyMoved);
    expect(Math.abs(next - settled)).toBeLessThanOrEqual(1);
  });

  it('frames party homes plus enemy formation slots so world 50 and 194 stay inside a 160 field', () => {
    const fieldWidth = 160;
    const input: CombatCameraInput = {
      fieldWidth,
      laneWidth: CONFIG.sim.laneWidthPx,
      partyXs: [50, 95, 140],
      formationXs: [158, 176, 194],
      threats: [],
    };
    const translation = settle(input);
    expect(50).toBeGreaterThanOrEqual(translation);
    expect(50).toBeLessThanOrEqual(translation + fieldWidth);
    expect(194).toBeGreaterThanOrEqual(translation);
    expect(194).toBeLessThanOrEqual(translation + fieldWidth);
  });

  it('is idempotent for the same previous translation and inputs', () => {
    const previous = 66;
    const input: CombatCameraInput = {
      fieldWidth: 208,
      laneWidth: CONFIG.sim.laneWidthPx,
      partyXs: [224.5, 212, 115],
      threats: [{ deadline: 36, focusX: 115, xs: [292, 115, 147] }],
    };
    expect(stepCombatCamera(previous, input)).toBe(stepCombatCamera(previous, input));
  });

  it('does not mutate unit x, hp, tick, or events when framing a live combat state', () => {
    const state = createPartyState(252);
    state.highestCleared = 11;
    state.progress = { kind: 'PUSHING', stage: 12 };
    state.wave = 1;
    spawnWave(state);
    const assassin = state.enemies.find(unit => unit.sourceId === 'assassin')!;
    state.enemies = [assassin];
    state.party.forEach(hold);
    assassin.action = { state: 'idle' };
    assassin.moving = false;
    assassin.x = 400;
    assassin.gauge = 10000;
    step(state);
    step(state, 26);
    const before = {
      tick: state.tick,
      events: state.events.length,
      party: state.party.map(unit => ({ id: unit.id, x: unit.x, hp: unit.hp })),
      enemies: state.enemies.map(unit => ({ id: unit.id, x: unit.x, hp: unit.hp })),
    };
    const translation = stepCombatCamera(66, cameraInputFromState(state));
    expect(state.tick).toBe(before.tick);
    expect(state.events.length).toBe(before.events);
    expect(state.party.map(unit => ({ id: unit.id, x: unit.x, hp: unit.hp }))).toEqual(before.party);
    expect(state.enemies.map(unit => ({ id: unit.id, x: unit.x, hp: unit.hp }))).toEqual(before.enemies);
    expect(Number.isInteger(translation)).toBe(true);
  });

  it('leaves an off-screen committed threat outside the field so edge markers still apply', () => {
    const fieldWidth = 208;
    const input: CombatCameraInput = {
      fieldWidth,
      laneWidth: CONFIG.sim.laneWidthPx,
      partyXs: [140, 95, 50],
      threats: [{ deadline: 39, focusX: 50, xs: [400, 50, 82] }],
    };
    const translation = settle(input);
    const screenX = 400 - translation;
    expect(screenX < 8 || screenX > fieldWidth - 8).toBe(true);
  });

  it('slews party-v2 cameraLeft toward 0 by at most 4px when framing input is null', async () => {
    const { canvas, controls } = makeRenderer();
    const { Renderer } = await import('../src/renderer');
    const renderer = new Renderer(canvas as unknown as HTMLCanvasElement, controls as unknown as HTMLElement);
    (renderer as unknown as { cameraTranslation: number }).cameraTranslation = 20;
    const state = createPartyState(1);
    state.party = [];
    renderer.setCompactViewport(true, 1);
    renderer.resize(480);
    const first = renderer.getCombatProjection(state).cameraLeft;
    expect(Math.abs(first - 20)).toBeLessThanOrEqual(4);
    expect(first).not.toBe(0);
    expect(Number.isInteger(first)).toBe(true);
    const second = renderer.getCombatProjection(state).cameraLeft;
    expect(Math.abs(second - first)).toBeLessThanOrEqual(4);
  });

  it('keeps non-party combat at translation 0 without party-v2 framing', async () => {
    const { canvas, controls } = makeRenderer();
    const { Renderer } = await import('../src/renderer');
    const renderer = new Renderer(canvas as unknown as HTMLCanvasElement, controls as unknown as HTMLElement);
    (renderer as unknown as { cameraTranslation: number }).cameraTranslation = 20;
    const state = createState(1);
    expect(state.combatRules).toBeUndefined();
    renderer.setCompactViewport(true, 1);
    renderer.resize(480);
    expect(renderer.getCombatProjection(state).cameraLeft).toBe(0);
    expect((renderer as unknown as { cameraTranslation: number }).cameraTranslation).toBe(0);
  });
  it('holds a killed or removed target slot through contact and eases home across a three-slot wave', async () => {
    const { canvas, controls } = makeRenderer(), { Renderer } = await import('../src/renderer');
    const renderer = new Renderer(canvas as unknown as HTMLCanvasElement, controls as unknown as HTMLElement);
    renderer.resize(1600);
    const state = createPartyState(2), base = state.enemies[0]!;
    state.enemies = [0, 1, 2].map(slot => ({ ...base, id: `anchor-${slot}`, slot, hp: slot === 1 ? 0 : base.maxHp, action: { state: 'idle' as const } }));
    const hero = state.party[0]!;
    hero.action = { state: 'recovery', kind: 'attack', targetId: 'anchor-1', targetSide: 'enemy', targetSlot: 1, targetCount: 3,
      startTick: 0, impactTick: 10, readyTick: 32, delivery: 'leap' };
    const projected = (): Map<string, number> => new Map(renderer.getCombatProjection(state).units.map(unit => [unit.id, unit.screenX]));
    const targetX = renderer.getCombatProjection(state).fieldLeft + formationScreenX('enemy', 1, 3, renderer.getCombatProjection(state).fieldWidth);
    state.tick = 12;
    expect(projected().get(hero.id)).toBe(targetX);
    state.enemies = state.enemies.filter(unit => unit.id !== 'anchor-1');
    state.tick = 21;
    const halfway = projected().get(hero.id)!;
    const homeX = renderer.getCombatProjection(state).fieldLeft + formationScreenX('hero', hero.slot, 3, renderer.getCombatProjection(state).fieldWidth);
    expect(halfway).toBe(Math.round(targetX + (homeX - targetX) * 0.5));
    state.tick = 28;
    expect(projected().get(hero.id)).toBe(homeX);
  });
});
