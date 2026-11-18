import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { actionBoundaries, APPROACH_TICKS, ANIMATION_TICK_MS, clipFor, createActionTimeline, PARTY_CLIPS, PRESENTATION_FRAME_MS, RETURN_TICKS, sampleActionPresentation } from '../src/core/turn/animation-timing';

const assetManifest = JSON.parse(readFileSync(resolve(process.cwd(), 'public/assets/manifest.json'), 'utf8')) as { heroes: { key: string; atlasPath: string }[]; enemies: { key: string; atlasPath: string }[] };
const assets = [...assetManifest.heroes, ...assetManifest.enemies];

describe('party attack clip timing', () => {
  it('matches every configured game actor clip and cast fallback to its atlas', () => {
    for (const [id, assetName] of Object.entries(CONFIG.view.heroAssets)) expect(PARTY_CLIPS[id]?.asset).toBe(assetName);
    for (const [kind, assetName] of Object.entries(CONFIG.view.enemyAssets)) expect(PARTY_CLIPS[kind]?.asset).toBe(assetName);
    expect(PARTY_CLIPS.assassin?.asset).toBe(CONFIG.view.enemyAssets.grunt);
    expect(PARTY_CLIPS.bomber?.asset).toBe(CONFIG.view.enemyAssets.brute);
    for (const [id, clip] of Object.entries(PARTY_CLIPS)) {
      const asset = assets.find(value => value.key === clip.asset);
      expect(asset, id).toBeDefined();
      const atlas = JSON.parse(readFileSync(resolve(process.cwd(), 'public/assets', asset!.atlasPath), 'utf8')) as { animations: Record<string, { frames: number[]; durationMs: number; loop: boolean }> };
      const attack = atlas.animations.attack;
      const cast = atlas.animations.attack2 ?? attack;
      expect(attack?.frames.length, `${id} attack frames`).toBe(clip.attackFrames);
      expect(cast?.frames.length, `${id} cast frames`).toBe(clip.castFrames);
      expect(attack?.durationMs, `${id} frame ms`).toBe(clip.frameMs);
      expect(cast?.durationMs, `${id} cast frame ms`).toBe(clip.frameMs);
      expect(attack?.loop, `${id} attack loop`).toBe(false);
      expect(cast?.loop, `${id} cast loop`).toBe(false);
    }
  });

  it.each([['mw1', 4], ['hk1', 7], ['ew3', 13], ['boss_ch1', 16]] as const)('plays every frame for %s (%i frames) before return', (actor, frames) => {
    const timeline = createActionTimeline(actor, 'leap', 10), clip = clipFor(actor, 'leap');
    expect(timeline.contactTick).toBe(10 + APPROACH_TICKS);
    expect(timeline.impactTick).toBe(timeline.contactTick + Math.ceil(Math.floor(frames / 2) * PRESENTATION_FRAME_MS / ANIMATION_TICK_MS));
    expect(timeline.attackEndTick).toBe(timeline.contactTick + clip.ticks);
    expect(timeline.returnEndTick).toBe(timeline.attackEndTick + RETURN_TICKS);
    const seen: number[] = [];
    for (let now = timeline.contactTick; now < timeline.attackEndTick; now += 1) {
      const sample = sampleActionPresentation('leap', timeline, now);
      expect(sample.phase).toBe('attack');
      expect(sample.progress).toBe(1);
      seen.push(Math.min(frames - 1, Math.floor(sample.ageMs / clip.frameMs)));
    }
    expect([...new Set(seen)]).toEqual(Array.from({ length: frames }, (_, index) => index));
    expect(timeline.attackEndTick - timeline.contactTick).toBeGreaterThanOrEqual(Math.ceil(frames * PRESENTATION_FRAME_MS / ANIMATION_TICK_MS));
    expect(sampleActionPresentation('leap', timeline, timeline.attackEndTick).phase).toBe('return');
    expect(sampleActionPresentation('leap', timeline, timeline.returnEndTick).phase).toBe('settle');
    expect(sampleActionPresentation('leap', timeline, timeline.readyTick).phase).toBe('done');
  });

  it('keeps ranged casts at home and resumes old committed recovery without replaying a clip', () => {
    const cast = createActionTimeline('ew3', 'cast', 30);
    expect(cast.contactTick).toBe(30);
    expect(cast.attackEndTick).toBe(30 + clipFor('ew3', 'cast').ticks);
    expect(cast.returnEndTick).toBe(cast.attackEndTick);
    expect(sampleActionPresentation('cast', cast, 30)).toMatchObject({ phase: 'attack', animation: 'cast', ageMs: 0 });
    const oldRecovery = actionBoundaries('ew3', 'leap', { state: 'recovery', startTick: 0, impactTick: 10, readyTick: 32 });
    expect(sampleActionPresentation('leap', oldRecovery, 11).phase).toBe('return');
  });
});
