# M1 implementation decisions / tuning handoff

## Precedence

The delivered `config.json` wins over prose. Later steering wins over the earlier milestone: 160px canvas / 80px opaque strip, sprites instead of placeholders, boss gated before first attempt, and expected-reward offline accounting rather than closed-time combat replay. Core remains 20Hz, 1200 logical px; presentation resizing never changes combat.

## Underspecified rules resolved

- Skill replacement counts include support healing actions. Guard replaces its attack. Ties are slot/index first in combat; policy hero ties use stable hero ID ordering. Heroes act before enemy attacks after enemy movement. No combat operation draws RNG.
- Stage timeout covers all three waves and their gaps. Boss enrage is measured from boss spawn, not stage start. HP persists between waves; full heal, attack counters, level/star/gear/formation stat refresh happen at the next encounter. Changing formation does not heal/reset the ongoing combat. XP goes to living combat heroes, not a queued next-stage formation.
- The JSON's `ew3.mod.splashRadiusPx = 20` is an additive bonus to Mage's 50px radius. Stat mods multiply their respective bases; attackIntervalTicks mods are additive.
- Kill/clear currency and XP are rounded per reward with `Math.round`, then offline sums those same rounded rewards. Gear weapon/armor main stats share one uniform roll per item. Chest slot selection and charm secondary are uniform. Chests auto-open (no separate unopened-chest inventory).
- Gear score was undefined. It is upgraded flat-stat power (`HP*0.2 + ATK*4 + DEF*2`) plus `100*(ATK%+HP%+speed%)`, all multiplied by upgrade growth. Highest-scored items per slot go to the strongest party hero, then second/third. Overflow removes globally lowest score, unequips it if necessary, and uses the exact JSON salvage formula. Upgrade cost uses the *next* level, so the first upgrade costs level 1, not zero.
- The reference policy evaluates economy changes immediately after a simulation tick and before the next; it does not continually reshuffle when nothing has changed. Selection is performed before auto-equip, as ordered in the config. Boss retry checks failed-attempt power, not end-of-fight power. Automatic non-boss retry uses exact timer ticks; a power-triggered retry waits for next encounter start.
- After stage 20, an explicit COMPLETE state farms stage 20 instead of inventing stage 21. If there is no cleared stage, farming/offline uses stage 1 as the only fallback.
- Offline does not alter open ticks, ongoing combat, progression or retry timers; it grants capped expected farm rewards and XP to the selected party and opens capped chests. It never grants tickets. Offline prior to the first clear uses stage 1. Stable max-level farm is tested against open farming; a changing-level eight-hour open run is not mathematically identical to a fixed last-ten-clear offline estimate.
- Reference days are 6h open + 18h closed. The latter is capped at 8h credited. The report ends at the close of day 7's open session, with six offline intervals. `sessionStartHour=0` affects no relative timing.
- Target 2's `1:30..2:30` means **1.5..2.5 open hours**. Target 4 gacha seeds start with the free starter roster. Population balance targets are not mislabeled as proven by seed 1; the report distinguishes per-run diagnostics from required aggregate checks.
- Event log is a bounded 600-entry tail plus lifetime per-type totals. Snapshots include RNG/counters/roster/equipment/metrics and validate version/invariants. Snapshots canonicalize schema field order so load/snapshot produces the same string.
- Art is already scaled to 44–52px bodies. Render native delivered pixels at shared anchor y=136 (464 expanded), horizontally flipping enemies. The logical combat x coordinate is compressed only visually; overlapping enemies get a visual slot spread for HP-bar clarity. UI tokens drive native-pixel DPR sizing and 160/488px panel composition. The HUD uses supplied Pixel Operator text rasterization and Kenney 9-slices. Only HUD islands/panel are hit regions; the battlefield is excluded. IDs map grunt/archer/brute/bosses to goblin/skeleton/mushroom/fire-worm/mimic. Other delivered atlases/icons remain available.

## Balance is not silently retuned

Initial v1 measurements violated several design targets. The designer subsequently delivered v1.1; that exact JSON is now imported, and seed-1 measurements pass six targets with target4 reference-roster timing too early. The prototype never changes designer numbers to force a pass. The 7-day report is `sim-ref-7d.json`; full measurements and local validation are summarized in `docs/VERIFICATION.md` once generated.

Population checks across 100 reference-player seeds are **not** claimed by the single requested seed-1 run. The 10,000-seed gacha-only component is executed. Art and functional Heroes/Gear/Recruit management shells are wired; manual salvage, animation-polished reveals and audio remain future work.

## Later review: uniform hit flash

Hit events use explicit attackerId, targetId, damage and enclosing tick fields. Rendering caches one source-atop white sheet per outlined atlas and displays it for CONFIG.view.hitFlashMs=90 with color #ffffff. The art team's cleaned plain and outlined sheets arrived before final verification and were copied in full; every atlas marks bakedHitFlash=false, enforced by the art test. Hurt/attack animation timings follow their atlas tags independently of the runtime flash. Mid-flash and recovered PNGs are retained; docs/deflash-report.json preserves the art team's normalization report.

## Browser UI scope

The exact 1920px layout is implemented and compared to the supplied mockups. A compact HUD switches earlier (below 1000 source pixels) to keep buttons usable; below 736, two representative enemies plus +N are rendered without changing simulation. Below 608px, the UI spec calls for a separate normal management window; that native fallback is M2, so use a wider browser for M1 management. Native click-through, screen-space taskbar anchoring and real Windows monitor/DPI transfer are explicitly unverified, not simulated by CSS.

