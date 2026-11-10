import { describe, expect, it } from 'vitest';
import { busLevel, clipGain, DEFAULT_VOLUMES, parseSettings } from '../src/audio';
import { CONFIG } from '../src/config';
import { createPartyState, snapshot } from '../src/core/game';
import uiTokens from '../src/ui-tokens.json';

describe('party-v2 starter gear (feat/enhancement-ui)', () => {
  it('is opt-in, deterministic and equipped on the starting party', () => {
    expect(createPartyState(1).inventory).toEqual([]);
    const a = createPartyState(7, { starterGear: true }), b = createPartyState(7, { starterGear: true });
    expect(snapshot(a)).toEqual(snapshot(b));
    expect(a.inventory.map(item => `${item.rarity} ${item.slot} ${item.acquiredAt.source} L${item.level}`)).toEqual(['common weapon starter L0', 'common armor starter L0', 'common charm starter L0']);
    const wearer = (id: string) => a.roster.find(hero => Object.values(hero.equipment).includes(id as never))?.id;
    expect(a.inventory.map(item => wearer(item.id))).toEqual(['mw1', 'mw2', 'priest']);
    expect(new Set(a.inventory.map(item => item.id)).size).toBe(3);
    expect(a.nextGearId).toBe(createPartyState(7).nextGearId + 3);
    expect(a.inventory[0]?.stats.atk).toBe(CONFIG.gear.slots.weapon.main.atk);
  });
  it('does not touch the party RNG stream (encounters match a gearless start)', () => {
    const plain = createPartyState(3), geared = createPartyState(3, { starterGear: true });
    expect(geared.rng).toEqual(plain.rng);
    expect(geared.enemies.map(enemy => enemy.sourceId)).toEqual(plain.enemies.map(enemy => enemy.sourceId));
  });
});

describe('audio buses for the four Settings sliders', () => {
  it('parses optional bus levels and keeps legacy settings valid', () => {
    expect(parseSettings(JSON.stringify({ muted: false, volume: 0.4 }))).toEqual({ muted: false, volume: 0.4 });
    expect(parseSettings(JSON.stringify({ muted: true, volume: 0.4, buses: { music: 0.1, sfx: 0.2, ui: 0.3 } }))).toEqual({ muted: true, volume: 0.4, buses: { music: 0.1, sfx: 0.2, ui: 0.3 } });
    expect(parseSettings(JSON.stringify({ muted: false, volume: 0.4, buses: { music: 2, sfx: 0.2, ui: 0.3 } }))).toEqual({ muted: false, volume: 0.4 });
  });
  it('falls back to the manifest defaults per bus and scales clip gain by the bus level', () => {
    const legacy = { muted: false, volume: 0.5 }, custom = { muted: false, volume: 0.5, buses: { music: 0, sfx: 1, ui: 0.25 } };
    expect(busLevel(legacy, 'music')).toBe(DEFAULT_VOLUMES.music);
    expect(busLevel(custom, 'ui')).toBe(0.25);
    expect(clipGain(custom, 'music', 1)).toBe(0);
    expect(clipGain(custom, 'ui', 1)).toBeCloseTo(clipGain({ ...custom, buses: { ...custom.buses, ui: 1 } }, 'ui', 1) * 0.25);
  });
});

describe('compactMenu tokens', () => {
  it('carry the layout the menu and lane HUD read (compact-menu.md §2, §5, §6)', () => {
    const menu = uiTokens.compactMenu;
    expect(menu.lane.menu).toEqual([508, 98, 56, 28]);
    expect(menu.lane.edit).toEqual([568, 98, 56, 28]);
    expect(menu.editMode.move).toEqual([12, 90, 56, 20]);
    expect(menu.browser.panelSize).toEqual([624, 400]);
    expect(menu.native.client).toEqual([760, 560]);
    expect(Object.keys(menu.browser.tabs)).toEqual(['party', 'stash', 'recruit', 'upgrades', 'settings']);
    expect(menu.widgets.slider.volume).toEqual({ min: 0, max: 1, step: 0.05 });
    expect(uiTokens.pityMeters.recruit.full).toContain('{epicPlus}');
  });
});

describe('designer review tokens', () => {
  it('match ui/runtime/ui-tokens.json for the field and the compact 10-pull', async () => {
    const menu = (uiTokens as unknown as { compactMenu: { lane: { field: number[] }; tenPullCompact: { cardRects: number[][] } } }).compactMenu;
    expect(menu.lane.field).toEqual([216, 80, 208, 80]);
    const cards = menu.tenPullCompact.cardRects as number[][];
    expect(cards).toHaveLength(10);
    for (const rect of cards) expect(rect.slice(2)).toEqual([104, 96]);
    const { shortHeroName } = await import('../src/pixel-ui');
    expect(shortHeroName('mw2')).toBe('Warrior 2');
  });
});
