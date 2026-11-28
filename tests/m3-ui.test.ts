// M3 presentation logic: gacha reveal timeline (ui/gacha.md), welcome-back count-up (ui/offline-rewards.md), audio rules.
import { describe, expect, it, vi } from 'vitest';
import { AUDIO_STORAGE_KEY, GroupGate, PRIMING_OFFSETS, chooseFormat, clipGain, createAudio, eventCues, loopWindow, parseSettings } from '../src/audio';
import { FlashLimiter, awayLabel, burstCue, chestSlot, chestStaggerMs, countUp, particles, revealFrame, revealSchedule, rewardLabel, welcomeChestGrid, welcomeDoneMs } from '../src/reveal-timeline';
import manifest from '../src/audio-manifest.json';

import { CONFIG } from '../src/config';
import type { Rarity } from '../src/config';
import * as rng from '../src/core/rng';

const gate = CONFIG.ui.gacha;
const roll = (rarity: Rarity, heroId: string = rarity) => ({ heroId, rarity });

describe('Summoning Hall reveal', () => {
  it('charges identically for all tiers and both pull sizes, then leaks the best tier (first on ties)', () => {
    for (const best of ['common', 'rare', 'epic', 'legendary'] as const) {
      for (const rolls of [[roll(best, 'mk2')], Array.from({ length: 10 }, (_, i) => roll(i === 2 || i === 7 ? best : 'common'))]) {
        const schedule = revealSchedule(rolls);
        expect(schedule.highlight).toBe(rolls.length === 1 || best === 'common' ? 0 : 2);
        for (const ms of [0, 720, gate.chargeMs - 1]) {
          expect(revealFrame(schedule, ms)).toEqual(revealFrame(revealSchedule([roll('common')]), ms));
          expect(revealFrame(schedule, ms)).toMatchObject({ phase: 'charge', color: null, cards: [], flash: false, shakeX: 0 });
        }
        for (const ms of [schedule.leakAt, schedule.openAt - 1]) {
          expect(revealFrame(schedule, ms)).toMatchObject({ phase: 'leak', color: best, cards: [] });
        }
        expect(schedule.openAt - schedule.leakAt).toBe(1000);
      }
    }
  });
  it('replays an upgrade from just the ordered pull results without drawing random numbers', () => {
    const draws = vi.spyOn(rng, 'random');
    const cosmeticDraws = vi.spyOn(Math, 'random');
    try {
      for (const pulls of [[roll('legendary', 'ew3')], [roll('legendary', 'mk2')], [roll('epic', 'ew3')]]) {
        const plan = revealSchedule(pulls);
        expect(revealSchedule(structuredClone(pulls))).toEqual(plan);
        const upgrade = pulls[0]!.heroId === 'ew3' && plan.best === 'legendary';
        expect(plan.preview).toBe(upgrade ? 'rare' : null);
        expect(plan.leakAt - gate.chargeMs).toBe(upgrade ? 600 : 0);
        for (let ms = gate.chargeMs; ms < plan.openAt; ms += gate.frameStepMs) {
          expect(revealFrame(plan, ms).color).toBe(ms < plan.leakAt ? plan.preview : plan.best);
        }
      }
      expect(draws).not.toHaveBeenCalled(); expect(cosmeticDraws).not.toHaveBeenCalled();
    } finally { draws.mockRestore(); cosmeticDraws.mockRestore(); }
  });
  it('reaches results within the wall-clock budgets, including fake-outs and ten high cards', () => {
    for (const [rarity, min, max] of [['common', 2800, 3500], ['rare', 2800, 3500], ['epic', 4500, 5500], ['legendary', 5000, 7000]] as const) {
      for (const id of ['ew3', 'mk2']) {
        const one = revealSchedule([roll(rarity, id)]);
        expect(one.doneAt).toBeGreaterThanOrEqual(min); expect(one.doneAt).toBeLessThanOrEqual(max);
        const ten = revealSchedule(Array.from({ length: 10 }, () => roll(rarity, id)));
        expect(ten.doneAt).toBeGreaterThanOrEqual(9000); expect(ten.doneAt).toBeLessThanOrEqual(12000);
      }
    }
  });
  it('opens onto a tinted silhouette, bursts once and settles with no residual effects', () => {
    const plan = revealSchedule([roll('legendary', 'ew3')]);
    expect(revealFrame(plan, plan.openAt).phase).toBe('open');
    expect(revealFrame(plan, plan.openedAt)).toMatchObject({ phase: 'silhouette', color: 'legendary' });
    expect(revealFrame(plan, plan.cueAt - 1).phase).toBe('silhouette');
    expect([0, 40, 80].map(age => revealFrame(plan, plan.cueAt + age).flash)).toEqual([true, true, false]);
    expect([0, 40, 80, 120, 160].map(age => revealFrame(plan, plan.cueAt + age).shakeX)).toEqual([1, -1, 1, -1, 0]);
    expect(revealFrame(plan, plan.doneAt - 1).phase).toBe('burst');
    expect(revealFrame(plan, plan.doneAt)).toMatchObject({ phase: 'result', burstAge: null, flash: false, shakeX: 0 });
  });
  it('lands all ten backs, then pauses before every epic and legendary flip, in roll order', () => {
    const pulls = (['rare', 'common', 'epic', 'legendary', 'rare', 'legendary', 'common', 'common', 'rare', 'epic'] as const).map(r => roll(r));
    const plan = revealSchedule(pulls), ten = gate.tenPull;
    const flight = revealFrame(plan, plan.openedAt + ten.flightMs);
    expect(flight.phase).toBe('flight');
    expect(flight.cards[0]!.travel).toBe(1); expect(flight.cards[9]!.travel).toBeLessThan(1);
    const backs = revealFrame(plan, plan.landedAt).cards;
    expect(backs).toHaveLength(10);
    expect(backs.every(card => card.face === 'back' && card.travel === 1)).toBe(true);
    let next = plan.landedAt + ten.faceDownMs;
    pulls.forEach(({ rarity }, i) => {
      const at = plan.flipAt[i]!;
      expect(at - next).toBe(ten.pauseBeforeMs[rarity]);
      const flipped = revealFrame(plan, at + ten.flipMs);
      expect(flipped.cards.filter(card => card.face === 'front')).toHaveLength(i + 1);
      expect(flipped.flash).toBe(i === plan.highlight);
      next = at + ten.flipMs + ten.readMs;
    });
  });
  it('returns the normal final frame on skip or reduced motion at every beat', () => {
    for (const size of [1, 10]) {
      const plan = revealSchedule(Array.from({ length: size }, () => roll('legendary', 'ew3')));
      const final = revealFrame(plan, plan.doneAt);
      expect(final.done).toBe(true);
      expect(revealFrame(plan, Infinity)).toEqual(final);
      for (let ms = 0; ms <= plan.doneAt; ms += gate.frameStepMs) expect(revealFrame(plan, ms, true)).toEqual(final);
    }
  });
  it('burst cue rule: legendary → sting; else pity → gacha_pity; else gacha_reveal_<rarity>', () => {
    expect([burstCue('legendary', true), burstCue('epic', true), burstCue('rare', false)]).toEqual(['gacha_legendary_sting', 'gacha_pity', 'gacha_reveal_rare']);
  });
  it('particles are seeded and deterministic, clipped to their life', () => {
    expect(particles('epic', 3, 80)).toEqual(particles('epic', 3, 80)); expect(particles('epic', 3, 80)).toHaveLength(16);
    expect(particles('epic', 3, 320)).toHaveLength(0); expect(particles('common', 0, 0, 0.25)).toHaveLength(2);
  });
});

