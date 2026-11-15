# Centered hero loadout and complete attack playback

Date: 2026-11-15. Base: main after `ab15399`. This supersedes the hero workspace hierarchy and attack presentation in `HERO-FORMATION-SKILL-PLAN.md`; retain its mana, single-signature, and formation rules.

## Findings from the current source

No `AGENTS.md` was found by the repository scan. The requested layout must replace the Heroes workspace in both `src/management/view.ts` (browser and native DOM management) and `src/pixel-ui.ts::drawHeroes` (expanded canvas). The compact battlefield itself stays a battle lane. Current Heroes duplicates formation/preset controls, puts the selected hero in a narrow right inspector, and makes players leave that inspector for Stash. These choices conflict with the requested vertical hierarchy.

`src/renderer.ts::animation` currently advances half of an attack clip during the ten-tick movement to the target, then spreads its second half over 22 recovery ticks. `position` starts returning after only four recovery ticks. Thus a longer contact hold does not produce a complete stationary attack. `AtlasLibrary.draw` already supports nonlooping clips and clamps their last frame; playback uses the tag's `durationMs`, not each rect's duration. `cast` resolves `attack2 ?? attack ?? idle`. There is no authored impact-frame marker in the atlas schema or current metadata. The current 0.5 impact fraction is a design convention, not a proven authored contact frame.

The simulation is 20Hz: one tick is 50ms. Party battle and wave rest use one combat substep per wall tick even with an accelerated farm clock (`game.ts::tick`). Rendering must use the existing `presentationCombatTime` clock, not browser time. `game.ts::encounterSubstep` currently checks timeout before combat, and awards a win as soon as enemies die; wave/stage transitions can therefore truncate longer attack clips unless their completion is gated.

## 1. Literal loadout hierarchy

Heroes opens to these permanently visible sections in order:

1. Selected hero centered horizontally, with the three equipped item slots arranged around the hero.
2. Item stash directly underneath, as a horizontal strip that scrolls.
3. Hero selection directly underneath the stash, as a horizontal strip that scrolls.

Do not retain the old roster-left/inspector-right composition or send players to another tab just to see the stash. The main navigation's dedicated Stash screen can remain for bulk inventory management, comparison, chest choices, and upgrades. Formation remains a separate workspace with its working swaps, presets, locks, and coverage.

Use original existing atlas portraits and item icons, existing rarity frames, and existing panel/button materials. The hero should be visibly the center of the composition. Slot labels are Weapon / Armor / Charm; show empty slots with their icon and label. An equipped slot shows rarity/level/lock with full accessible text. Clicking a slot selects its item and filters/highlights compatible stash entries; an empty slot filters by slot type. Selecting a stash item inspects it; equipping remains an explicit action. Changing the hero updates all three equipped slots and the comparison target without issuing a party command. Preserve selected hero, selected item where still valid, keyboard focus, and strip scroll positions across the existing 200ms snapshot refresh.

Every owned hero is reachable in the bottom strip. Active party badges distinguish Front / Middle / Rear from benched heroes. Selection is not assignment. Put the Formation control at the top of this workspace. Ability and Stats stay reachable through a secondary Details control with accessible tabs in a bounded overlay/drawer; the overlay has a clear Close/Back control and scrollable content. Items are now visible directly around the hero and in the stash; the old Items detail tab may link/focus those sections rather than duplicate a hidden inventory. Returning from details restores the loadout and scroll state. Empty inventory shows an inline "Earn items from battles" state in the stash section while leaving the hero and roster visible.

### Compact geometry to implement and measure

Keep the existing 400px browser management window and its dock/growth logic. Body is 264px below the existing 88px header. Use one scoped loadout grid with four rows `24px 112px 56px 56px`, `gap:4px`, and 4px bottom breathing room: total 264px. Avoid accumulated absolute inspector overrides. The first row contains a short selected-hero label at left and Details / Formation at right. The second row is the centered hero stage; last two rows each use a 16px section label and a 40px horizontal strip. Scrollbars must fit within those rows; use a thin overlay-style scrollbar or allow a slightly smaller image inside the 40px button.

At 480px viewport the actual panel is 464px, leaving 440px with 12px side padding. At 640px it is 624px; at 960px it is 720px. Use available panel width, not viewport media queries alone. Keep the center anchor at `50%` of the full content width. A 96px hero preview fits the 112px stage (body baseline near y108). Place Weapon 40px slot left of the hero (`center - 108px`, stage y36), Armor 40px slot right (`center + 68px`, y12), and Charm right (`center + 68px`, y64). Keep labels within each slot or use short labels directly below; no label may extend into the stash row. A centered preview wrapper can use a 96px width with the cropped portrait at an integer scale and `object-fit:contain`. Do not stretch pixels to arbitrary fractional sizes.