## Font: Galmuri (replaces Pixel Operator)

- Galmuri11/Galmuri11 Bold/Galmuri9 by Lee Minseo, OFL-1.1, subset by `scripts/subset-fonts.py` (12.6 MB of Hangul/CJK → about 0.48 MB; the game and file:// build only need Latin, Vietnamese and Cyrillic).
- "11", "22" and "9" are cap heights, not CSS sizes. Galmuri11 has 1200 units per em on a 100-unit pixel grid, so it is pixel-exact only at **12px** and **24px**; Galmuri9 (1000 upem) only at **10px**. At 11px the alpha threshold merges stems (`mmmm` renders `#...#...##...#`). `src/ui-tokens.json` is the designer's `runtime/ui-tokens.json` verbatim (`font.body/bodyBold/heading/small.cssPx` 12/12/24/10).
- Positions written for the Pixel Operator layout are slots: `PixelUI.text` draws at slot y + `font.slotOffsetY` (+2 at 12px, -1 at 24px, 0 at 10px). Specs from 2026-11-09 (`coreLoopFeedback`: island text, buttons, banner, popup, chip) give the real draw y and pass `exactY`. Button labels centre the 14px line box. All draws use textBaseline 'top' at whole pixels, then the ≥128 alpha threshold.
- Galmuri11 Bold has no Vietnamese or Cyrillic glyphs. `fontFor` uses Bold only when every character is in Bold's cmap (`BOLD_SAFE`, checked against the TTF in `tests/font-coverage.test.ts`); otherwise Regular, so locale text is always Regular.
- General overflow rule (Game Lead decision, 2026-11-09): any 12px body label wider than the box it is drawn in drops to Galmuri9 at 10px (`fitSize`), e.g. "Hero Knight 1/2" (86/88px) on the 80px roster card; the full name stays in the tooltip. Headings keep 24px and clip. The badge pulse runs on the sim tick and freezing while paused is accepted.
- Boss countdown (#3) uses Galmuri11 Bold 12px at the island heading draw y (`coreLoopFeedback.islandText.headingDrawY`), `TIME m:ss` at islandWidth-80, with `BOSS {id}` clipped to islandWidth-100; red at <=5 s, no blink.
- Core-loop feedback follows `review-core-loop-feedback.md` and ui.md §10: pip with pulse (renderer memory keyed by sim tick, 60 s cooldown, stops on hover/focus/click/panel), banner plate sized by `measureText`, two-colour popup at core-local -22 rising 16px, single panel chip, boss button in the left island row 2, management buttons 88/72/88. Centred rects use round-half-even to match the designer's tables. Timing is in `src/motion.ts` (pure, tested); `npm run shot` renders with `prefers-reduced-motion` so shots are static and byte-stable.
- Historical handoff docs (`docs/ui-v1.md`, `docs/ui-assets.md`) still describe the M1 Pixel Operator choice and are left as written.

## v1.4 chests and luck (Game Lead decisions, 2026-11-09)

- `v14.chestChoice.fromStage` stays at the config value (1). The Designer tunes it; the code does not override it.
- The pending pick-1-of-2 prompt replaces the left-island heading (a running boss countdown keeps priority). Approved.
- `bestChoice` (reference policy and the auto-resolve of a 4th queued choice) keeps option 0 when both gear scores tie. Approved.
- Recruit pity (CR-14-01/02) and gear Fortune (CR-14-03) follow design.md §14 and are opt-in (`recruitPity`, `gearFortune`); see docs/V14-LUCK.md for the choices made where the spec is silent.

## v1.4 M3 (PR 4, 2026-11-09)

- Designer answers 1–5 on luck are applied (docs/V14-LUCK.md). The settled 1.4.1 values are taken from the Designer's config when it lands; not hand-edited.
- `v14.economyOverrides` is not applied: design.md applies it only together with CR-14-01/02/05/06, and the goblin (CR-14-06) is out of scope.
- Offline ticket rate uses wall-time farm clears (`metrics.farmClearSeconds`); offline Expedition choice option B is also best-of-4 with 0 units.
- Audio controls live in the management tab row (no spec position). `stage_clear` plays on first clears only; the hit group only for hits on enemies.
- The gacha card beam (rarity-drops legendary beam) is deferred to PR 5 with the drop beam and ultimates.

## Config 1.4.1 (Game Lead, option A, 2026-11-11)

- Land the Designer's `config.json` 1.4.1 verbatim (SHA-256 `e8e8ac728829fd24fb6d6bb3936fecfc126324e00c2ffb64b6dcad406ef5605b`).
  `chestChoice.fromStage` is 10 and `farmChest.guaranteeEvery` is 7, still read only when their rules are on.
- Option A: keep the 1.4.1 first-clear ticket table at top level (1-1..1-10 = 1, 2-1..2-9 = 2, 2-10 = 1). Do not wire
  CR-14-13. `economyOverrides` stays an unread record and is to be deleted in 1.5.
- Consequence: with every v14 rule off, the game is no longer byte-identical to 1.3.0. T2 is unchanged; T4b is late
  (Designer: 17 seeds censored, 8/25 by day 8) until the rules go default-on. The rules-off golden in `tests/v14.test.ts`
  was regenerated (`d4fcedad…`); the 1.3.0 hash is kept as `V13_GOLDEN` for contrast.
- The `balance` union accepts `'1.3.0'` so 1.3.0 saves load under 1.4.1.
