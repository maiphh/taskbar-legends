# Hero management, formation, and signature skill prototype

Date: 2026-11-14. Implementation plan against the existing staged turn-combat work on `feat/enhancement`.

## Scope and evidence

Keep the staged formation-based, speed-gauge turn combat. Address the reported fast return animation, give each hero a readable inspector with Ability / Stats / Items tabs, add a separate Formation workspace, and make each hero's one signature skill charge and cast automatically through mana. Basic attacks remain a universal action; they are not a second signature skill. The prototype should run through the real combat loop, including saves and the compact desktop view.

There are no repository `AGENTS.md` files in the scanned source tree. Preserve all existing staged edits. Parent baseline: 33 test files / 293 tests pass; build currently fails at `tests/party-camera.test.ts:88` because the `matchMedia` test stub returns a function instead of a `MediaQueryList`.

Research, checked 2026-11-14:

- [TBH: Task Bar Hero, developer Steam listing](https://store.steampowered.com/app/3678970/TBH_Task_Bar_Hero/) identifies a taskbar idle RPG with classes, skills, loot, and character/gear growth. The repository's `docs/ui-v1.md` already documents its screenshot references: compact battle lane, selected hero equipment, inventory, and strong panel framing. Here, "tbh" means Task Bar Hero. Reuse this product separation and existing PixelUI styling; do not copy artwork.
- [Dislyte, publisher App Store listing](https://apps.apple.com/bg/app/dislyte/id1590319959) provides the official character/team RPG reference. [Official Esper balancing](https://dislyte.farlightgames.com/detail_06_28.html) describes explicit ability effects and formation options in search-indexed text, though its fetched HTML is a shell. Use character identity, clear effect descriptions, and deliberate team selection as inspiration. The particular nested tabs below are our design, not a claim about Dislyte's exact current menu.
- [Riot: Roles Revamped and Item Changes, July 15 2025](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/roles-revamped-and-item-changes/) documents role-dependent mana: tanks gain mana on attacks and damage, casters on attacks and regeneration. This proves that a blanket "all TFT units gain the same mana from damage" rule is stale. Our prototype borrows automatic resource-triggered casts, with deliberately simpler authored numbers. It does not reproduce a particular TFT patch.

## Current integration points

- `src/core/party-combat.ts`: live `party-v2` actor selection uses `turn/action-bar.ts`, but hero active selection still uses `cooldownTicks`, and hero passives still add effects. The pure `turn/skills.ts` module is not the full live action pipeline. Extend the live pipeline coherently; adding isolated skills to the pure module alone does not meet this request.
- `src/renderer.ts::position`: leap windup reaches the target. Recovery immediately interpolates home over `animationRecoveryTicks=10` (500ms at 20Hz), then stays home for the remaining minimum recovery (18 ticks total). There is no contact hold, and extra recovery time alone does not slow return.
- `src/management/view.ts::party`: formation, roster, stats, gear, strength, weakness, active, and passive currently share one cramped inspector. Browser flavour text is visually hidden. This is the main menu used by the management surface.
- `src/pixel-ui.ts`: canvas party and gear screens remain a second user-facing surface. Keep their information, selected hero, and controls consistent with the DOM management screen.
- `src/core/model.ts`: strict Zod unit/action schemas require any new runtime mana or captured presentation coordinates to be declared. `partyIds` already provides ordered front/middle/rear formation; the existing `party` action is the mutation authority.

## 1. Slower, readable melee return

Use named presentation durations in the existing timing definition: keep 10 windup ticks; add 4 contact ticks (200ms), 14 return ticks (700ms), then 4 home settle ticks (200ms). Recovery must be at least contact + return + settle (22 ticks), so another actor never starts before the return completes. These are prototype defaults to review in motion.

During contact, keep the actor at its captured target display position. During return, use eased interpolation `u*u*(3-2*u)` from contact to home. After return, clamp exactly to home. Keep the sprite's attack facing through contact; the normal renderer may restore its idle facing after landing. Cast delivery remains at home throughout. Simulation `unit.x`, target selection, damage, and formation never follow sprite offsets.

Capture the target slot/display anchor when the action starts so a killing hit, missing target, or encounter cleanup cannot make the actor snap home. Prefer side + slot + enemyCount captured on the action and resolved to the current field width, rather than persisting screen pixels. Declare optional fields for old saves; fallback to a still-present target or the actor's home. Keep the last hostile death visible through the existing recovery gate before moving into the next wave. Use `presentationCombatTime`, including farmPad, consistently.

Files: `party-combat.ts`, `model.ts`, `turn/presentation.ts`, `turn/formation-view.ts`, `renderer.ts`, related motion tests.

## 2. Hero workspace and tabs

Within Party, add an explicit Heroes / Formation workspace switch. Heroes is default. Heroes shows a scrollable owned-roster grid at left and the selected hero at right. The inspector header always shows portrait, name, level, stars, role, and whether deployed. Below it are actual Ability / Stats / Items tabs; keep their active state when refresh snapshots arrive. A selected hero must stay selected when switching detail tabs.

Ability: show exactly one named signature skill with an icon, effect, target, mana cost, mana gain rule, and "Auto-casts on its next turn when ready". Give the basic attack one small informational line. Do not show the retired passive section or old seconds-based active cooldown text. Stats: readable HP / ATK / DEF / turn SPD plus equipment contribution where readily available. Current economy "basic DPS" assumes attackTicks rather than the live turn cadence: omit that misleading figure from the new inspector rather than label it as measured turn-combat DPS. Items: three framed weapon / armor / charm slots, rarity, level, useful stat text, and an Inspect / Change control linking to Stash with the same hero selected. Reuse equip, upgrade, comparison, lock, and protected-salvage authorities; do not duplicate inventory logic.

The browser 216px inspector needs a scrollable content region and fixed tab row. Give tabs sensible minimum hit targets and visible focus. DOM tabs use `role=tablist`, `role=tab`, `aria-selected`, associated panels, and keyboard navigation. Every tab's body must be visually readable in browser and native variants. Canvas uses equivalent buttons, hit regions, and content clipping. Preserve menu dragging and compact pointer hit regions.

## 3. Formation workspace

Show three large ordered slots labeled Front / Middle / Rear and a clear enemy direction marker. This is the existing one-dimensional formation, not an invented two-row grid. Slot 0 is closest to enemies. Select a slot then select an owned hero and press Assign. If that hero already occupies another slot, swap those two entries atomically; otherwise replace the chosen slot. Dispatch one existing `party` command with three unique owned IDs. Selecting a hero alone never changes formation.

Keep Balanced / Fast Farm / Boss Sustain presets, preset lock controls, and role coverage here. Preset locks retain their existing semantics (protect against presets); do not silently forbid deliberate manual assignment. Render explicit Front / Middle / Rear current or next-wave order. Existing party changes apply through the established next-stage/rebuild boundary; describe that boundary accurately in UI and preserve current encounter units. Formation should offer useful rearrangement of all three starters without needing a fourth owned hero. No drag/drop dependency is required.

## 4. One signature skill and TFT-inspired automatic mana

Retain speed/AP gauge for turn scheduling; mana is a separate resource for deciding what action the ready actor takes. Label them Turn gauge and Mana to avoid confusing AP with mana.

Add optional bounded integer `mana` to Unit, default 0 for old saves and new encounter units. Put `manaCost` on each hero's one active/signature definition; use the current active IDs for save/event compatibility. Every successful basic action grants 20 mana, including a healer's successful basic heal. Tanks additionally gain 5 mana for each direct hostile action that causes actual HP damage, at most once per source action (not once per splash/proc/shield event). Other roles do not gain mana from damage. Clamp to [0, manaCost]. No passive regen in this prototype, avoiding a second clock beside turn gauges.

At the beginning of an able hero turn: if mana is full and its one signature has a useful legal target, choose it; otherwise choose the basic and retain full mana. A ready skill replaces the next basic; it never interrupts another actor or creates an extra turn. Spend mana once when the skill commits, not during target inspection; a stale/dead target causing a miss before commitment does not consume mana. Skill actions and skill side-effects do not generate mana. No signature cooldown gate remains for heroes; enemy specials retain their existing authored behavior. Define commitment consistently in live resolution and tests.

Remove hero passive trigger execution in `party-v2`, including intercept, fourth-basic effects, ramp, living aura, and splash procs; otherwise heroes still have multiple character skills. Keep legacy rules behavior if necessary. Existing signatures already cover shielding, sustain, damage, healing, buffs, and debuffs; reuse their values/effect machinery so this remains an integrated prototype. Rename metadata to signature where useful without requiring a wholesale schema rewrite. Update tooltip/strength/weakness claims that refer to a removed passive or traveling projectiles. `isPartyAbilityId` and events must still accept the actual basic/signature IDs.

Prototype catalog (one row per configured hero; coefficients are ATK unless specified):

| Hero | Signature | Mana | Effect prototype |
| --- | --- | ---: | --- |
| mw2 | Guardian Shield | 60 | Self shield 15% max HP; use existing 5s shield duration and threat/HP usefulness condition |
| hk1 | Second Wind | 60 | Heal self 15% max HP below 65% HP |
| mw1 | Cleave | 60 | 1.5 primary + 0.6 to one nearby enemy |
| hu1 | Piercing Shot | 60 | 1.8 single target |
| priest | Restoration | 60 | Heal lowest-HP ally 1.8 ATK below 80% HP |
| ew1 | Withering Hex | 60 | Existing 20% ATK / 25% DEF reduction, 4s |
| mk1 | Rally | 60 | Strongest ally +15% ATK, 4s |
| wiz | Fireball | 80 | 1.4 primary + 0.6 nearby splash |
| mw3 | Wide Cleave | 80 | 1.3 primary + 0.75 one nearby enemy, existing larger radius |
| mh1 | Focused Burst | 60 | 2.0 single target |
| mh2 | Quick Burst | 40 | 1.6 single target |
| hu2 | Long Shot | 60 | 1.7 single target |
| hk2 | Bulwark | 60 | Self shield 20% max HP, 5s |
| fw | Blood Strike | 60 | 1.2 damage + self-heal 8% max HP on a valid hit |
| ew2 | Inferno | 80 | 1.2 primary + 0.75 nearby splash, existing larger radius |
| mk2 | Iron Wall | 80 | Self shield 25% max HP, 5s |
| mh3 | Execution | 80 | 2.2 single target |
| ew3 | Armor Break | 60 | Existing 20% ATK / 40% DEF reduction, 3s |

Durations above deliberately retain current tick-based effects for this focused prototype. Tooltips must state seconds. Converting every legacy effect to owner-turn statuses is separate work; do not make tooltip claims that the live resolver does not implement. If existing radius-based AoE works with fixed simulation formation slots, retain it and test a three-enemy wave; otherwise express secondary targeting by adjacent enemy slots rather than display pixels.

Expose mana to players as a thin blue meter below the hero HP bar, with a ready highlight. The Ability tab can show static cost/gain text without requiring combat snapshots for benched heroes. Add optional snapshot data only if live mana is displayed there. Save/load at 0, partially full, full, and committed skill recovery must retain valid bounded resource state and never duplicate a cast. Encounter reset clears mana. No roster/save format migration beyond optional encounter fields is necessary.

## Delivery order and checks

1. Preserve the existing index. Fix the baseline matchMedia type stub. Implement/tune return phases and capture stable target anchors; verify nonlethal, lethal, final-enemy, and farmPad return.
2. Add validated mana costs and unit mana, integrate actual auto-selection/commit/gain rules, retire hero passive dispatch in party-v2, and update obsolete ability tests rather than leaving two contradictory combat contracts.
3. Implement Heroes / Formation and Ability / Stats / Items in DOM management; mirror relevant canvas views. Add reorder swap behavior through the same core authority and share presentation labels/descriptions where practical.
4. Run meaningful focused tests: boundary mana gain/cap; skill replacing next basic; no mana on failed actions; healer useful-target defer; no duplicate gain from multi-hit effects; no old passive proc; swap/replace/duplicate rejection; save reload before/after commit; last-enemy return; tab content and selection persistence across refresh. Existing tests for shield protection, damage ordering, preset locks, command authority, and offline progression remain relevant.
5. Run `npm test`, `npm run build`, `npm run lint`; fix actual regressions. Check the running browser at compact and expanded widths with every detail tab, selected hero items, swap of two starters, and a melee killing blow. Capture useful evidence through the project's browser tooling. Review simulation results for obvious inability to clear waves after losing passive power; prototype balance adjustments should be explicit and small.

## Making this direction main

Local `main` and `feat/enhancement` have diverged (14 commits only on main, 6 only on feature at inspection). Main has valuable item lock/protected salvage, config 1.4.1–1.4.4, and bossRepeatMinCycle changes. Commit the completed work, then integrate histories with a normal merge that preserves main's fixes; resolve overlapping model, UI, combat, and tests deliberately. Do not force-move main or overwrite main's tree. Re-run validation after conflict resolution. The user has requested making this direction main, so complete the local branch integration once green; publishing to a remote is outside this request unless separately authorized.
