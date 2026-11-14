# Turn combat plan

Date: 2026-11-11. Branch: `feat/enhancement`.

The player goal is a compact party fight that stays on the heroes. Idle play is auto mode for the same turn resolver. Formation does not walk. A unit moves only between waves, or for a melee strike that jumps out and returns. Spells stay in the slot.

This replaces the phase 3 rule that the camera must frame committed threats. Threats that sit outside the party frame keep an edge marker. They do not move the camera.

## What the two reference games actually do

Sources: [Summoners War attack bar](https://summonerswar.fandom.com/wiki/Attack_Bar), [Summoners War abilities](https://summonerswar.fandom.com/wiki/Abilities), [Dislyte combat mechanisms](https://dislyte.fandom.com/wiki/Combat_Mechanisms), [Dislyte AP](https://playdislyte.com/?p=2442).

Both games are speed-gauge turn combat, not a shared round where everyone acts once.

Summoners War fills an attack bar. Each tick adds 7% of that unit's speed. The bar may pass 100. The highest bar acts. A bonus turn does not spend another tick. After the action, inability effects have already been checked, then buff and debuff durations tick down on that unit. Speed buff is +30% fill rate. Speed debuff slows the fill. Attack buff is +50%. Defense break is a separate debuff. Stun, freeze, and sleep skip the action and also freeze cooldowns. Silence blocks cooldown skills but lets cooldowns tick. Immunity blocks new debuffs. Buff block stops new buffs. Accuracy against resistance is the debuff check. Auto battle calls the same skills. It does not use a second combat math.

Dislyte uses the same gauge and calls it AP. Speed decides the fill rate and the starting order. Skills push or pull AP by a percent, steal it, or grant a bonus turn. Equal speed breaks ties from the left slot toward the right. The action bar is the portrait strip. Debuff chance is accuracy against resistance. Crowd control differs on purpose. Sleep breaks when a direct hit lands, and damage over time does not wake the target. Freeze stops cooldown ticks. Petrification locks the AP gauge. Immunity does not stop AP reduction. Buff block does not strip buffs that are already on.

Neither game walks the formation during the fight. The strike animation is the move. A slash leaves the slot, hits, and returns. A cast plays on the slot. Wave entry is the other time bodies change places.

We take Summoners War's tick math because the 7% rule is exact. We take Dislyte's AP push, pull, and crowd-control split as status components. We do not add elements, relics, or a second manual combat math.

## Combat model

One pure resolver. Auto and a future manual pick both call it.

A tick does this.

1. Every living unit gains `round(speed * 7)` gauge points. Gauge is an integer. 10000 is a full bar, so 7% of speed is `speed * 7` when speed is stored as an integer stat, not as pixels per second.
2. While any living unit has gauge at or above 10000, the highest gauge acts. Ties break by slot, party left to right, then enemies. A bonus turn is another action with no fill step.
3. On that action, tick statuses whose duration is in turns, skip the action if the unit cannot act, otherwise run the chosen skill and then spend one cooldown tick on the other skills.
4. The skill does not write a new home `x`. Home `x` is the formation slot. A leap emits a presentation cue and the sim position stays on the slot.

Pixel `unit.speed` stays the old movement number until the walker is removed. Turn speed is a new `spd` on the definition. Suggested bases, all data: tank 90, melee 100, ranged 105, support 115. Supports go first so buffs land before damage. Gear can add `spd` later without a new formula.

Auto mode is the idle loop. `step()` keeps calling the tick. The chooser is `chooseSkill(state, unit)`. The default chooser spends a ready cooldown skill, otherwise the basic. Manual mode later pauses when a hero gauge is full and passes the clicked skill id to the same resolver. Enemies always use the auto chooser.

Formation slots stay at `heroSlotX` and a fixed enemy line. Between waves, enemies may move from an off-screen entry x to their slot. That is the only sim locomotion. During a wave, `unit.x` does not change.

## Skills

A skill is data. Adding a character is a definition row. Adding a skill is a row that points at status ids and a delivery.

```ts
type SkillDelivery = 'leap' | 'cast'
type SkillTarget = 'enemyFront' | 'enemyLowest' | 'enemyAll' | 'allyLowest' | 'allyAll' | 'self'

type SkillEffect =
  | { op: 'damage'; coefficient: number }
  | { op: 'heal'; coefficient: number }
  | { op: 'shield'; fraction: number }
  | { op: 'applyStatus'; statusId: string; turns: number; magnitude: number; chance: number }
  | { op: 'gauge'; delta: number }
  | { op: 'cooldown'; delta: number }

type SkillDef = {
  id: string
  delivery: SkillDelivery
  cooldownTurns: number
  target: SkillTarget
  effects: SkillEffect[]
}
```

`leap` is a slash, cleave, or any body hit. Presentation jumps to the target and returns. `cast` is a spell, shot, heal, or buff. Presentation stays on the slot. A projectile, if we still draw one, is a cue from the slot. It is not a sim body that has to travel before the hit counts. The hit resolves on the action.

Current hero basics map like this. Melee styles become `leap`. Magic, projectile, and heal become `cast`. Existing active kinds stay as effect lists rather than new tick branches. `cleave` is a leap that also hits one nearby enemy. `fireball` is a cast that hits the target and the bodies in its recorded radius. `intercept` stays a reactive status check on an ally hit, not a walk.

Chance on `applyStatus` is accuracy against resistance. Both default to 0 until a unit definition sets them. A roll of 0 always lands. Immunity blocks debuffs. Buff block blocks buffs. Neither strips what is already applied. AP changes ignore immunity, matching Dislyte.

## Status components

One catalog. Combat asks the catalog for numbers. It does not switch on skill names.

```ts
type StatusPolarity = 'buff' | 'debuff'
type StatusStack = 'refresh' | 'strongest' | 'add'

type StatusDef = {
  id: string
  polarity: StatusPolarity
  stack: StatusStack
  maxStacks: number
  preventsAction: boolean
  freezesCooldown: boolean
  breaksOnHit: boolean
  blocksDebuff: boolean
  blocksBuff: boolean
  locksGauge: boolean
}
```

A running status stores `id`, `sourceId`, `targetId`, `stacks`, `magnitude`, `turnsLeft`. Magnitude is the per-stack number the catalog interprets.

| id | polarity | stack | what it does |
| --- | --- | --- | --- |
| atkUp | buff | strongest | adds magnitude to attack, cap 0.5 |
| atkDown | debuff | strongest | subtracts magnitude from attack, cap 0.5 |
| defDown | debuff | strongest | subtracts magnitude from defense, cap 0.6 |
| dmgReduction | buff | strongest | subtracts magnitude from damage taken, cap 0.5 |
| spdUp | buff | strongest | multiplies gauge fill by 1 + magnitude |
| spdDown | debuff | strongest | multiplies gauge fill by 1 - magnitude |
| shield | buff | strongest | absorbs the next damage, same strongest-refresh rule as today |
| hot | buff | add | heals fraction of max HP at the start of the owner's turn |
| dot | debuff | add | damages fraction of max HP at the start of the owner's turn, does not break sleep |
| stun | debuff | refresh | skips the action and freezes cooldowns |
| sleep | debuff | refresh | skips the action and freezes cooldowns, a direct hit removes it |
| immunity | buff | refresh | blocks new debuffs, does not block gauge changes |
| buffBlock | debuff | refresh | blocks new buffs, does not strip old ones |

`apply`, `dispel`, `onTurnStart`, `onHit`, `effectiveAttack`, `effectiveDefense`, `damageTaken`, `fillMultiplier`, and `canAct` are the whole API. A future status is a catalog row plus one of those readers if it needs a new number. It is not a new function in the tick.

The current `partyEffects` kinds map onto `atkUp`, `atkDown`, `defDown`, and `dmgReduction`. Slice 2 deletes the parallel applier once callers use the catalog. Until then the catalog is the new code path and the old applier stays so the live fight does not change twice in one step.

## Presentation

The compact battle bar is the play field. It does not draw a progress island or an actions island. A short stage id sits at the top left of the field. The only control on the bar is the Menu button. Edit stays in the DOM and is hidden on the idle bar.

Standing positions are screen slots from `formationScreenX`, spread across the field with a gap between the party and the enemy line. They do not use the cramped world cluster. A leap moves between those screen slots and back. A cast stays on its slot. Sim `x` stays on the formation home so cleave and intercept keep their distances. The camera does not slide those screen slots.

Each wave is 3 or 5 enemies. Larger design waves are trimmed to 5. Smaller waves are padded to 3. Boss waves are the boss plus enough adds to make 3, or 5 when the wave already has more adds.

Turns are readable. Party-v2 battle and the wave rest run one combat substep per wall tick, even when the farm clock scale is higher. Windup is 10 ticks, the attack pose lasts 10, and recovery holds 18 ticks so there is a beat after the swing before the next actor starts. Gauges stay frozen through that hold.

A leap cue is `{ unitId, targetId, phase: 'out' | 'back' }`. The renderer offsets the sprite toward the target and back across a fixed number of frames. Sim `x` stays on the slot, so a replay of the same state draws the same home position. A cast cue does not offset the sprite.

Between waves the enemy entry is one lerp from `enemySpawnX` to `enemyFormationX`. Heroes do not join that lerp. Gauges do not fill and nobody acts until every living enemy has arrived. During the wave, `unit.x` does not change. One actor presents at a time. Gauges do not fill during windup or recovery.

## Build order

Each slice ends green before the next one starts.

1. Party camera. `stepCombatCamera` frames `partyXs` only. Tests that used a threat to shove the camera are rewritten to that rule. Edge markers stay.
2. Catalog, gauge, and skill runner as pure modules under `src/core/turn/`. Tests cover fill order, overflow ties, bonus turns, status caps, sleep breaking on a hit, dot not breaking sleep, immunity, and a leap that leaves slot x unchanged.
3. Point `partyCombatTick` at the runner. Hold formation. Auto chooser. Retire approach movement, assassin travel damage, and projectile bodies as sim travel. Spawn enemies on the entry x, walk them to `enemyFormationX` before the first action, then freeze `unit.x`. The camera frames hero homes and those enemy slots. Update the party combat tests to the new contract. Presentation cues drive the slash and the cast.
4. Show the gauge as a thin portrait strip only after the resolver is the live fight. No new panel.

Out of scope until a later request: elements, a manual skill bar, new heroes, and gear that changes turn speed.

## Files

Slice 1 and 2 may add `src/core/turn/statuses.ts`, `src/core/turn/action-bar.ts`, `src/core/turn/skills.ts`, and `tests/turn-combat.test.ts`. Slice 1 may edit `src/party-camera.ts`, `src/renderer.ts`, and `tests/party-camera.test.ts`. Slice 3 may edit `src/core/party-combat.ts` and the party tests. Do not edit design JSON or the save schema until a status must persist. Statuses live for one encounter and are cleared with the existing encounter reset.
