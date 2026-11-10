# Compact party redesign: research, stress review, and implementation plan

Date: 2026-11-10. Status: implementation in progress under sequential Luna implementation / Sol 6.1 review gates. Phases 0–2 passed review; Phase 3 is in progress. This document records the original research and design contract; current implementation and verification results live in `COMPACT-PARTY-IMPLEMENTATION.md`. Native execution checks are deferred by the user's explicit choice.

## 1. Product direction

Build a small, movable idle battlefield with optional management, and readable party combat built around Tank / DPS / Support. The default party is one of each. Players can experiment with other compositions; formation slots are not class locks.

This proposal supersedes the old full-width, immovable overlay and panel-expands-battlefield requirements in `ui-v1.md`. Preserve the deterministic core, asset licenses, save ownership, explicit boss entry, and idle-friendly automation. Do not enable the unfinished v1.4 economy as part of this redesign.

Treat the user's “update” menu as character/equipment upgrades; include release notes in Settings if useful. Shipping an application updater is a separate feature.

## 2. Research and confidence

The reference is interpreted as **TBH: Task Bar Hero**, Steam app 3678970.

| Source | What it establishes | How this affects the proposal |
|---|---|---|
| [Official Steam listing](https://store.steampowered.com/app/3678970/TBH_Task_Bar_Hero/) | A compact idle RPG with automatic combat/loot and class, skill, and item builds. | Keep activity visible and management optional. Do not transplant its economy or copy its art. |
| [Nugem official window recovery article](https://nugemstudio.zendesk.com/hc/en-001/articles/16919919264143-The-game-is-running-but-the-game-window-is-not-visible) | The game can become off-screen or incorrectly sized; Shift+F11 resets size and Shift+F12 resets position. | Geometry persistence needs monitor validation, clamping, and tray recovery from the first release. |
| Existing repository study, `docs/ui-v1.md`, section 1 | Earlier inspection of Steam promotional images recorded a short floating lane beneath management windows, with separate Status, Portal, and Cube views. This is historical repository evidence, not a new live-client observation. | Use a short battlefield and a single tabbed management window to control complexity. |
| [Tauri window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/) | Native move/resize gestures exist; they require explicit permissions. `setIgnoreCursorEvents` switches the window's cursor handling. | Use native gestures; do not fight the OS with continuous scripted repositioning. |
| [AFK Journey composition analysis](https://www.prydwen.gg/afk-journey/guides/arena-teams) | Different team archetypes depend on sustain, damage, and control interactions; tank/support contributions depend on the encounter. This is specialist analysis, not an official balance specification. | Tank/DPS/Support is a useful default, while strengths, weaknesses, and counterplay must be designed for our three-slot game. |

Research limitation: no installed TBH client was operated. Exact drag handles, resize gestures, menu-toggle behavior, and runtime dimensions are not verified. The dimensions and interactions below are our proposed design, not claims about TBH. Public screenshots do not prove native click-through behavior. Before attempting exact gesture parity, record a short hands-on reference capture covering move, resize, menu open/close, DPI, and restart.

## 3. Current implementation stress review

Baseline from the preceding review: 150 tests, lint, and build pass; fresh Chrome opens management panels with no asset/browser errors. These checks establish current implementation health, not acceptance of the proposed mechanics.

Additional probes executed against current source through Vite and headless Chrome on 2026-11-10:

| Probe | Observed result | Consequence |
|---|---|---|
| Isolate the starter tank at x=140, enemy initially x=300, cooldown ready; execute one combat tick. | Enemy advances to x=296; tank attacks at center distance 156 with configured range 160. | “Melee” range is much longer than contact distance. Reducing it alone will cause more idle melee units unless movement is implemented. |
| Put a warrior fixture at x=95, range 160; archer stops at x=290 behind a healthy front tank. Execute 100 combat ticks. | Warrior remains x=95 and performs zero attacks for five combat seconds. | Stationary heroes cannot close the 195-unit gap to a ranged opponent. This was a synthetic encounter fixture, not a natural campaign run. |
| Evaluate current compact battlefield allocation. | Window widths 432 / 480 / 640 / 720 leave battlefield widths 0 / 48 / 208 / 288 respectively. | Existing side HUD islands must be removed from the compact layout before shortening the window. |
| Dock on a 1920x1040 work area at scale 1. | `dockRect(...,160)` returns x=0, y=880, width=1920, height=160. | Current docking intentionally forces full width; a resizable config flag alone cannot deliver the requested window. |

Code findings:

- `renderer.ts` places heroes by slot fractions and enemies by separate formulas rather than applying one transform to `Unit.x`. Displayed separation is not simulation separation.
- Attack animation is inferred from hit/heal events. Damage therefore precedes the visible attack sequence instead of occurring at an authored impact point.
- Hero range uses `enemy.x - hero.x <= range`; it assumes every opponent is in front. This is a latent error for backline attackers, not a reproduced reachable flank bug today.
- Enemy selection always uses the first living party entry, and movement clamps enemies in front of it. A flank cannot be implemented by changing target selection alone.
- Existing role skill counters make distinct characters mostly variations of a shared role kit.
- `onMoved` dirties docking and periodic polling redocks. User movement would be undone unless shell ownership of bounds changes.
- Farm combat can advance through accelerated native substeps. New windups, statuses, and projectiles must use that combat clock, including snapshot/load.

## 4. Roles, roster, and party building

Use `combatRole: tank | dps | support`, plus behavior tags such as `melee`, `ranged`, `healer`, `buffer`, `debuffer`, `guardian`, and `assassin`. Keep legacy role IDs during migration; use an explicit mapping rather than changing every stored reference at once.

For the first release each hero gets one basic action, one automated active skill, and one passive. Individual ability definitions replace the role switch. Rarity must not erase the usefulness of a low-rarity counterpick.

| Archetype | Strength | Weakness / counter |
|---|---|---|
| Guardian tank | Shield and intercept an attack aimed at an ally. | Lower personal damage; intercept has range and cooldown limits. |
| Bruiser tank | Self-sustain and frontline damage. | Weaker protection against backline dives and party-wide damage. |
| Melee DPS | Strong sustained damage after reaching contact. | Approach time and exposure to cleave. |
| Ranged DPS | Safe single-target pressure; limited repositioning. | Fragile when flanked; does not kite forever. |
| AoE DPS | Efficient against clustered enemies. | Lower isolated boss damage; cast can be interrupted. |
| Healer support | Recovers actual missing health; can save a marked ally. | Lower damage amplification; vulnerable to burst exceeding available healing. |
| Buffer support | Raises party damage or adds preventive shields. | Limited recovery after damage has already landed. |
| Debuffer support | Weakens enemy damage/defense or slows attacks. | Needs time to apply effects; bosses resist hard control. |

Start with six differentiated kits: two tanks, two DPS (one melee, one ranged), one healer, and one debuffer with modest preventive protection. Add the pure buffer and additional variants after the first balance pass. Retain all existing owned heroes; map remaining heroes to provisional kits and expand identity in batches rather than deleting roster entries.

Guarantee a usable tank, DPS, and healer during onboarding without relying on random pulls. Preserve the original three starter heroes and add the introductory melee DPS `mw1` and healer `priest` when missing, consistently for fresh and migrated accounts. Fresh accounts deploy `[mw2,mw1,priest]`; existing valid formations are retained for the player to adjust. The old starter formation is tank plus two DPS and Priest is not an old starter, so this is an explicit content/economy change. Collection measurements must state the new five-hero fresh roster.

Auto-party offers Balanced, Fast farm, and Boss sustain presets. Balanced fills one role each when available and explains missing coverage; it never silently removes locked favorites. Auto-equip evaluates marginal utility for the wearer, including attack speed, shielding, healing, and survivability. Show actual stat deltas rather than declaring a universal gear score optimal.

Do not add factions, elemental matchups, manual ultimates, and a large skill tree in the same release. First verify that positioning and the three roles create choices by themselves.

## 5. Combat contract

### Space, reach, and movement

Retain a deterministic horizontal combat lane. Flanks can use a visual depth offset while their actual x position and attack validity remain in the same world model. Full 2D navigation is unnecessary for this release.

- A unit has world x, facing, body radius, movement speed, target ID, and action state. Targets are selected by ability policy with stable ID tie-breaking.
- Reach is edge distance: `max(0, abs(attacker.x-target.x)-attacker.radius-target.radius) <= reach`. Melee must also face the target at impact; turning occurs before windup. Allies and enemies use the same distance helper.
- Prototype normal bodies at radius 10, tank radius 12, melee reach 8–16 world units. These are trial values, not imported balance numbers. Author weapon reach separately for unusually long weapons.
- Heroes approach attack positions when out of range and return toward their formation anchor when there is no actionable target. Formation slots are starting anchors, not permanent immobility.
- A rear melee hero may share the engagement front with the tank using bounded attack sockets and visual depth offsets. The tank remains the priority of ordinary enemies while guarding, so a melee DPS stepping forward does not accidentally become the default tank.
- Ordinary foes stop at the guard line; a flanker may cross it only while executing its declared flank action. Use bounded crowd separation rather than allowing every monster to stack in one pixel.
- Ranged units seek a valid firing position, but first-release AI does not continuously kite or flee across the lane. Arena bounds and stage timeout always terminate failed engagements.

### Targeting and readable exceptions

Ordinary enemies prefer a reachable guarding frontline tank, then the nearest exposed living hero. Starting/holding a target is deterministic; do not make ordinary enemies randomly change victims every attack.

Proposed initial encounter budget: 75–85% of normal enemy slots are frontline attackers; the remainder introduce ranged pressure, AoE, or occasional flankers. This is a content budget, not a guaranteed percentage of damage taken. Measure targeting and damage separately in tests.

| Enemy | Behavior | Counterplay |
|---|---|---|
| Frontliner | Approach the guard line and strike its defender. | Tank durability, shields, healing, focus damage. |
| Archer | Shoot the frontline from a firing distance. | Melee can advance; ranged DPS can kill it; it cannot attack from outside declared range. |
| Cleaver / bomber | Telegraph a cone, small radius, or marked area. Only explicitly global abilities hit the whole party. | Spread formation anchors, shields, damage reduction, kill/interrupt the caster. |
| Assassin | Mark the rearmost living hero, visibly travel/dash across the guard line, then attack. | Guardian intercept, shielding, control, or sufficient burst to kill the fragile attacker. |
| Boss | Published skill pattern with local AoE and occasional explicit global damage. | Pick sustain/control/damage for the pattern; no hidden universal tank bypass. |

Introduce one assassin at a time, initially no earlier than chapter 2. Its mark and windup should give automated defensive abilities enough time to respond. Prototype a 1-second warning; tune the actual burst against equal-progression starters. It cannot deal lethal damage to an otherwise healthy starter support before the defensive response window in the introductory encounter. First-release assassin disables taunt only during traversal; after landing it can be intercepted or retargeted by a ready guardian ability.

When a marked target dies, cancel or retarget at the next decision boundary and show the new marker. No invisible teleport hits. When the tank dies, the guard line breaks and normal enemies advance on surviving units; they do not continue striking a corpse.

### Action timing, projectiles, and effects

Replace immediate damage with explicit `idle -> moving -> windup -> impact/release -> recovery` states. Cooldowns and impact ticks are integer combat ticks. Combat definitions own timing; asset metadata maps the authored impact tick to an animation frame. The core does not load sprite atlases.

- Melee locks its target for windup and revalidates living target, reach, and facing at impact. A target leaving reach produces a visible miss; never a remote hit. Basic attacks do not silently redirect to a second target mid-swing.
- Projectile release requires valid cast range. A launched homing projectile may follow an alive target after it leaves cast range; this is an explicit ranged rule. If its target dies it expires. Ground AoE locks a location and affects only eligible bodies in its radius at impact.
- Healing has its own target and range policy. Reserve ready heals against predicted missing HP to reduce multiple supports wasting every cooldown on one ally. Skip an unnecessary heal without consuming its full cooldown.
- Store buffs/debuffs by source, effect ID, magnitude, expiry tick, and stack group. Same-group effects use the strongest magnitude, with refresh rules; cap damage reduction, attack speed, and control uptime explicitly. Boss resistance shortens control instead of permitting permanent stun locks.
- Resolve same-tick committed impacts in stable phases: protection effects, damage batch, deaths, then healing of survivors. Attacks already committed by a unit alive at the start of that impact phase still resolve. This allows deterministic mutual kills and prevents arbitrary array order from granting one side every tie.
- Snapshot action states, projectiles, effects, and combat-clock deadlines. An event-log eviction must not cancel an active attack.

Retain the stage timeout as the final safeguard against two sustain teams, permanently blocked paths, or missing DPS. Record no-progress diagnostics rather than awarding a fake victory.

## 6. Short, draggable, resizable desktop window

Proposed initial source viewport: **640x160**, minimum **480x160**, maximum **1280x256** within the monitor work area. These bounds are prototype values. Keep enough vertical room for the existing sprite envelope; never shrink height below 160 by cropping tall attacks.

Free dragging moves the battlefield anywhere in the work area. Optional bottom/edge snapping helps taskbar placement. Resizing changes the viewport and camera; it never changes combat reach, enemy count, rewards, or simulation speed. Sprite zoom is a separate explicit 1x / 2x option, with integer physical pixel scaling and no stretched art.

Use one world-to-screen transform for every body, projectile, target marker, and hit effect. At small sizes, pan or letterbox the camera rather than independently moving heroes by slot fraction. Keep every active threat visible where practical; if panning is required, show an edge marker for a committed off-screen attack. Do not hide assassins in a `+N` enemy count.

Persist source viewport size, integer zoom, placement mode, monitor identity, and normalized work-area anchor. Derive physical bounds from viewport/zoom and convert to CSS using actual DPR once. Restore on a missing monitor by choosing a valid work area and clamping the full window. Keep preferences separate from game saves.

Native constraints:

- Replace unconditional docking with `free | snapped` placement and `idle | moving | resizing` interaction states. Polling must not restore old bounds during a native gesture. Persist on gesture completion and clamp after OS monitor/DPI changes.
- Use Tauri native drag/resize calls and narrowly scoped capabilities. Current `resizable:false` and capabilities need explicit updates.
- Prototype a pass-through battlefield plus a tiny native control surface for Menu and Edit. That avoids requiring a polling-based whole-window input toggle to hit an exact boundary on every click. Edit mode temporarily enables drag/resize handles; exit it explicitly or with Escape.
- Existing 16ms cursor polling is not proof of reliable native routing. Validate actual cross-process click recipients. If using a single overlay is unreliable, retain separate control/management surfaces; do not call it fixed based only on CSS hit regions.
- Provide Reset position, Reset size, Show/Hide, and Quit in the tray. Recovery remains reachable when the battlefield is off-screen. Global shortcuts are optional and must be opt-in; never intercept ordinary typing in another app.
- Retain opaque window fallback. Test Windows first; preserve macOS fallback and document independent native acceptance.

## 7. Collapsed idle view and management

Collapsed shows the battlefield, small health bars, a restrained stage/boss indicator, and one unobtrusive Menu affordance. No permanent Heroes/Gear/Recruit islands. Optional quiet mode hides nonessential damage numbers and loot notices. A completely chrome-free option can open management from the tray.

Click Menu to open one resizable management window, initially approximately 760x560 logical pixels, clamped to the work area with scrolling on smaller displays. Opening it does not stretch, relocate, or pause the battlefield. Closing it returns to idle-only presentation; it does not quit the game.

Tabs: Party, Stash, Recruit, Upgrades, Settings. Stash includes filters, equipped-owner indicators, item locks, comparisons, pending chest choices, and an explicit salvage action. Upgrades can link to the selected hero's equipment rather than inventing a second progression currency. Boss controls appear contextually; ready bosses never start just because management was opened.

Chest choices must not replace the entire inventory while waiting. Show an inbox/choice subview and let players inspect gear before deciding. Offline rewards produce a quiet badge and reviewable summary; they do not force a desktop-stealing modal on resume.

The battlefield process owns the only simulation and save writer. Management receives revisioned snapshots and submits validated commands through a restricted bridge; it must never start its own combat loop, restore offline rewards, or autosave the same storage key. Reject stale/destructive commands cleanly and refresh the view. A browser preview uses the same command boundary with an in-page management panel.

Explicitly distinguish collapsed, unfocused, tray-hidden, and OS-suspended states. Collapsed/unfocused continues online play. Initially preserve the existing hidden/offline policy; hiding management alone must never trigger catch-up. Closing and reopening management cannot duplicate offline awards or purchases.

## 8. Design stress cases and acceptance matrix

The following are proposed tests for the new implementation, not results already obtained.

| Stress case | Required outcome |
|---|---|
| Tank + ranged DPS + healer vs ordinary wave | Frontline receives ordinary focus; all three roles act automatically and the starter party can progress. |
| Tank + melee DPS + support vs archers | Melee approaches a valid attack socket and damages a reachable target; no permanent idle at its anchor. |
| Assassin crosses the tank and ends behind DPS | Absolute distance and facing apply; no signed-range hit from arbitrary distance; mark and travel match actual position. |
| Tank dies during enemy windup | No hit on a dead target; next action retargets using published rules; guard line updates. |
| Target dies during projectile flight | Projectile expires without damage/rewards on another target. |
| AoE reaches two units but not the third | Exactly two eligible bodies are damaged, independent of screen width. |
| Healer, pure buffer, debuffer swap | Each has at least one favorable equal-budget encounter and one weakness; healer is safe default, not universally optimal. |
| Two tanks + healer / three supports | Can survive some content, but timeout prevents infinite progress without damage; no runaway healing or control loop. |
| Three DPS | Can farm weaker waves faster, but is less reliable against sustained equal-budget pressure. |
| Different rarities and no new pulls | Guaranteed starter team clears introductory mechanics; a rare identity is not a progression requirement. |
| Frontline dies repeatedly while backline levels | Use shared deployed-party encounter XP or bounded catch-up so the tank does not fall permanently behind. |
| Save/load during dash, windup, projectile, shield expiry | Same future state and RNG as uninterrupted play; no duplicate impact, expiry, or reward. |
| 1x vs accelerated farming | Equivalent combat outcomes for equivalent combat ticks; explicit presentation speed and impact timing; no wall-clock status drift. |
| Resize continuously during boss/assassin fight | Simulation hash remains equal to a non-resized control; active threats and telegraphs remain legible. |
| Open/close management 100 times; submit stale commands | One sim loop, one save writer, no multiplied purchases, no repeated offline reward, no geometry drift. |
| Drag across 100/125/150/200% DPI, including negative monitor coordinates | Crisp integer art, correct input positions, no repeated snap-back, persisted reachable placement. |
| Disconnect the saved monitor / change taskbar / restart | Window restores within a valid work area; tray recovery works. |
| Rapid clicks/drag at native control boundaries | Underlying apps receive clicks outside controls, controls receive intended clicks, no invisible desktop blocker. |
| Party/equipment changes before going offline | Reward-rate samples belong to the current rules and a validated formation; stale fast-clear history cannot inflate offline rewards for a weaker team. |

## 9. Implementation phases and review gates

| Phase | Deliverables and likely files | Exit gate |
|---|---|---|
| 0. Baseline and migration design | Capture source/config revision, existing saves, benchmark fixtures, and native geometry. Decide save migration and add failed-save quarantine before any rules migration. | Existing accounts can be restored/exported; historical balance artifacts are labeled by ruleset. |
| 1. Combat/visual slice | World projection; reach helpers; moving heroes; body radii; action states; authored impact ticks; one tank, one melee DPS, one healer; frontliner and archer. Files: `core/model.ts`, `combat.ts`, new targeting/actions helpers, `renderer.ts`, atlas timing metadata. | Contact and rear-melee probes pass; screenshots/video match impact ticks; save/resume is deterministic. |
| 2. Desktop and collapsed-menu slice | New bounds policy, native gestures, integer zoom, compact control surface, tabbed management, one-authority command bridge. Files: desktop math/controller/tauri, Rust shell and capabilities, renderer/layout, main/input/pixel UI. | Window stays short, freely moves/resizes, survives restart and monitor transfer, and opens management without moving the lane. Native click routing verified. |
| 3. Roles and enemy counterplay | Six initial kits, status engine, intercept, projectiles, local AoE, assassin, combat metrics, balanced auto-party/equip, guaranteed support onboarding. Data: new versioned combat/hero definitions rather than silently retuning the historical JSON. | Every archetype demonstrates its intended advantage and weakness; starter team survives introduction; no permanent control or range exploit. |
| 4. Progression, offline, and migration | Migrate legacy roles/owned heroes, retain gear/gold/tickets/progress, shared deployed XP, revalidate farm rates, review failure explanations and chest inbox. | Old saves migrate without item/currency loss; offline awards once; equipment and locked items cannot be auto-salvaged. |
| 5. Balance and native acceptance | Automated encounter matrix, population simulation, performance soak, Windows DPI/installer acceptance, separate macOS checks. | Published results meet the agreed targets; unresolved native failures block release claims. |

Build phase 1 and phase 2 as independently reviewable slices, then integrate before expanding the roster. Do not tune dozens of kits while reach/movement and the compact projection are still changing.

Migration proposal: use a new combat rules version and bump the save format if storing new action/effect state requires incompatible fields. Convert an old in-progress encounter at a documented encounter boundary, preserving campaign, wallet, inventory, roster, pity, and rewards already earned. No retroactive clear reward. Preserve the original save as a backup and invalidate combat samples from the prior ruleset. Never make a failed migration overwrite the only copy on the next autosave.

## 10. Measurements required before shipping

- Run the complete deterministic test suite, lint, typecheck/build, then browser interaction checks. Add behavior tests for reach boundaries, movement, target death, effect expiry, AoE geometry, and same-tick ties; do not rely only on new screenshots.
- Use a fixed set of equal-budget encounter fixtures covering each archetype, at three progression bands, and sweep explicit variable HP/ATK/speed values. Combat is deterministic: repeating one identical combat with different loot seeds is not a combat robustness test.
- For population progression, run at least 100 reference-policy seeds for nine calendar sessions using the documented 6h-open/18h-closed schedule with the 8h credit cap. Report censoring, p10/median/p90, config hash, rules, party presets, and kit versions.
- Treat current balance targets as provisional: chapter-1 boss median 1.5–2.5 open hours and p90 <=4h; full roster median day 6–8 if retained as a product goal; farm cycles 20–40 wall seconds. Combat pacing changes require rerunning, not inheriting, prior passes. Evaluate the redesign with legacy economy and v1.4 opt-in separately.
- Record damage taken by target-selection policy, melee uptime, approach time, healing/overheal, shielding, buff/debuff contribution, assassin kills before response, no-action time, clear duration, and loss cause. These explain why a composition works; total power alone does not.
- Run a 30-minute desktop soak with collapse/open/resize, and an 8-hour idle soak on representative hardware. Proposed budgets to validate: frame work p95 under 4ms at the default viewport, average process CPU under 2% of total machine capacity on a documented reference PC, stable settled memory with no persistent growth over repeated menu cycles. Report hardware and sampling method; these are targets, not current measurements.
- Verify that presentation changes do not alter the simulation hash and that management cannot issue duplicate rewards or competing saves. Native checks must record actual cross-process click recipients at control boundaries, OS/WebView version, work areas, and DPI.

Recommended first milestone: a 640px draggable battlefield with one menu button, one tank / one melee DPS / one healer, and a frontliner-plus-archer encounter whose visible contacts match recorded impact ticks. Expand to buffs, debuffs, AoE, and assassins only after that slice passes movement, save, resize, and click-routing checks.
