# v1.4 chests: CR-14-08, CR-14-09, zero tickets

Source: Game Designer v1.4 spec, `design/docs/design.md` §14–§18. Config: `design/config.json`, SHA-256
`5da9e34cf80aebfed587c410712918291289f25cfbe2109a31e605e50f4db172` (config 1.4.2), copied byte-for-byte to `src/design-config.json`.

## What ships
| CR | Keys (config.json → `v14`) | Default (rule off) | Rule on |
|---|---|---|---|
| CR-14-08 chest pick-1-of-2 | `chestChoice.options`, `fromStage` | options 1: one item per chest (1.3.0) | 2 items per chest at dropStage ≥ fromStage go to `state.pendingChoice`. Keep one (`{type:'chooseChest', keep:0\|1}`); the other is salvaged for `salvageBase × rarityMult` gold. Queue ≤ 3; a 4th auto-resolves the oldest by gearScore (ties keep option 0). Event `chestChoice {options:[id,id], kept}`; the kept item also emits `gear`. |
| CR-14-09 farm chest pity | `farmChest.baseChance`, `guaranteeEvery`, `fromStage` | null: `rewards.farmChestChance` everywhere | Repeat farm clears at stage ≥ 10 roll 0.03, plus a guaranteed chest on the 7th dry clear (`state.farmChestDry`; `guaranteeEvery` 7). Below stage 10 the 1.3.0 0.075 roll applies and the counter is untouched. |
| CR-14-11 (part) zero tickets | — | — | A stage with `firstClearTickets` 0 grants nothing and logs no `tickets` event (already on main since caa5e5c; now tested with v14 rules on). Saves accept `balance` "1.3.0", "1.4.0" and "1.4.1" (and the current version). |

The `v14` block is the designer's *target* values. From 1.4.2 the six rules are on by default in the game and sim
(`?v14=none` / `--v14 none` opts out). `chestChoice.fromStage` is 10 and `farmChest.guaranteeEvery` is 7.
Rules are not saved:

- sim: `npx tsx scripts/sim.ts` (defaults to `--v14 all`); `--v14 none` opts out
- targets: `npm run sim:v14` (writes `shots/v14-targets.json`)
- browser preview: on by default; `?v14=none` opts out; `__game.setV14Rules([...])`, `__game.getV14Rules()`

## Saves
New optional state fields, so no save-version bump or migration is needed: `pendingChoice` (array of `[Gear, Gear]`, ≤ 3)
and `farmChestDry` (int). 1.3.0 saves load unchanged. Validation rejects pending items that reuse an inventory id, use a
future id or another seed's namespace, or a dry counter at or past the guarantee.

## UI (minimal, inside the existing layout)
- Strip progress island: while a choice waits, the heading reads `Chest: pick 1 of 2` (§16 fallback `Pick 1/2`) with a
  chest icon; the heading is a hotspot that opens the Gear tab. A running boss countdown keeps the heading. BOSS_READY
  keeps its Fight/Retry button in row 2.
- Gear tab pip lights while a choice waits.
- Gear panel: the oldest choice replaces the inventory grid with two cards (rarity/slot, stats, score, delta vs the
  selected party slot, drop stage, salvage value of the other) and a Keep button each; `{n} WAITING` when more queue.
- All of it sits inside the existing `progress` and `management` hit regions (checked in `shots/v14-chest-choice-checks.json`).

## Not in this PR (luck: see V14-LUCK.md)
Recruit pity and Fortune (CR-14-01..03), Expedition Chests and offline tickets (04, 05), goblin (06, 07), Golden Wave (10),
meters/strings (12), and `v14.economyOverrides` (§18: only together with 01, 02, 05, 06).
