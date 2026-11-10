// v1.4 luck (design.md §14.1, §14.2, §18): CR-14-01 Legendary pity, CR-14-02 new-hero guarantee, CR-14-03 gear Fortune.
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, setV14Rules } from '../src/config';
import { chest, chooseChest, drawHero, fortuneMeter, fortuneRoll, pull, recruitMeters, weightedRarity } from '../src/core/economy';
import type { RecruitLuck } from '../src/core/economy';
import { createState, load, snapshot } from '../src/core/game';
import { gachaCohort } from '../src/core/policy';
import { makeSave, restoreSave } from '../src/core/save';

afterEach(() => { setV14Rules([]); });
const starters = (): Set<string> => new Set(CONFIG.heroes.filter(hero => hero.starter).map(hero => hero.id));

describe('CR-14-01/02 recruit pity', () => {
  it('over 1M seeded pulls no pre-roster 60-pull window lacks a Legendary and no 20 duplicates run in a row', { timeout: 120_000 }, () => {
    setV14Rules(['recruitPity']);
    let pulls = 0, maxNoLegendary = 0, maxDupes = 0, legendaryPityFired = 0, epicResetByLegendaryPity = true, unexcused = 0, excused = 0;
    for (let seed = 1; pulls < 1_000_000; seed += 1) {
      const rng = { rng: seed >>> 0 }, owned = starters();
      let pity = 0, luck: RecruitLuck | undefined = { legendary: 0, newHero: 0 }, noLegendary = 0, dupes = 0;
      while (owned.size < CONFIG.heroes.length) {
        const draw = drawHero(rng, pity, owned, luck);
        if (draw.legendaryPity) { legendaryPityFired += 1; if (draw.nextPity !== 0) epicResetByLegendaryPity = false; }
        noLegendary = draw.rarity === 'legendary' ? 0 : noLegendary + 1; dupes = owned.has(draw.hero.id) ? dupes + 1 : 0;
        maxNoLegendary = Math.max(maxNoLegendary, noLegendary); maxDupes = Math.max(maxDupes, dupes);
        // Designer answer 1: Legendary pity stays Legendary even with every Legendary owned, so that one pull may be the 20th duplicate.
        if (dupes >= 20) { if (draw.legendaryPity && draw.fresh) excused += 1; else unexcused += 1; }
        if (draw.legendaryPity && draw.fresh) expect(draw.rarity).toBe('legendary');
        pity = draw.nextPity; luck = draw.nextLuck; owned.add(draw.hero.id); pulls += 1;
      }
    }
    expect(maxNoLegendary).toBeLessThan(60); expect(unexcused).toBe(0); expect(maxDupes).toBeLessThan(20 + excused);
    expect(legendaryPityFired).toBeGreaterThan(0); expect(epicResetByLegendaryPity).toBe(true);
  });
  it('10k cohort with CR-14-01 + 02: median 79 ± 1, max ≤ 141 (design.md §14.6 T4a)', { timeout: 60_000 }, () => {
    setV14Rules(['recruitPity']);
    const cohort = gachaCohort(10_000);
    expect(Math.abs(cohort.medianPullsToFullRoster - 79)).toBeLessThanOrEqual(1);
    expect(cohort.maxPulls).toBeLessThanOrEqual(141);
    expect(cohort.observedRarityRates.legendary).toBeCloseTo(0.0527, 2);
  });
  it('rule off: the 1.3.0 cohort (median 124) and draw are unchanged', { timeout: 60_000 }, () => {
    expect(gachaCohort(10_000).medianPullsToFullRoster).toBe(124);
    const a = { rng: 77 }, b = { rng: 77 }, owned = starters();
    for (let i = 0; i < 500; i += 1) expect(drawHero(a, i % 30, owned).hero.id).toBe(drawHero(b, i % 30, owned).hero.id);
  });
  it('the 60th pull without a Legendary is a Legendary that prefers unowned; the 20th duplicate is a new hero with rarity fallback', () => {
    setV14Rules(['recruitPity']);
    const owned = starters();
    const legendary = drawHero({ rng: 5 }, 3, owned, { legendary: 59, newHero: 0 });
    expect(legendary.rarity).toBe('legendary'); expect(legendary.legendaryPity).toBe(true); expect(owned.has(legendary.hero.id)).toBe(false);
    expect(legendary.nextLuck).toEqual({ legendary: 0, newHero: 0 }); expect(legendary.nextPity).toBe(0);
    // Own every common: a new-hero draw that rolls common must fall back to the most common rarity with an unowned hero.
    const allCommon = new Set([...owned, ...CONFIG.heroes.filter(hero => hero.rarity === 'common').map(hero => hero.id)]);
    for (let seed = 1; seed < 200; seed += 1) {
      const draw = drawHero({ rng: seed }, 0, allCommon, { legendary: 0, newHero: 19 });
      expect(allCommon.has(draw.hero.id)).toBe(false); expect(draw.fresh).toBe(true); expect(draw.rarity).not.toBe('common');
    }
  });
  it('pull() writes the counters; with a full roster only the new-hero counter freezes and hides (designer answer 3)', () => {
    setV14Rules(['recruitPity']);
    const state = createState(4); state.tickets = 10;
    expect(recruitMeters(state)).toEqual({ epicPlus: 30, legendary: 60, newHero: 20 });
    pull(state);
    expect(state.pityLegendary).toBeDefined(); expect(state.pityNewHero).toBeDefined();
    const meters = recruitMeters(state); expect(meters?.legendary).toBe(60 - (state.pityLegendary ?? 0));
    const kind = state.events.at(-1)?.data; expect(kind?.type === 'pull' && (kind.pity === null || typeof kind.pity === 'string')).toBe(true);
    for (const hero of CONFIG.heroes) if (!state.roster.some(owned => owned.id === hero.id)) state.roster.push({ id: hero.id, level: 1, xp: 0, stars: 1, equipment: { weapon: null, armor: null, charm: null } });
    state.pity = 28; state.pityLegendary = 58; state.pityNewHero = 19; state.tickets = 2;
    pull(state); pull(state);
    const last = state.events.filter(event => event.data.type === 'pull').slice(-2).map(event => event.data.type === 'pull' ? [event.data.rarity, event.data.pity] : null);
    // 59th since Legendary + 29th since Epic+: pity fires; then the 60th is Legendary pity even though the roster is full.
    expect(last[1]).toEqual(['legendary', 'legend']);
    expect(state.pityNewHero).toBe(19); expect(state.pityLegendary).toBe(0);
    expect(recruitMeters(state)).toEqual({ epicPlus: 30 - state.pity, legendary: 60, newHero: null });
  });
  it('the pull log names the guarantee: legend, epic, newHero or null; 1.3.0 keeps the boolean', () => {
    setV14Rules(['recruitPity']);
    const state = createState(5); state.tickets = 200;
    for (let i = 0; i < 200; i += 1) pull(state);
    const kinds = new Set(state.events.flatMap(event => event.data.type === 'pull' ? [event.data.pity] : []));
    for (const kind of kinds) expect([null, 'legend', 'epic', 'newHero']).toContain(kind);
    setV14Rules([]);
    const plain = createState(5); plain.tickets = 40;
    for (let i = 0; i < 40; i += 1) pull(plain);
    expect(plain.events.every(event => event.data.type !== 'pull' || typeof event.data.pity === 'boolean')).toBe(true);
  });
});

