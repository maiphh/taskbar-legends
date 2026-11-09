# Taskbar Legends: v1.1 design spec

All numbers live in `../config.json`. This doc explains the rules and the checks; if the two disagree, the config wins and this doc gets fixed. Every rule below has a check the headless sim can run (marked **Test**). Balance version: **1.1.0**. Section 10 contains measured results, not a claim that every target passes. The authoritative file is `/workspace/game-assets/idle-battler/design/config.json`; the runtime copy is `/workspace/taskbar-legends/src/design-config.json` (byte-identical). The repo’s `docs/design-v1.md` is the unchanged historical snapshot, not the current spec.

## 1. Core loop
The party of 3 fights waves automatically. Kills and clears pay gold and XP; clears sometimes drop a gear chest or a summon ticket. The player pulls heroes with tickets, equips and upgrades gear with gold, then the party pushes the next stage. Chapter bosses wait for the player.

## 2. Simulation basics
- Fixed step of 20 ticks per second. All randomness comes from one seeded mulberry32 RNG. Combat itself uses no randomness; only drops, gear rolls and gacha draw from the RNG.
- The lane is 1200 logical px wide. Hero slots sit at x = 140 (front), 95, 50. Enemies spawn at x = 400 and 50 px apart, then walk left.
- A stage is 3 waves. The next wave spawns 1.5 s after the last enemy dies. The next stage starts 5 s after a clear. Reported farm duration includes both wave gaps and this stage gap.
- HP carries between waves. The party fully heals between stages.
- A stage is lost when every hero is dead or the stage timer reaches `timeoutSec` (90 s, or 120 s on bosses).
- **Test:** the same seed and inputs produce a byte-identical state JSON at every tick.

## 3. Heroes
Five roles, defined by base stats at level 1, Common, 1 star (`roles` in config):

| Role | HP | ATK | DEF | Attack every | Range | Skill (every Nth attack) |
|---|---|---|---|---|---|---|
| Tank | 300 | 14 | 40 | 1.2 s | 160 | Guard (5th): shield worth 20% max HP for 3 s |
| Warrior | 200 | 22 | 20 | 0.6 s | 160 | Cleave (4th): 1.8x to target, 1.0x to the next enemy within 40 px |
| Ranger | 140 | 18 | 10 | 0.8 s | 400 | Volley (5th): 0.8x to each of the 3 front-most enemies |
| Mage | 120 | 30 | 5 | 1.5 s | 400 | Fireball (3rd): 2.0x to target, 0.6x to enemies within 50 px |
| Support | 150 | 10 | 10 | 1.5 s | 400 | Heals the lowest-HP% ally for 1.2x ATK if anyone is under 90%, else attacks. Prayer (4th): heals all for 1.0x ATK |

Roster: 18 heroes. Common (6): Medieval Warrior 1, 2, 3, Huntress 1, Martial Hero 1, Wizard. Rare (5): Hero Knight 1, Martial Hero 2, Huntress 2, Evil Wizard 1, Priest. Epic (4): Hero Knight 2, Medieval King 1, Fantasy Warrior, Evil Wizard 2. Legendary (3): Medieval King 2, Martial Hero 3, Evil Wizard 3. Roles and small per-hero tweaks (`mod`) are in `heroes`. The Priest is the only Support, at Rare, so most players get a healer early.

Starter party: Medieval Warrior 2 (tank), Huntress 1, Wizard. The player starts with 10 tickets.

Stat formula: `roleBase x rarityMult x heroMod x (1 + 0.10 x (level - 1)) x (1 + 0.12 x (stars - 1))`, then flat gear is added and percent gear multiplies. Rarity multipliers are 1.0 / 1.15 / 1.35 / 1.6. Level cap 60. XP to next level is `round(1400 x L^1.6)`. Only living party heroes earn XP, each in full. A newly pulled hero joins at `max(1, floor(average party level) - 5)`.
- **Test:** a level 10, 3-star Epic Warrior has max HP `round(200 x 1.35 x 1.9 x 1.24)` = 636 with no gear.