Stash and roster strip children have `flex:0 0 40px` (or 44px if including badge space inside the same row), sensible accessible names, visible focus, and `overflow-x:auto;overflow-y:hidden`. Keep full item names/stats in the inspector, not tiny text packed into the strip. Details/equip popovers are bounded by the menu interior and scroll inside themselves. If extra height is necessary for an overlay it must use the available existing body, never overflow into the footer or battle lane.

Native DOM keeps the same vertical order and centered stage, using its existing 424px body to increase stage and strip heights (suggest 28/168/96/112 plus gaps/padding, adjusted to fit exactly). Expanded canvas uses the same section order within its existing panel: center the hero stage over the width, draw three equipped slot hit regions around it, then stash row and roster row. Reuse a small shared layout helper for the canvas geometry if needed; match DOM behavior, not every CSS pixel. Provide horizontal paging/scroll input and clipped hit regions for canvas strips. Keep formation assignment accessible in its separate view or through a Formation control; do not leave canvas users with inaccessible actions.

Use existing equip/upgrade/lock APIs and `ManagementAuthority`, not a second inventory reducer. Slot filters should not discard the selected hero. Preserve main's equipped/locked salvage protections and lock limit. A compact item inspector must expose Equip, Upgrade, Lock/Unlock with correct disabled states, owner, comparison, rarity, level, and stats; it may share the existing gear inspector implementation in a drawer. Pending chest choices remain accessible in the dedicated Stash screen with an indicator; the new loadout stash should not consume or resolve them automatically.

## 2. Move, play the whole clip at contact, then return

Define one pure action timeline shared by core and renderer. The phases are approach, attack clip, return, settle. Existing `windup` and `recovery` states can remain for impact commitment, but add optional deterministic boundaries to their schemas: `contactTick`, `attackEndTick`, `returnEndTick` (and existing recovery `readyTick`), plus captured target side/slot/count already present. `startTick` is approach start; `impactTick` is the single existing effect-commit boundary inside the attack clip. Timing metadata must be fixed when the action starts, not changed by asynchronous image loading.

| Phase | Position | Clip and clip-local time |
| --- | --- | --- |
| Approach, start to contact | Interpolate home to captured contact anchor | `run`, age from start; never attack/cast |
| Attack, contact to attackEnd | Exactly at contact anchor for leap; home for cast | Selected one-shot attack/cast, age zero at contact, advance at its real 90ms/frame rate |
| Return, attackEnd to returnEnd | Ease from contact anchor to home | `run`, age zero at return start; no attack frames |
| Settle, returnEnd to ready | Exactly home | `idle` |

Keep ten approach ticks (500ms), fourteen return ticks (700ms), four settle ticks (200ms) for melee as reviewable existing movement defaults. Remove the four-tick contact-pose hold as a substitute for attack playback: the full clip is the stationary contact phase. For cast delivery, omit travel: contactTick=startTick, play its full one-shot at home, then settle four ticks. A ranged damage action can preserve current `attack` mapping; heals/buffs use `cast` as currently selected. Make clip selection explicit and shared so core duration and renderer clip cannot disagree. Preserve attack-facing during approach and clip; return can use run facing home, restoring normal idle facing at home. Contact anchor should stop just in front of the target by the bodies' visual clearance if practical, consistently on both sides; never alter simulation `unit.x`.

All attack tags inspected in `public/assets/**/atlas.json` are nonlooping and use **90ms per frame**. `AtlasLibrary.durationMs` returns frameCount*90. Relevant actual durations:

| Current hero IDs / atlas | Attack frames | Duration | Clip ticks (`ceil(ms/50)`) |
| --- | ---: | ---: | ---: |
| mw1, mw2, mw3, mh2, mk2 | 4 | 360ms | 8 |
| hu1 | 5 | 450ms | 9 nominal; 10 with last-frame guard below |
| hk2, mh1, hu2, mk1 | 6 | 540ms | 11 |
| hk1, fw, mh3 | 7 | 630ms | 13 |
| wiz, priest, ew1, ew2 | 8 | 720ms | 15 |
| ew3 | 13 | 1170ms | 24 |
| grunt / goblin; archer / skeleton; brute / mushroom | 8 | 720ms | 15 |
| boss_ch1 / fire-worm | 16 | 1440ms | 29 |
| boss_ch2 / mimic | 14 | 1260ms | 26 |

Assassin uses goblin and bomber uses mushroom. Cast uses `attack2` where available; `mh3` attack2 is six frames/540ms instead of its seven-frame/630ms attack. Missing attack2 falls back to attack (ew1, ew3, hk2, hu2). Never hardcode all actors to the four-frame starter duration. Manifest includes additional enemy atlases, but the above are the current configured visual mappings in `config.ts::view` and `party-enemies.ts`.