describe('CR-14-03 gear Fortune', () => {
  it('20k runs × 400 rolls: first Legendary ≤ roll 40, later gaps ≤ 100, consolidated 1.61% ± 0.05', { timeout: 120_000 }, () => {
    setV14Rules(['gearFortune']);
    let legendary = 0, rolls = 0, maxFirst = 0, maxGap = 0;
    for (let run = 1; run <= 20_000; run += 1) {
      const rng = { rng: run }; let since = 0, found = false, first = 0, last = 0;
      for (let roll = 1; roll <= 400; roll += 1) {
        const result = fortuneRoll(since, found, weightedRarity(rng, CONFIG.gear.chestRarityOdds), 1); since = result.since; found = result.found; rolls += 1;
        if (result.rarity !== 'legendary') continue;
        legendary += 1; if (!first) first = roll; else maxGap = Math.max(maxGap, roll - last); last = roll;
      }
      maxFirst = Math.max(maxFirst, first);
    }
    expect(maxFirst).toBeLessThanOrEqual(40); expect(maxGap).toBeLessThanOrEqual(100);
    expect(Math.abs(legendary / rolls - 0.0161)).toBeLessThan(0.0005);
  });
  it('chests advance the meter; pick-1-of-2 counts once per chest; the 40th roll is Legendary', () => {
    setV14Rules(['gearFortune', 'chestChoice']);
    const state = createState(6); state.gearSinceLegendary = 38;
    expect(fortuneMeter(state)).toEqual({ found: false, since: 38, limit: 40, left: 2 });
    chest(state, 10);
    const first = state.pendingChoice?.[0]; if (!first) throw new Error('no choice');
    expect(first.some(item => item.rarity === 'legendary') ? 0 : state.gearSinceLegendary).toBe(first.some(item => item.rarity === 'legendary') ? state.gearSinceLegendary : 39);
    if (!first.some(item => item.rarity === 'legendary')) { chest(state, 10); expect(state.pendingChoice?.[1]?.[0].rarity).toBe('legendary'); }
    expect(state.gearSinceLegendary).toBe(0); expect(state.gearLegendaryFound).toBe(true);
    expect(fortuneMeter(state)).toMatchObject({ found: true, limit: 100 });
    chooseChest(state, 0); expect(state.events.at(-1)?.data).toMatchObject({ type: 'chestChoice' });
  });
  it('rule off: chests write no Fortune fields', () => {
    const state = createState(6); for (let i = 0; i < 50; i += 1) chest(state, 3);
    expect(state.gearSinceLegendary).toBeUndefined(); expect(state.gearLegendaryFound).toBeUndefined(); expect(fortuneMeter(state)).toBeNull();
  });
});