## 4. Combat rules
- Damage is `max(1, round(atk x 100 / (100 + def)))`.
- Heroes stand still and hit the lowest-x living enemy within range; with nothing in range they wait. The first attack fires on the first tick a target is in range, then every `attackIntervalTicks`.
- Enemies walk until in range of the front-most living hero, then stop and attack it. Melee enemies stop at that hero's x + 30 and may overlap.
- A skill replaces every Nth attack of that hero (the attack counter resets each stage).
- **Test:** with seed 1 and no input, a lone level 1 starter Ranger against one stage 1 grunt kills it on its 4th attack (60 HP, 16 per hit).

## 5. Enemies, waves and bosses
Grunt (melee), Archer (range 150), Brute (heavy melee). HP, ATK and DEF are `round(base x 1.04^(stageIndex - 1))`, where stageIndex runs 1 to 20 across both chapters. Intervals, ranges and movement do not scale.

| Enemy | Base HP | ATK | DEF | Attack ticks | Range px | Speed px/s | Kill gold / XP |
|---|---:|---:|---:|---:|---:|---:|---:|
| Grunt | 60 | 48 | 10 | 24 | 30 | 80 | 3 / 3 |
| Archer | 40 | 40 | 5 | 30 | 150 | 80 | 3 / 3 |
| Brute | 225 | 300 | 25 | 36 | 30 | 60 | 8 / 8 |
| Chapter 1 boss | 1500 | 450 | 20 | 30 | 40 | 50 | 200 / 200 |
| Chapter 2 boss | 450 | 1200 | 25 | 30 | 150 | 50 | 400 / 400 |

Exact ordered waves are in `stages`. Non-boss enemy counts per wave: 1-1..1-3 = 3, 1-4..1-6 = 4, 1-7..1-9 = 5; 2-1..2-3 = 4, 2-4..2-6 = 5, 2-7..2-9 = 6. Archers start at 1-3. Brutes appear in wave 3 of 1-6..1-9. In 2-5..2-9, waves 2 and 3 each contain one brute; 2-6..2-9 no longer double-stack brutes in wave 3. Boss introductory waves contain 6 enemies in chapter 1 and 7 in chapter 2.

Bosses replace wave 3 of each x-10 stage, with 2 grunts. Chapter 1 boss: Slam on every 5th attack hits every hero at 1.0x ATK. Chapter 2 boss: ranged Hex Volley every 4th attack hits all at 0.9x ATK. Both enrage after 60 s (ATK x1.5). Boss stats also scale by stage.
- **Test:** with seed 1, the level 1 starter party loses 1-10 in under 60 s.

## 6. Progression and retry
States: PUSHING, FARMING, BOSS_READY, BOSS_FIGHT; COMPLETE farms 2-10 after the final clear.
- PUSHING attempts the highest cleared stage + 1. A win advances; a loss switches to FARMING the highest cleared stage.
- FARMING retries the push when the retry timer runs out or party power reaches 1.05x the power at the failed attempt, whichever comes first. The timer is 120 s, backing off to 240, 480 and then 600 s after repeated losses at the same stage. It resets on a new clear. Party power is the sum of `round(maxHp x 0.2 + atk x 4 + def x 2)`.
- When the next stage is a boss, the state is BOSS_READY. The party keeps farming and never auto-starts the boss. The player clicks to start BOSS_FIGHT; a loss returns to BOSS_READY.
- The strip shows `Farming 1-7, next try in 2:00`, `Pushing 1-8`, `Boss 1-10 ready, click to fight`, or `Boss 1-10!`.
- **Tests:** after a loss at 1-8, the state is FARMING 1-7 and the retry happens at exactly +120 s with no input. A 5% power gain makes the retry happen on the next stage start. With no input, the sim never enters BOSS_FIGHT.

