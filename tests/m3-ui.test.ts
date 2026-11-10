// M3 presentation logic: gacha reveal timeline (ui/gacha.md), welcome-back count-up (ui/offline-rewards.md), audio rules.
import { describe, expect, it } from 'vitest';
import { AUDIO_STORAGE_KEY, GroupGate, PRIMING_OFFSETS, chooseFormat, clipGain, createAudio, eventCues, loopWindow, parseSettings } from '../src/audio';
import { FlashLimiter, awayLabel, burstCue, chestSlot, chestStaggerMs, countUp, highestCard, particles, rewardLabel, singleFrame, tenFrame, tenSchedule, tierTotalMs, welcomeChestGrid, welcomeDoneMs } from '../src/reveal-timeline';
import manifest from '../src/audio-manifest.json';

describe('gacha single reveal', () => {
  it('runs 1000 / 1280 / 1600 / 2000 ms by tier and ends with labels and the footer', () => {
    expect((['common', 'rare', 'epic', 'legendary'] as const).map(tierTotalMs)).toEqual([1000, 1280, 1600, 2000]);
    expect(singleFrame('rare', 1279).done).toBe(false); expect(singleFrame('rare', 1280)).toMatchObject({ done: true, face: 'front', showName: true, showRarity: true });
  });
  it('drops the back −8/−4/0, ramps the rim monotonically, flips 96→48→0→48→96 in 40 ms steps', () => {
    expect([0, 40, 80, 120].map(ms => singleFrame('common', ms).dropY)).toEqual([-8, -4, 0, 0]);
    const rims = Array.from({ length: 11 }, (_, i) => singleFrame('rare', 120 + i * 40).rimAlpha);
    expect(rims.every((alpha, i) => i === 0 || alpha >= (rims[i - 1] ?? 0))).toBe(true); expect(rims.at(-1)).toBe(153);
    expect(singleFrame('common', 200).rimAlpha).toBe(0);
    expect([360, 400, 440, 480, 520].map(ms => [singleFrame('common', ms).cardWidth, singleFrame('common', ms).face])).toEqual([[48, 'back'], [0, 'back'], [48, 'front'], [96, 'front'], [96, 'front']]);
  });
  it('shows the silhouette for Epic+ until the burst, motes only before it; legendary flashes 80 ms and shakes [+1,−1,+1,−1,0]', () => {
    expect(singleFrame('epic', 1000).face).toBe('silhouette'); expect(singleFrame('epic', 1120).face).toBe('front');
    expect(singleFrame('epic', 500).motes).toBe(true); expect(singleFrame('rare', 500).motes).toBe(false);
    expect([1360, 1400, 1440].map(ms => singleFrame('legendary', ms).flash)).toEqual([true, true, false]);
    expect([1360, 1400, 1440, 1480, 1520].map(ms => singleFrame('legendary', ms).shakeX)).toEqual([1, -1, 1, -1, 0]);
    expect(singleFrame('legendary', 1360, true)).toMatchObject({ flash: false, shakeX: 0, motes: false });
  });
  it('labels: name at the labels beat, rarity 80 ms later; a skip (Infinity) is the final state', () => {
    expect([singleFrame('epic', 1280).showName, singleFrame('epic', 1280).showRarity, singleFrame('epic', 1360).showRarity]).toEqual([true, false, true]);
    expect(singleFrame('legendary', Infinity)).toMatchObject({ done: true, flash: false, shakeX: 0, burstAge: null });
  });
  it('burst cue rule: legendary → sting; else pity → gacha_pity; else gacha_reveal_<rarity>', () => {
    expect([burstCue('legendary', true), burstCue('epic', true), burstCue('rare', false)]).toEqual(['gacha_legendary_sting', 'gacha_pity', 'gacha_reveal_rare']);
  });
  it('particles are seeded and deterministic, clipped to their life', () => {
    expect(particles('epic', 3, 80)).toEqual(particles('epic', 3, 80)); expect(particles('epic', 3, 80)).toHaveLength(16);
    expect(particles('epic', 3, 320)).toHaveLength(0); expect(particles('common', 0, 0, 0.25)).toHaveLength(2);
  });
});

describe('gacha 10-pull', () => {
  const plain = ['common', 'rare', 'common', 'rare', 'common', 'common', 'rare', 'common', 'common', 'rare'] as const;
  it('flips card i at 120 + i×120; badges at last flip + 160 = 1360 ms with nothing Epic+ (gacha.md §8 table; its prose says 1480)', () => {
    const schedule = tenSchedule(plain); expect(schedule.flipAt).toEqual([120, 240, 360, 480, 600, 720, 840, 960, 1080, 1200]); expect(schedule.badgesAt).toBe(1360);
    expect(tenFrame(plain, 1360).done).toBe(true); expect(tenFrame(plain, 1359).badges).toBe(false);
  });
  it('holds 400 ms after the highest Epic+ card (ties: first); only a legendary highest card flashes/shakes', () => {
    const rarities = ['common', 'epic', 'rare', 'legendary', 'rare', 'legendary', 'common', 'common', 'common', 'common'] as const;
    expect(highestCard(rarities)).toBe(3);
    const schedule = tenSchedule(rarities); expect(schedule.flipAt[4]! - schedule.flipAt[3]!).toBe(520); expect(schedule.badgesAt).toBe(1360 + 400);
    expect(tenFrame(rarities, schedule.flipAt[3]! + 160).flash).toBe(true);
    expect(tenFrame(plain, 500).flash).toBe(false);
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