describe('luck saves', () => {
  it('counters survive snapshot/load and the save envelope; 1.3.0 saves have none', () => {
    setV14Rules(['recruitPity', 'gearFortune']);
    const state = createState(2); state.tickets = 8; for (let i = 0; i < 8; i += 1) pull(state); for (let i = 0; i < 12; i += 1) chest(state, 2);
    const text = snapshot(state); expect(snapshot(load(text))).toBe(text);
    const restored = restoreSave(makeSave(state, 0), 0).state;
    expect([restored.pityLegendary, restored.pityNewHero, restored.gearSinceLegendary, restored.gearLegendaryFound]).toEqual([state.pityLegendary, state.pityNewHero, state.gearSinceLegendary, state.gearLegendaryFound]);
    setV14Rules([]);
    const plain = JSON.parse(snapshot(createState(2))) as Record<string, unknown>;
    expect(['pityLegendary', 'pityNewHero', 'gearSinceLegendary', 'gearLegendaryFound'].some(key => key in plain)).toBe(false);
  });
  it('rejects counters outside their guarantees', () => {
    const base = JSON.parse(snapshot(createState(2))) as Record<string, unknown>;
    expect(() => load({ ...base, pityLegendary: 60 })).toThrow();
    expect(() => load({ ...base, pityNewHero: 20 })).toThrow();
    expect(() => load({ ...base, gearSinceLegendary: 100, gearLegendaryFound: true })).toThrow();
    expect(() => load({ ...base, gearSinceLegendary: 40 })).toThrow();
    expect(() => load({ ...base, gearSinceLegendary: 60, gearLegendaryFound: true, pityLegendary: 59, pityNewHero: 19 })).not.toThrow();
  });
});