## 7. Rewards and gear
- A kill pays `enemy.gold|xp x 1.10^(stageIndex - 1)`. A clear pays `15 x 1.12^(stageIndex - 1)` gold and XP.
- The first clear of a stage gives a chest plus 3 tickets (5 at x-5, 10 at x-10), 78 tickets in total. Farm clears have a 15% chest chance and a 0.75% ticket chance. Each drop check is independent and uses the seeded RNG.
- A chest contains 1 gear item: 60% Common, 30% Rare, 9% Epic, 1% Legendary. Gear rarity multipliers are 1.0 / 1.3 / 1.7 / 2.2.
- Slots: Weapon (ATK 6), Armor (HP 60 + DEF 8), and Charm (one of ATK%, HP% or attack speed%, rolled 4-8%). Weapon and armor main stats are `round(base x 1.04^(dropStage - 1) x rarityMult x roll(0.9 to 1.1))`, and charm rolls are multiplied by rarity.
- Upgrades add +15% to the rolled stats per level (including charm percentages), up to level 10. Each costs `round(25 x 1.04^(dropStage - 1) x rarityMult x level^1.4)` (next level, so the first upgrade uses level 1) gold. Attack speed is capped by `attackIntervalTicks >= 8`.
- Inventory holds 50 items; overflow auto-salvages to gold.

## 8. Gacha
- 1 ticket per pull; tickets are earned only. Published odds: Common 50%, Rare 33%, Epic 13%, Legendary 4%, uniform within a rarity.
- Pity: if 29 pulls in a row miss Epic+, the 30th is Epic (76.5%) or Legendary (23.5%), preferring a hero the player doesn't own. Any Epic+ resets the counter.
- A duplicate adds +1 star (max 6). Past 6 stars, a duplicate turns into gold (100 x rarity stat multiplier).
- **Test:** over 1,000,000 seeded pulls, each rarity lands within ±0.3 points of its rate (including the effect of pity), and no window of 30 pulls lacks an Epic+.

## 9. Idle and offline
- While the app is open, the sim runs in real time with full rewards.
- Closed: `t = min(time closed, 8 h)`. The game credits `floor(t / avgFarmClearSec)` clears of the farm stage at its expected gold and XP. `avgFarmClearSec` is the average of the last 10 farm clears (30 s by default). It also grants 1 chest per 2 h (max 4). There are no tickets offline and no progress.
- **Test:** 12 h closed pays exactly the same as 8 h. With a stable party/level and farm-time estimate, 8 h closed pays within 1% of 8 h of open farming at that stage, minus tickets; a changing-level run is not expected to match.

## 10. Balance targets
These use the reference player in `referencePlayer`: 6 h open per day, spends every ticket at once, auto-equips the best gear, spends gold on the cheapest upgrade, and fights each boss as soon as it is ready (and again after a 5% power gain).
1. A new player clears 1-5 within 10 minutes of open play (seeds 1 to 100, at least 95%).
2. The chapter 1 boss is first beaten between 1.5 and 2.5 hours of open play (median across 100 seeds).
3. The chapter 2 boss is first beaten on day 4 to day 6 (median).
4. Median pulls to own all 18 heroes is 100 to 140 (10,000 gacha-only seeds). The reference player owns the full roster by day 6 to 8 (median).
5. The idle starter party with no input never clears 1-8 within 1 h, so upgrades and pulls must matter.
6. Farming the highest cleared stage takes 20 to 40 s per clear at every point in the reference run.
7. Pushes don't stall: in the reference run, no non-boss stage takes more than 45 minutes from first attempt to clear.

### Measured v1.1 results (25 matched seeds, 1..25)
Seven-day reference metrics use 6 h open/day and six capped 8 h offline credits. Run day 8 only to resolve T4's deadline. Before is the untouched 1.0.0-design config. Five exact seven-day baseline runs preceded any edits; wider day-eight runs retain identical day-seven snapshots. Final 1.1.0 seven-day seeds 1..5 were rerun and matched those snapshots numerically. No population claim for the full 100-seed acceptance cohort is made.

