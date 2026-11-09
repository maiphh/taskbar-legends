# v1.4 luck: recruit pity (CR-14-01/02) and gear Fortune (CR-14-03)

Rules are opt-in, like the chest rules: `--v14 recruitPity,gearFortune` (or `all`) in `scripts/sim.ts`, `?v14=…` in the URL,
`__game.setV14Rules([...])` in the debug API, `--rules` in `scripts/v14-targets.ts`. With the rules off, `CONFIG.v14.recruit`
and `CONFIG.v14.fortune` are inert (0 = off) and 1.3.0 is byte-identical (golden hash and 25-seed aggregate checked).

## Recruit (design.md §14.1, keys `v14.gacha`)

- Counters: `pity` (Epic+ at 30, unchanged), `pityLegendary` (0..59), `pityNewHero` (0..19).
- Precedence: Legendary pity (60th pull, no rarity RNG drawn), then Epic+ pity, then the normal roll. A Legendary resets Epic+ pity.
- New-hero guarantee (20th pull since a new hero): only changes the pick. If the rolled rarity has no unowned hero it falls back to the most common rarity that still has one.
- `legendaryPityPrefersUnowned`: a Legendary-pity pull picks an unowned Legendary when one exists.
- Once the roster is complete the counters freeze and the meters hide (rule on only).

## Fortune (design.md §14.2, keys `v14.gearPity`)

- `gearSinceLegendary` (0..99), `gearLegendaryFound`. First Legendary forced by roll 40, then every ≤ 100 rolls. No soft ramp.
- One chest = `rollUnits.chest` (1) unit. In a pick-1-of-2 chest the second option counts 0 units, so the chest counts once.

## Saves

All four fields are optional and validated (bounds, and `gearSinceLegendary < 40` until the first Legendary). Old saves load unchanged; no migration.

## UI (design.md §16; no ui/ spec exists for these meters)

- Recruit meter takes the DPS slot in the actions island row 1 (compact: the RUNNING/PAUSED slot; the pause button still shows state).
  Text `Epic+ in 12 · Legend in 41`, falling back to `E+12 L41 N20`, then `E+12 L41`. Never wraps. Hotspot `recruit-meter` opens Recruit; tooltip has the full text including `New hero in N`.
- Recruit panel detail shows `Epic+ in N · Legend in N` and `New hero in N`.
- Fortune sits after gold in the progress island row 2: `Fortune 37/100` / `F 37/100`, before the first Legendary `Legend in 14` / `L 14`; hidden if neither fits. Hotspot `fortune-meter` opens Gear. The Gear panel header shows the full text.
- Shots 25–28 (`npm run shot:v14`) with click checks in `shots/v14-chest-choice-checks.json`.

## Spec questions (implemented as stated, open for the Designer)

1. When every Legendary is owned, the new-hero fallback can override the Legendary-pity rarity (matches the prototype).
2. Any Legendary gear (natural roll, or option B of a choice) resets Fortune; the prototype reset only on units > 0.
3. After the full roster all recruit counters, including Epic+, freeze and no pity fires (rule on only).
4. A Legendary-pity pull sets the pull event `pity: true`.
5. `rollUnits.expeditionChest` / `goldChest` are read but unused (no Expedition Chests or goblin yet).
