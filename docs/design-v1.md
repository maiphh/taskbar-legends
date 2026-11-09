# Taskbar Legends: v1 design spec

All numbers live in `../config.json`. This doc explains the rules and the checks; if the two disagree, the config wins and this doc gets fixed. Every rule below has a check the headless sim can run (marked **Test**). Numbers are a first pass: they must be tuned against the balance targets in section 10 once the sim runs.

## 1. Core loop
The party of 3 fights waves automatically. Kills and clears pay gold and XP; clears sometimes drop a gear chest or a summon ticket. The player pulls heroes with tickets, equips and upgrades gear with gold, then the party pushes the next stage. Chapter bosses wait for the player.

## 2. Simulation basics
- Fixed step of 20 ticks per second. All randomness comes from one seeded mulberry32 RNG. Combat itself uses no randomness; only drops, gear rolls and gacha draw from the RNG.
- The lane is 1200 logical px wide. Hero slots sit at x = 140 (front), 95, 50. Enemies spawn at x = 560 and 50 px apart, then walk left.
- A stage is 3 waves. The next wave spawns 1.5 s after the last enemy dies. The next stage starts 2 s after a clear.
- HP carries between waves. The party fully heals between stages.
- A stage is lost when every hero is dead or the stage timer reaches `timeoutSec` (90 s, or 120 s on bosses).
- **Test:** the same seed and inputs produce a byte-identical state JSON at every tick.

## 3. Heroes
Five roles, defined by base stats at level 1, Common, 1 star (`roles` in config):

| Role | HP | ATK | DEF | Attack every | Range | Skill (every Nth attack) |
|---|---|---|---|---|---|---|
| Tank | 300 | 14 | 40 | 1.2 s | 160 | Guard (5th): shield worth 20% max HP for 3 s |
| Warrior | 200 | 22 | 20 | 1.0 s | 160 | Cleave (4th): 1.8x to target, 1.0x to the next enemy within 40 px |
| Ranger | 140 | 18 | 10 | 0.8 s | 400 | Volley (5th): 0.8x to each of the 3 front-most enemies |
| Mage | 120 | 30 | 5 | 1.5 s | 400 | Fireball (3rd): 2.0x to target, 0.6x to enemies within 50 px |
| Support | 150 | 10 | 10 | 1.5 s | 400 | Heals the lowest-HP% ally for 1.2x ATK if anyone is under 90%, else attacks. Prayer (4th): heals all for 1.0x ATK |

Roster: 18 heroes. Common (6): Medieval Warrior 1, 2, 3, Huntress 1, Martial Hero 1, Wizard. Rare (5): Hero Knight 1, Martial Hero 2, Huntress 2, Evil Wizard 1, Priest. Epic (4): Hero Knight 2, Medieval King 1, Fantasy Warrior, Evil Wizard 2. Legendary (3): Medieval King 2, Martial Hero 3, Evil Wizard 3. Roles and small per-hero tweaks (`mod`) are in `heroes`. The Priest is the only Support, at Rare, so most players get a healer early.

Starter party: Medieval Warrior 2 (tank), Huntress 1, Wizard. The player starts with 10 tickets.

Stat formula: `roleBase x rarityMult x heroMod x (1 + 0.10 x (level - 1)) x (1 + 0.12 x (stars - 1))`, then flat gear is added and percent gear multiplies. Rarity multipliers are 1.0 / 1.15 / 1.35 / 1.6. Level cap 60. XP to next level is `round(40 x L^1.6)`. Only living party heroes earn XP, each in full. A newly pulled hero joins at `max(1, floor(average party level) - 5)`.
- **Test:** a level 10, 3-star Epic Warrior has max HP `round(200 x 1.35 x 1.9 x 1.24)` = 636 with no gear.

## 4. Combat rules
- Damage is `max(1, round(atk x 100 / (100 + def)))`.
- Heroes stand still and hit the lowest-x living enemy within range; with nothing in range they wait. The first attack fires on the first tick a target is in range, then every `attackIntervalTicks`.
- Enemies walk until in range of the front-most living hero, then stop and attack it. Melee enemies stop at that hero's x + 30 and may overlap.
- A skill replaces every Nth attack of that hero (the attack counter resets each stage).
- **Test:** with seed 1 and no input, a lone level 1 starter Ranger against one stage 1 grunt kills it on its 4th attack (60 HP, 16 per hit).

## 5. Enemies, waves and bosses
Grunt (melee), Archer (range 150), Brute (heavy melee). Each stat is `base x 1.12^(stageIndex - 1)`, where stageIndex runs 1 to 20 across both chapters. Waves are listed per stage in `stages`: 3 enemies per wave at 1-1, rising by 1 every 3 stages; archers from stage 3; brutes in wave 3 from stage 6; chapter 2 adds an extra archer and more brutes.

Bosses replace wave 3 of each x-10 stage, with 2 grunts. Chapter 1 boss: 2400 HP, 36 ATK, Slam on every 5th attack hits every hero. Chapter 2 boss: 3000 HP, 42 ATK, ranged, Hex Volley every 4th attack hits all. Both enrage after 60 s (ATK x1.5). Boss stats also scale by stage.
- **Test:** with seed 1, the level 1 starter party loses 1-10 in under 60 s.