Entries are **median [min, max]**. `>7` / `>8` is right-censoring, not an excluded failure or an invented completion date. T6 gives medians/ranges of each run's lifetime minimum and maximum, not the median of the last ten clears. T7 includes all attempted non-boss stages; none remain pending at day 7.

| Target / metric | Before | After | Before → after |
|---|---|---|---|
| T1: 1-5, open seconds | 135.15 [105.25, 151.25] | 113.45 [96.75, 130.45] | PASS → PASS (25/25) |
| T2: chapter 1, open hours | 0.370 [0.146, 0.725] | 2.443 [1.514, 10.406] | FAIL → PASS median |
| T3: chapter 2, day | >7 [>7, >7] | 4 [2, 7] | FAIL → PASS median |
| T4a: full-roster pulls, 10,000 gacha-only seeds | 124 [25, 803] | 124 [25, 803] | PASS → PASS |
| T4b: reference full-roster day | >8 [1, >8] | 8 [1, >8] | FAIL → PASS median |
| T5: untouched highest clear after 1 h | 1-9 [1-9, 1-9] | 1-6 [1-6, 1-6] | FAIL → PASS (25/25) |
| T6: per-run minimum farm seconds | 39.95 [33.85, 46.05] | 23.45 [20.05, 27.55] | See next row |
| T6: per-run maximum farm seconds | 90.35 [87.60, 91.90] | 37.70 [30.55, 42.05] | FAIL → FAIL (19/25 runs pass) |
| T7: worst non-boss stall, seconds | 1863.55 [628.85, 4790.55] | 32.75 [27.05, 436.80] | FAIL → PASS (21/25 → 25/25) |

T5's old 1-8 clear was 221.95 s in every seed; the new party never clears it within 3600 s. T6 pools 75,196 before / 121,330 after farm clears. Its worst upper-bound miss is now 2.05 s; six seeds still fail the strict every-clear rule. T4's median is at the upper edge: 18/25 baseline and 12/25 tuned runs still lack the full roster at day 8. T2 has a 10.406 h tail despite the passing median. These are real tails, not guarantees of two-hour bosses or day-eight collection for every player.

**Remaining target / code boundary:** T6 is not achieved. The existing engine uses the same encounter stats, formation policy and real-time movement for pushes and repeat farming; equipment/party changes can also worsen a previously cleared encounter. No config field provides farm-only pacing or a per-stage farm speed budget. Further config-only tuning might work, but was not proven; do not claim it is mathematically impossible. A robust code option is explicit repeat-farm encounter speed control with a 20 s minimum cycle and <=40 s successful-clear budget, tested through formation/gear changes and campaign completion. Do not simply clamp the reported metric, shorten timeouts to discard slow clears, or silently farm a lower stage. No such code was changed here. A 100-seed reference check remains a release validation step.

Reproduce: `npm run sim -- --policy reference --days 7 --seed N`; use `--days 8` for roster censoring. `--hours 1` without a policy is untouched-starter play. T1/T5/T6 are included by `balanceReport`; `--gacha-seeds 10000` is its default (1 was used only to avoid repeating the identical gacha cohort during tuning). The final default command reran all 10,000 gacha seeds. Raw JSONs, scratch runner and `aggregate25.json` are in `/tmp/tbl-tuning/`; only the config pair and this authoritative spec were edited for delivery.