describe('flash limiter (shared, 400 ms gap, ≤ 2 per 1000 ms)', () => {
  it('denies inside 400 ms and a third grant inside a second; denied is skipped', () => {
    const limiter = new FlashLimiter();
    expect([0, 300, 520, 900, 1040, 1600].map(t => limiter.request(t))).toEqual([true, false, true, false, true, true]);
  });
});

describe('welcome back', () => {
  it('formats time away and values as specified', () => {
    expect([42 * 60, 3 * 3600 + 5 * 60, 28 * 3600 + 59 * 60, 12 * 3600 + 40 * 60].map(awayLabel)).toEqual(['42m', '3h 05m', '1d 4h', '12h 40m']);
    expect([184_320, 1_234_567, 12_340_000].map(rewardLabel)).toEqual(['+184,320', '+1,234,567', '+12.3M']);
  });
  it('counts gold up from 160 ms and XP from 260 ms (ease-out cubic, 40 ms steps), chests pop from 1160 ms', () => {
    expect(countUp(1000, 159, 160)).toBe(0); expect(countUp(1000, 1060, 160)).toBe(1000); expect(countUp(1000, 600, 160)).toBeGreaterThan(500);
    expect(countUp(1000, 0, 160, true)).toBe(1000);
    expect([chestSlot(0, 1159), chestSlot(0, 1160), chestSlot(0, 1240), chestSlot(1, 1280)]).toEqual([{ shown: false, pop: false }, { shown: true, pop: true }, { shown: true, pop: false }, { shown: true, pop: true }]);
    expect(welcomeDoneMs(4)).toBe(1160 + 3 * 120 + 80);
  });
  it('packs more than 16 welcome chests into 14 per row at 26 px / stride 29, and pops them at 60 ms', () => {
    expect(welcomeChestGrid(16)).toMatchObject({ perRow: 8, size: 28, stride: 34, originY: 26 });
    const grid = welcomeChestGrid(28);
    expect(grid).toEqual({ perRow: 14, size: 26, stride: 29, originY: 26 });
    expect(13 * grid.stride + grid.size).toBe(403);
    expect(26 + grid.stride + grid.size).toBe(81);
    expect(chestStaggerMs(16)).toBe(120); expect(chestStaggerMs(28)).toBe(60);
    expect(welcomeDoneMs(28)).toBe(1160 + 27 * 60 + 80);
    expect(welcomeDoneMs(28)).toBeLessThan(1160 + 15 * 120 + 80);
  });
});

