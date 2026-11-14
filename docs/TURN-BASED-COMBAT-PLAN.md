# Turn-based combat redesign

## Research and direction

Dislyte uses Speed to determine action point gain and turn order ([speed guide](https://playdislyte.com/?p=2448), [action point guide](https://playdislyte.com/?p=2442)). Summoners War displays attack bars, skills and beneficial and harmful effects, and offers auto and manual procedures ([official battle guide](https://sw.com2us.com/en/skyarena/game)). Its published battle-logic revision illustrates why extra turns and attack-bar absorption need explicit, consistent rules ([developer update](https://summonerswar.com/en/skyarena/news/list/4225)). These are references for the interaction, not specifications to copy or claims about their current internal implementations.

## Player experience

Units hold formation during a wave. A melee action advances visually to its target, impacts, and returns; projectiles, spells and healing originate at the actor's slot. Combat positions do not change during these animations. Between waves the party advances together and the next formation settles. The camera follows the formation anchor, never individual targets or temporary attack animation offsets. All active combatants should fit in the available field; compact widths need a deterministic layout rather than target tracking.

Each living unit has a speed-driven gauge. Advance simulation to the next ready unit; resolve one action at a time. Break simultaneous ties by stable side and formation slot, then stable unit ID. Preserve gauge overflow and specify a cap for future gauge changes. Show the active actor and a preview of upcoming turns; previews are estimates when effects can change speed or gauge.

Auto chooses a legal skill and target using deterministic priorities. Manual waits for the active hero's choice without advancing combat time; enemies remain automatic. Switching to auto while awaiting input immediately selects an action; switching to manual applies at the next hero decision. Invalid or stale choices are rejected without spending a turn. Basic attacks always remain available. Skill cooldowns and status durations count the affected unit's own completed turns, with application and expiration order explicitly tested.

## Architecture

Introduce a versioned turn ruleset alongside existing saves, rather than reinterpret tick-based `party-v2` state. A pure combat reducer owns gauges, action validation, deterministic target selection, effect resolution and events. It must not depend on renderer timing. Presentation consumes action-start, impact, return and wave-transition events and gates the next displayed action without changing combat outcomes. Headless simulation can skip presentation delays while measuring a separately defined equivalent farming duration.

Character definitions reference stable skill IDs, base stats, role and formation behavior. Skill definitions declare target rules, cooldown in turns, presentation style and an ordered list of reusable effects. Validate the registry at startup: unique IDs, known references, legal target/effect combinations and bounded parameters. Effects should start with damage, heal, shield, apply/remove status and gauge modification. Specialized mechanics can be explicit registered handlers with deterministic inputs, rather than arbitrary scripts embedded in content.

Define statuses centrally with ID, display name/icon, beneficial or harmful category, stacking policy, duration boundary, and reusable hooks such as stat modifier, turn-start damage or action prevention. Instances hold source, target, magnitude, remaining turns and deterministic application sequence. Specify refresh/replace/stack semantics per definition, and render them using one reusable status indicator with accessible text. Effects that depend on a living source must explicitly remove or suppress themselves on source death. Limit recursive triggered effects and define their ordering.

Keep formation targeting explicit: front-line protection applies only to skills whose target rules require it; area and bypass skills declare exceptions. Resolve deaths and triggered effects in a documented sequence before selecting the next actor. Convert existing roster abilities and enemy specials deliberately; movement-dependent intercepts, radii and telegraphs need new turn-based equivalents rather than silently preserving old numbers.

## Implementation sequence and acceptance

1. Specify and test pure gauge scheduling, ties, turn boundaries, target legality, cooldowns, status stacking, triggers and deterministic replay. Add validated content registries and migrate representative heroes and enemies.
2. Integrate a versioned ruleset with wave transitions, outcomes, progression and persistence. Preserve old saves through an explicit migration or retain the old ruleset for in-progress encounters. Test saving while awaiting a manual choice and during a presentation animation.
3. Convert the roster and enemy patterns. Share the same legal action resolver between manual and auto; test both, including target death, disabled skills and mode switches.
4. Add fixed formation presentation, action animations, wave transitions, stable party camera, skill controls, turn order and reusable status indicators. Verify desktop hit regions and compact layout as well as browser input.
5. Retune speed, cooldowns, damage, stage timers, boss mechanics and farming. Recompute offline estimates from measured turn-based farming rather than reusing old real-time assumptions. Run deterministic simulations across seeds and compare progression targets; document results and unresolved balance tradeoffs.

The existing design uses 20 Hz movement, tick-based cooldowns and effect durations, farm padding, encounter timeouts and legacy save compatibility. Those assumptions must be migrated together. Existing uncommitted camera and compact-layout work should be preserved and integrated deliberately.