## 11. Feedback needs (for Game Graphic Designer)
In an 80 px strip, every effect stays inside the lane and reads at a glance:
- Hits: a 2-frame white flash on the target, plus floating damage numbers (crits don't exist, so use one style; heals in green).
- Skills: a short role-coloured flash on the caster, plus Guard shield outline, Cleave arc, Volley 3 arrows, Fireball burst ring of 50 px, and Prayer green sparkle on all heroes.
- Boss: an entry banner, a 1 px screen shake on Slam, and a red tint on enrage.
- Rewards: gold and XP tick up in the status area; chest and ticket drops pop with a small sound. Clear and loss each get a one-word toast.
- Pull: a rarity-coloured reveal (grey, blue, purple, gold), with a distinct sting for Legendary and for pity.
- Retry countdown in the status text; a pulsing boss button in BOSS_READY.

## Tuning log v1.1
All changes are config-only; hero roster/rarities, level/star multipliers and caps, gacha probabilities/pity/duplicates, first-clear tickets, chest odds, offline cap and retry/boss gating are unchanged. This is a material curve rebalance, not ±10% polish.

| Config field | Old → new | Reason |
|---|---|---|
| `version` | `1.0.0-design` → `1.1.0` | Identify tuned saves/reports. |
| `growth.xpToNext.a` | 40 → 1400 | Prevent passive starters racing through chapter 1; stretch level growth across days rather than capping on day 2. `p=1.6` and linear +10% stat growth remain unchanged. |
| `enemies.scalingPerStage` | 1.12 → 1.04 | Flatten late HP/ATK/DEF; the same supported scalar also controls gear main rolls and upgrade stage costs. Kill/clear reward scalars stay 1.10/1.12. |
| `enemies.grunt.atk`, `archer.atk` | 12 → 48; 10 → 40 | Earlier survival pressure without increasing normal-fight HP. |
| `enemies.brute.hp`, `.atk` | 150 → 225; 20 → 300 | Make the first heavy enemy a meaningful upgrade/healing check. |
| `enemies.boss_ch1.hp`, `.atk` | 2400 → 1500; 36 → 450 | Shorter but dangerous boss fight; reach the two-hour median with the flatter scale. |
| `enemies.boss_ch2.hp`, `.atk` | 3000 → 450; 42 → 1200 | Remove the old late HP wall; preserve a survivability/burst check near day 4. Skills, intervals and enrage are unchanged. |
| `roles.warrior.attackIntervalTicks` | 20 → 12 | Give the reference policy's melee DPS a viable repeat-clear cadence. Hero-specific -2/-3 tick modifiers remain additive. |
| `gear.slots.weapon.main.atk` | 4 → 6 | Make equipped/upgraded weapons matter versus passive XP alone. |
| `gear.slots.armor.main.hp`, `.def` | 30 → 60; 4 → 8 | Let actively equipped parties survive heavy attacks without buffing untouched starters. |
| `gear.upgrade.mainPerLevel` | 0.10 → 0.15 | Stronger purchased upgrades shorten late fights and reduce non-boss stalls. |
| `sim.enemySpawnX`, `sim.stageGapSec` | 560 → 400; 2 → 5 | Cut walking; retain a visible reset/reward beat and protect the lower farm-time bound. Wave gap remains 1.5 s, spacing remains 50 px, speeds unchanged. |
| `stages[index 16..19].waves[2]` | First of two brutes → grunt | One brute remains in waves 2 and 3; remove the double-heavy burst in 2-6..2-9 that caused long push stalls and unstable farming. Enemy counts unchanged. |
| `rewards.farmTicketChance` | 0.01 → 0.0075 | Faster farm throughput otherwise over-supplies earned summons; pace the roster median to day 8 without changing gacha rates. |
| `gear.upgrade.costFormula` string | Literal `1.12^(dropStage-1)` → `scalingPerStage^(dropStage-1)` | Fix stale explanatory text; runtime already reads the shared scalar. No additional economy change. |

Verification: typecheck PASS, lint PASS, 23 tests PASS. The final default gacha cohort reproduces exactly 124 median pulls, range 25..803. The two config files must be byte-identical (`diff -u` produces no output, exit 0). No commit, push or code edits by this tuning task. Other agents' concurrent art/test/browser-shot edits in the repository were left untouched.
