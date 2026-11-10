# v1.4 luck: recruit pity (CR-14-01/02) and gear Fortune (CR-14-03)

Rules are opt-in, like the chest rules: `--v14 recruitPity,gearFortune` (or `all`) in `scripts/sim.ts`, `?v14=…` in the URL,
`__game.setV14Rules([...])` in the debug API, `--rules` in `scripts/v14-targets.ts`. With the rules off, `CONFIG.v14.recruit`
and `CONFIG.v14.fortune` are inert (0 = off). From 1.4.2 the game and sim default to all six rules on; `?v14=none` / `--v14 none` opts out. The rules-off golden is `V142_RULES_OFF_GOLDEN` (farm ticket chance is live at top level).

## Recruit (design.md §14.1, keys `v14.gacha`)

- Counters: `pity` (Epic+ at 30, unchanged), `pityLegendary` (0..59), `pityNewHero` (0..19).
- Precedence: Legendary pity (60th pull, no rarity RNG drawn), then Epic+ pity, then the normal roll. A Legendary resets Epic+ pity.
- Legendary pity always gives a Legendary, even when every Legendary is owned; the duplicate becomes a star (Designer answer 1).
- New-hero guarantee (20th pull since a new hero) is a separate counter and only changes the pick. If the rolled rarity has no
  unowned hero it falls back to the most common rarity that still has one, except on a Legendary-pity pull (answer 1). That pull
  may therefore be the one excused duplicate at the 20th count; the new-hero counter then stays at 19 and fires on the next pull.
- `legendaryPityPrefersUnowned`: a Legendary-pity pull picks an unowned Legendary when one exists.
- Once the roster is complete only the new-hero counter freezes and hides; Epic+ and Legend pity keep running and firing (answer 3).
- Pull log: with `recruitPity` on, the pull event carries `pity: 'legend' | 'epic' | 'newHero' | null` (answer 4); the gacha
  reveal shows a `PITY` tag and plays `gacha_pity` (unless the Legendary sting plays). With the rule off it stays the 1.3.0 boolean.

## Fortune (design.md §14.2, keys `v14.gearPity`)

- `gearSinceLegendary` (0..99), `gearLegendaryFound`. First Legendary forced by roll 40, then every ≤ 100 rolls. No soft ramp.
- Roll units: normal chest `rollUnits.chest` 1, Expedition Chest `rollUnits.expeditionChest` 4 (with `expeditionChests` on,
  see docs/V14-OFFLINE.md), Gold Chest 3 (`goldChest`, unused until the goblin, answer 5). In a pick-1-of-2 chest the second option
  counts 0 units, so the chest counts once.
- Only a Legendary from a counted chest roll (units > 0) resets Fortune. Option B of a choice and any other non-chest gear neither
  count nor reset (answer 2). Fortune never freezes (answer 3).

## Saves

All four fields are optional and validated (bounds, and `gearSinceLegendary < 40` until the first Legendary). Old saves load unchanged; no migration.

## UI (design.md §16; no ui/ spec exists for these meters)

- Recruit meter takes the DPS slot in the actions island row 1 (compact: the RUNNING/PAUSED slot; the pause button still shows state).
  Text `Epic+ in 12 · Legend in 41`, falling back to `E+12 L41 N20`, then `E+12 L41`. Never wraps. Hotspot `recruit-meter` opens Recruit; tooltip has the full text including `New hero in N`.
- Recruit panel detail shows `Epic+ in N · Legend in N` and `New hero in N`.
- Fortune sits after gold in the progress island row 2: `Fortune 37/100` / `F 37/100`, before the first Legendary `Legend in 14` / `L 14`; hidden if neither fits. Hotspot `fortune-meter` opens Gear. The Gear panel header shows the full text.
- Shots 25–28 (`npm run shot:v14`) with click checks in `shots/v14-chest-choice-checks.json`.

## Designer answers (2026-11-09, applied in PR 4)

1. Legend pity at 60 always gives a Legendary; with every Legendary owned it is a duplicate star. New-hero guarantee is separate.
2. Fortune resets only on Legendary gear from a counted chest. Units: normal 1, Expedition 4, Gold 3. Non-chest gear neither counts nor resets.
3. Full roster: freeze and hide only the new-hero counter. Epic+ and Legend keep running; Fortune never freezes.
4. Pull-log field `pity: 'epic'|'legend'|'newHero'|null`, and a `PITY` tag on the gacha reveal.
5. Expedition units count 4 (CR-14-04 in PR 4); Gold stays unused until the goblin.

Tests: `tests/v14-luck.test.ts` (1M pulls, full roster, pull-log kinds, Fortune units), `tests/v14-offline.test.ts`.

## Config 1.4.2

`src/design-config.json` is the Designer's 1.4.2 file verbatim (SHA-256 `5da9e34cf80aebfed587c410712918291289f25cfbe2109a31e605e50f4db172`).
Changes from 1.4.1: `v14.offline.expeditionChestsPerHour` 3.5, `expeditionChestMax` 28, `rewards.farmTicketChance` 0.005.
The six rules are on by default. `economyOverrides` stays an unread record (and now also records farm 0.005) to be deleted in 1.5.