describe('audio', () => {
  it('gain = master × bus × clip with buses 0.5/0.3/0.6/0.5; mute is 0', () => {
    expect(manifest.defaultVolumes).toEqual({ master: 0.5, music: 0.3, sfx: 0.6, ui: 0.5 });
    expect(clipGain({ muted: false, volume: 0.5 }, 'sfx', 0.8)).toBeCloseTo(0.24, 10);
    expect(clipGain({ muted: true, volume: 0.5 }, 'music', 1)).toBe(0);
  });
  it('settings persist through storage and invalid values fall back to defaults', () => {
    const store = new Map<string, string>(), storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    const a = createAudio(storage); a.set({ muted: true, volume: 0.3 });
    expect(JSON.parse(store.get(AUDIO_STORAGE_KEY) ?? '{}')).toEqual({ muted: true, volume: 0.3 });
    expect(createAudio(storage).settings()).toEqual({ muted: true, volume: 0.3 });
    expect(parseSettings('{"muted":1,"volume":7}')).toEqual({ muted: false, volume: 0.5 }); expect(parseSettings('nope')).toEqual({ muted: false, volume: 0.5 });
  });
  it('loop: OGG when Vorbis decodes, else the M4A copy, MP3 last; window 0..2,304,000 shifted by the measured priming', () => {
    const loop = manifest.clips.find(clip => clip.key === 'ambient_loop');
    if (!loop) throw new Error('ambient_loop missing');
    expect(loop.loop).toEqual({ startSample: 0, endSample: 2_304_000 });
    expect(chooseFormat(loop, () => true)).toBe('ogg'); expect(chooseFormat(loop, type => type.startsWith('audio/mp4'))).toBe('m4a'); expect(chooseFormat(loop, () => false)).toBe('mp3');
    expect(chooseFormat({ paths: {} }, type => type.startsWith('audio/mp4'))).toBe('mp3');
    expect(PRIMING_OFFSETS.webkit).toEqual({ ogg: 0, m4a: 0, mp3: 1105 }); expect(PRIMING_OFFSETS.chromium).toEqual({ ogg: 0, m4a: 0, mp3: 0 });
    expect(loopWindow(loop, 1105)).toEqual({ start: 1105 / 48000, end: (2_304_000 + 1105) / 48000, offset: 1105 });
  });
  it('variant groups never repeat a clip twice in a row and respect minIntervalMs / maxVoices', () => {
    let seed = 1; const gate = new GroupGate(() => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; });
    const picks: string[] = [];
    for (let t = 0; t < 2000; t += 50) { const pick = gate.pick('hit', t, () => 10); if (pick) picks.push(pick.key); }
    expect(picks.every((key, i) => i === 0 || key !== picks[i - 1])).toBe(true);
    expect(gate.pick('hit', 2000, () => 10)).not.toBeNull(); expect(gate.pick('hit', 2010, () => 10)).toBeNull();
    const voices = new GroupGate(() => 0.5); let live = 0;
    for (let t = 0; t < 400; t += 61) if (voices.pick('coin_pickup', t, () => 5000)) live += 1;
    expect(live).toBe(4);
    const pick = new GroupGate(() => 0.99).pick('hit', 0, () => 10); expect(Math.abs((pick?.rate ?? 1) - 1)).toBeLessThanOrEqual(0.03);
  });
  it('maps events to cues; crit is skipped and ultimates are held', () => {
    expect(manifest.skipped).toEqual(['crit']); expect(manifest.clips.some(clip => clip.key === 'crit' || clip.key.startsWith('ultimate_'))).toBe(false);
    for (const key of ['gacha_pity', 'drop_pop', 'gacha_legendary_sting']) expect(manifest.clips.some(clip => clip.key === key)).toBe(true);
    const event = (data: object) => ({ seq: 1, tick: 0, data }) as Parameters<typeof eventCues>[0];
    expect(eventCues(event({ type: 'death', unitId: 'e', side: 'enemy' }))).toEqual(['enemy_death']);
    expect(eventCues(event({ type: 'gear', gearId: 'x', slot: 'armor', rarity: 'rare' }))).toEqual(['drop_pop']);
    expect(eventCues(event({ type: 'clear', stage: 3, first: false, durationSeconds: 20 }))).toEqual([]);
    expect(eventCues(event({ type: 'stage', stage: 10, mode: 'BOSS_FIGHT' }))).toEqual(['boss_warning']);
  });
});
