# Phase 1 implementation contract: combat and visual slice

Status: handoff specification; implementation begins only after Phase 0 passes review.

This file makes the Phase 1 logic concrete for the implementor. The product proposal remains `COMPACT-PARTY-REDESIGN-PLAN.md`. If a requirement cannot be met, report the exact conflict to the orchestrator before substituting behavior.

## Scope and staging

Deliver a playable preview with a tank, a melee DPS, a healer, a melee enemy, and an archer. Fix shared positioning, approach movement, melee reach, attack windup/impact, and deterministic save/resume. Desktop resizing and the new menu belong to Phase 2. Additional kits, projectiles, statuses, AoE, and assassins belong to Phase 3.

Do not change `design-config.json`, legacy combat outcomes, or historical simulation artifacts to make this slice pass. Introduce an explicit stored `combatRules: 'party-v2'` discriminator, with absence meaning legacy behavior. A helper such as `createPartyState(seed)` can construct new preview runs while existing `createState(seed)` remains compatible with legacy tests and simulation. Route combat and renderer behavior by the state's discriminator, never a global mutable switch.

Expose the preview at `?combat=party-v2`. Use a separate preview save key so opening the preview cannot overwrite the normal account. Reload must restore its own saved rules. Debug reset creates a state under the selected preview rules; debug load rejects a mismatched ruleset with an actionable error. Default gameplay activation and conversion of existing accounts occur in Phase 4 after the complete interface is ready. State the temporary opt-in clearly in the implementation record.

## State and definitions

1. Keep world `x` as the only authoritative horizontal position. Rendering does not write it.
2. Define per-unit body radius, speed, facing (`-1 | 1`), chosen target ID, and serialized action state for the preview. Add optional typed fields to the schema so old saves still decode. A `party-v2` state must validate that every live combat unit has the required new fields.
3. Keep timing in integer combat ticks, using `combatTime(state)` rather than wall time or browser time. New encounter units start with fresh actions. Preserve action fields through snapshots.
4. Action state is an explicit union: idle; windup with action kind, target ID, start tick and impact tick; recovery with ready tick. Movement is represented by position updates and a moving flag, not inferred from an eventual damage event.
5. Definitions own reach and action timing. Use the existing growth/stat formula for HP/ATK/DEF initially. Do not overwrite global `CONFIG.roles` to alter preview reach.
6. Initial trial values: normal radius 10, tank radius 12, melee reach 12, melee windup 4 ticks, ranged/heal cast reach 260. Define speeds and all remaining timing constants in one small versioned definition module, record them, and justify any change needed by the acceptance fixtures. These are preview mechanics constants, not certified progression balance.
7. For preview fresh starts retain the old starter roster and also grant the existing melee hero `mw1` and healer `priest` if missing. Form `[mw2, mw1, priest]`; do not remove heroes or spend tickets. This is preview initialization, not migration of real accounts.

## Pure targeting and distance helpers

Implement one helper used by both sides:

`edgeDistance(a,b) = max(0, abs(a.x-b.x) - a.radius - b.radius)`.

An attack is in reach iff edge distance is less than or equal to its configured reach. Inclusive boundaries are deliberate. A dead target is never eligible. Facing is derived from target direction before windup and checked at melee impact. If both centers coincide, retain facing; do not divide by zero or change distance sign.

Ordinary enemies select the living tank guarding the front if available; otherwise select the nearest living hero. Ties use stable unit IDs. Heroes select the nearest living enemy. Do not randomly retarget. An already selected living target stays selected until it becomes invalid or an explicit action finishes; do not thrash between equidistant targets every tick.

Support selects the living ally with the lowest HP fraction below the heal threshold, with stable ID ties; if nobody needs healing it can perform its basic enemy action. Phase 1 can keep the existing support heal multiplier and threshold. Do not consume a full heal cooldown if the target no longer needs healing at execution.

## Tick algorithm

For each native combat tick, use the following order for the new rules only:

1. Snapshot the living units at tick start in a deterministic ordering. Clear expired existing protection according to combat time. Do not mutate the unit array during iteration.
2. Resolve action-state transitions whose recovery ready tick has arrived. A dead unit cannot start a new action.
3. Idle units choose/retain an eligible target. If it is out of reach, move toward a valid engagement position by at most `speed / ticksPerSecond`, clamped so the move cannot overshoot the intended stop point. Never move during windup or recovery in this first slice. If already in reach, remain still.
4. Tank and melee DPS may share the engagement front with a visual depth offset; a rear melee hero must be able to reach contact even with a tank alive. Do not use ally collision that permanently blocks it behind the tank. Ordinary enemy targeting must still prefer the guarding tank. Enemies do not continuously retreat to preserve their shooting distance: an archer already in range holds position.
5. After movement, ready units in reach start windup: store target/action/timing and emit an explicit action-start event. Do not apply damage here. At most one new action starts per unit per combat tick.
6. Gather all windups due at this tick. Validate living target, reach, and melee facing at impact. Invalid actions emit a miss/cancel outcome and move to recovery. A basic attack never redirects silently to a different target mid-swing.
7. Resolve committed impacts as a batch: protection effects first, damage next, deaths, then heals to surviving targets. An attacker alive at the start of this impact phase may still land its committed hit if the batch also kills it. Keep stable ordering for shield allocation. Damage/reward/death events occur once. The existing stage code remains responsible for clear progression.
8. Recovery duration must preserve the definition's complete attack cadence: the next start is no earlier than the previous start plus the configured attack interval, and no earlier than impact plus its minimum recovery. Never schedule a negative duration when attack speed is high.