Create a small pure checked-in clip timing map containing asset key, attack/cast frame counts, and frameMs, generated from or validated against the atlas JSON. The core imports it without DOM/fetch. It can live in `src/core/turn/animation-timing.ts` or a JSON fixture plus helper. One meaningful registry test reads the atlas files and verifies every configured hero/enemy mapping and cast fallback. No browser-readiness dependency in combat. Do not hand-copy the same timing table into renderer and core.

For each action use `clipTicks=max(ceil(frameCount*frameMs/50), ceil((frameCount-1)*frameMs/50)+ceil(frameMs/50))`, `attackEndTick=contactTick+clipTicks`; return starts only at attackEnd. The second term gives the last frame a complete interval despite discrete 50ms samples (a five-frame clip first samples its last frame at400ms, so retain it through500ms). Clamp the nonlooping clip to its final frame for rounding remainder. At contact, clip age is exactly0. A shared pure presentation sampler should return phase, x progress, animation name, and ageMs so tests verify actual phase/clip coupling rather than only x positions.

No explicit impact marker exists, so preserve the current midpoint convention as an explicit fallback frame: `impactFrame=floor(frameCount*0.5)`, zero-based; `impactTick=contactTick+ceil(impactFrame*90/50)`. This commits once while that frame is visible. An optional later per-clip override can select a visually checked authored frame, but do not invent such inspection evidence. For mw1/mw2: approach t0..10; four-frame attack t10..18; hit at t14; return t18..32; settle t32..36. Frame ages during attack are0,50,...350ms, which visits all four frames in order. Current ten-tick hit commitment moves later for melee because movement must complete before the strike starts; damage amounts, mana spending/gain, target validation, and one-commit behavior remain unchanged.

Update every action constructor, including assassin mark-to-dash conversion and enemy special-to-action paths. Enemy telegraphs remain before their actual clip; do not consume attack frames while marking. Boss area impacts must align with their stationary full clip and one authoritative effect commit, without a duplicate basic action. Invalid target before impact should emit the existing miss once and still finish the actor's established movement/clip timeline if alive; no mana spend on an uncommitted miss. Death overrides the dead unit's own clip; a dead target must not remove the living attacker's captured contact anchor.

Use one clock throughout. Do not let stage rest freeze presentation time: gate party win/wave transition while a living committed actor has not reached readyTick. If all enemies died, finish clip+return before checking timeout/win again; a killing action that already resolved before the deadline must not become a timeout loss during cosmetic return. In active combat, never let a timeout truncate an already-started clip; finish the presentation and resolve the pending outcome without allowing another action. Explicitly cover this ordering in tests. Keep native farm duration accounting and bossRepeatMinCycle padding consistent; do not modify authored stage timeout numbers simply to conceal presentation defects. Longer honest clips may affect combat cadence, which should be measured and reported.

Saving during approach, pre-impact clip, post-impact clip, return, and settle must resume without a duplicate hit/skill/mana transaction. New timeline fields are optional for old saves; derive a consistent fallback for a saved old windup/recovery (or finish its existing recovery) without replaying committed effects. New actions always receive full boundaries. Do not reinterpret old recovery as a new uncommitted attack.

## Implementation order and acceptance

1. Add the shared timing map/helper and pure sampler; integrate all live action creation, impact and recovery sites, renderer position/animation selection, and transition gates. Verify both short hero and long enemy clips. Retire the old duration*0.5 stretch code and fixed animationRecoveryTicks termination as the source of clip age.
2. Replace Heroes markup/CSS and canvas composition with centered stage, surrounded equipped slots, stash strip, then hero strip. Keep shared selection/authority and existing Details/Formation features. Scope new CSS to this workspace rather than mutate Stash or Formation inspector geometry globally.
3. Meaningful tests: no attack clip in approach; age0 at contact; all frames0..N-1 shown while stationary for 4-,7-,13-,16-frame examples; final frame fully held; hit exactly once on chosen frame; return never starts before clip end; spell stays home; lethal final hit completes return before wave clear; timeout during finish; missed target; save/reload on each side of commit; mana exactly once. Existing status, formation, salvage, and boss-repeat tests remain relevant.
4. Browser checks at480/640/960 and native management: hero centered with all three equipped slots around it; stash below stage, hero strip below stash; scroll reaches every owned item/hero; slot selection and explicit equip affect the selected hero; no overlaps/clipped text/footer escape; Details/Formation remain reachable and selection survives refresh. Check expanded canvas equivalent and its actual pointer hit regions. Use bounding-box assertions for hierarchy/containment and a sequence of frames or recorded clip for animation; a single screenshot cannot prove full playback.
5. Run `npm test`, `npm run build`, `npm run lint`. Review progression/cadence impact of longer clips separately from correctness; report any unresolved tuning instead of claiming constant attack rate. No Git mutation is part of this planning step.