## 6. Progression and retry
States: PUSHING, FARMING, BOSS_READY, BOSS_FIGHT.
- PUSHING attempts the highest cleared stage + 1. A win advances; a loss switches to FARMING the highest cleared stage.
- FARMING retries the push when the retry timer runs out or party power reaches 1.05x the power at the failed attempt, whichever comes first. The timer is 120 s, backing off to 240, 480 and then 600 s after repeated losses at the same stage. It resets on a new clear. Party power is the sum of `round(maxHp x 0.2 + atk x 4 + def x 2)`.
- When the next stage is a boss, the state is BOSS_READY. The party keeps farming and never auto-starts the boss. The player clicks to start BOSS_FIGHT; a loss returns to BOSS_READY.
- The strip shows `Farming 1-7, next try in 2:00`, `Pushing 1-8`, `Boss 1-10 ready, click to fight`, or `Boss 1-10!`.
- **Tests:** after a loss at 1-8, the state is FARMING 1-7 and the retry happens at exactly +120 s with no input. A 5% power gain makes the retry happen on the next stage start. With no input, the sim never enters BOSS_FIGHT.

## 7. Rewards and gear
- A kill pays `enemy.gold|xp x 1.10^(stageIndex - 1)`. A clear pays `15 x 1.12^(stageIndex - 1)` gold and XP.
- The first clear of a stage gives a chest plus 3 tickets (5 at x-5, 10 at x-10), 78 tickets in total. Farm clears have a 15% chest chance and a 1% ticket chance.
- A chest contains 1 gear item: 60% Common, 30% Rare, 9% Epic, 1% Legendary. Gear rarity multipliers are 1.0 / 1.3 / 1.7 / 2.2.
- Slots: Weapon (ATK 4), Armor (HP 30 + DEF 4), and Charm (one of ATK%, HP% or attack speed%, rolled 4-8%). Weapon and armor main stats are `round(base x 1.12^(dropStage - 1) x rarityMult x roll(0.9 to 1.1))`, and charm rolls are multiplied by rarity.
- Upgrades add +10% main stat per level, up to level 10. Each costs `round(25 x 1.12^(dropStage - 1) x rarityMult x level^1.4)` gold. Attack speed is capped by `attackIntervalTicks >= 8`.
- Inventory holds 50 items; overflow auto-salvages to gold.

## 8. Gacha
- 1 ticket per pull; tickets are earned only. Published odds: Common 50%, Rare 33%, Epic 13%, Legendary 4%, uniform within a rarity.
- Pity: if 29 pulls in a row miss Epic+, the 30th is Epic (76.5%) or Legendary (23.5%), preferring a hero the player doesn't own. Any Epic+ resets the counter.
- A duplicate adds +1 star (max 6). Past 6 stars, a duplicate turns into gold (100 x rarity stat multiplier).
- **Test:** over 1,000,000 seeded pulls, each rarity lands within ±0.3 points of its rate (including the effect of pity), and no window of 30 pulls lacks an Epic+.

## 9. Idle and offline
- While the app is open, the sim runs in real time with full rewards.
- Closed: `t = min(time closed, 8 h)`. The game credits `floor(t / avgFarmClearSec)` clears of the farm stage at its expected gold and XP. `avgFarmClearSec` is the average of the last 10 farm clears (30 s by default). It also grants 1 chest per 2 h (max 4). There are no tickets offline and no progress.
- **Test:** 12 h closed pays exactly the same as 8 h. 8 h closed pays within 1% of 8 h of open farming at that stage, minus tickets.

## 10. Balance targets
These use the reference player in `referencePlayer`: 6 h open per day, spends every ticket at once, auto-equips the best gear, spends gold on the cheapest upgrade, and fights each boss as soon as it is ready (and again after a 5% power gain).
1. A new player clears 1-5 within 10 minutes of open play (seeds 1 to 100, at least 95%).
2. The chapter 1 boss is first beaten between 1:30 and 2:30 of open play (median across 100 seeds).
3. The chapter 2 boss is first beaten on day 4 to day 6 (median).
4. Median pulls to own all 18 heroes is 100 to 140 (10,000 gacha-only seeds). The reference player owns the full roster by day 6 to 8 (median).
5. The idle starter party with no input never clears 1-8 within 1 h, so upgrades and pulls must matter.
6. Farming the highest cleared stage takes 20 to 40 s per clear at every point in the reference run.
7. Pushes don't stall: in the reference run, no non-boss stage takes more than 45 minutes from first attempt to clear.

## 11. Feedback needs (for Game Graphic Designer)
In an 80 px strip, every effect stays inside the lane and reads at a glance:
- Hits: a 2-frame white flash on the target, plus floating damage numbers (crits don't exist, so use one style; heals in green).
- Skills: a short role-coloured flash on the caster, plus Guard shield outline, Cleave arc, Volley 3 arrows, Fireball burst ring of 50 px, and Prayer green sparkle on all heroes.
- Boss: an entry banner, a 1 px screen shake on Slam, and a red tint on enrage.
- Rewards: gold and XP tick up in the status area; chest and ticket drops pop with a small sound. Clear and loss each get a one-word toast.
- Pull: a rarity-coloured reveal (grey, blue, purple, gold), with a distinct sting for Legendary and for pity.
- Retry countdown in the status text; a pulsing boss button in BOSS_READY.