If it is necessary to split this into pure helpers, do so. The legacy combat function stays intact. Do not add separate frame timers, asynchronous damage callbacks, or visual-animation-driven simulation.

## Renderer contract

For preview units use a common camera translation: `screenX = round(fieldLeft + worldX - cameraLeft)`. Use the exact same transform for heroes, enemies, HP bars, target markers, and damage labels. Do not assign slot-fraction positions to preview heroes and a different formula to their opponents. Do not scale sprites fractionally to make reach look correct.

Keep the camera stable at the normal preview width. If the current HUD leaves too little viewport, clamp/pan the camera; the new compact HUD is Phase 2. Do not change world distances when the browser width changes.

Attack animation begins from serialized action-start timing, with the authored contact frame aligned to the impact tick. An atlas annotation or small metadata table may map definition timing to the asset frames. Combat definitions must not import image assets. Healing uses its action animation instead of pretending to slash an enemy. Movement uses run animation; canceled swings do not produce damage flashes. Any renderer interpolation is visual only and must keep contact/impact within one simulation tick.

The accelerated farm clock must be accounted for explicitly: use native combat timing for unit actions and animation phase. Do not compare a native action deadline to `state.tick`. If multiple substeps occur per frame, render the latest valid action state without inventing extra strikes. Preserve the existing farm padding/reward behavior.

## Wave, encounter, save, and failure boundaries

- At a new encounter, actions, targets, and positions initialize under the selected rules. Between waves, old target IDs are invalidated so an unfinished action cannot hit a newly spawned unit by accident.
- HP carry, full encounter heal, stage timers, explicit boss start, drops, tickets, and retry logic retain their existing contracts. Do not fix a combat failure by silently granting rewards or starting a boss.
- Store action timing in state; a bounded event-log eviction must not end an attack or change its future impact.
- Snapshot/load must reproduce future state and RNG exactly, including native farm-clock remainders. The isolated preview can add optional state fields to the existing format for now; Phase 4 owns the real-account migration.
- A stall must eventually lose by the existing timeout. Do not teleport units, grant remote hits, or force a victory to break a movement error.

## Required acceptance cases

Use meaningful behavior assertions rather than snapshots that merely mirror new fields:

1. Reach boundary: with radii 10 and 12, reach 12, center distance 34 is in reach; a positive epsilon beyond 34 is out. Repeat on both sides of the attacker. A target far behind cannot be hit through the old signed-distance condition.
2. Windup: starting an attack does not change target HP. HP changes exactly at impact if target stays valid. Damage is applied once.
3. Melee approach: tank + melee DPS + healer against an archer initially out of melee reach. The melee DPS moves from its anchor and lands a legal hit within a finite measured number of ticks. The archer does not flee forever.
4. Tank focus: ordinary frontliner/archer attacks target the living guarding tank while the melee DPS approaches its attack position. After tank death, enemies retarget a survivor, not the corpse.
5. Target invalidation: move or kill the target during windup. No remote hit or hit on a dead target; the next action may choose a different target.
6. Same-tick tie: mutually lethal committed attacks resolve consistently regardless of incidental traversal order; only one death/reward event per unit.
7. Healing: a hurt living ally in cast range receives healing at impact; a dead ally is not revived, an out-of-range ally is not remotely healed, and an unnecessary heal does not burn a full cooldown.
8. Save/resume: compare uninterrupted and snapshot/load continuation during approach, windup, recovery, and accelerated farm combat. Include state/RNG, not just HP.
9. Event eviction: retain a windup while unrelated old events leave the bounded log; it still resolves exactly once.
10. Presentation independence: drive identical input/tick sequences while resizing/opening panels in one browser run; simulation snapshots stay equal. Use fresh isolated contexts and deliberate pause/step; do not compare different real-time runs.
11. Browser evidence: open the opt-in preview, render approach/start/impact frames, record hit tick and actual world/screen separation, and capture an image or short recording showing contact. No page or asset errors. Use installed Chrome, not an absent Playwright bundled browser.
12. Legacy compatibility: existing full tests, lint, and build still pass. Historical golden checks remain against legacy rules; do not delete them or update their expected hashes to hide changed legacy outcomes.

## Handoff requirements

Stop after this phase. Send the orchestrator changed files, public/helper API changes, exact definition values, test and browser commands/results, the preview URL, and any remaining limitation. Update the implementation log with Phase 1 implemented / awaiting review. Do not mark Phase 1 approved or begin Phase 2 yourself. The orchestrator will spawn a fresh GPT-6.1 Sol medium reviewer; fix its actionable findings and wait for approval.
