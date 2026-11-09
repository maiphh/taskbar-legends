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

Initial seed-1 measurements already violate several intended design targets. The prototype deliberately preserves the delivered v1 numbers and reports failures for the designer to tune. The 7-day report is `sim-ref-7d.json`; full measurements and local validation are summarized in `docs/VERIFICATION.md` once generated.

Population checks across 100 reference-player seeds are **not** claimed by the single requested seed-1 run. The 10,000-seed gacha-only component is executed. Art and functional Heroes/Gear/Recruit management shells are wired; manual salvage, animation-polished reveals and audio remain future work.

## Later review: uniform hit flash

Hit events use explicit attackerId, targetId, damage and enclosing tick fields. Rendering caches one source-atop white sheet per outlined atlas and displays it for CONFIG.view.hitFlashMs=90 with color #ffffff. The art team's cleaned plain and outlined sheets arrived before final verification and were copied in full; every atlas marks bakedHitFlash=false, enforced by the art test. Hurt/attack animation timings follow their atlas tags independently of the runtime flash. Mid-flash and recovered PNGs are retained; docs/deflash-report.json preserves the art team's normalization report.

## Browser UI scope

The exact 1920px layout is implemented and compared to the supplied mockups. A compact HUD switches earlier (below 1000 source pixels) to keep buttons usable; below 736, two representative enemies plus +N are rendered without changing simulation. Below 608px, the UI spec calls for a separate normal management window; that native fallback is M2, so use a wider browser for M1 management. Native click-through, screen-space taskbar anchoring and real Windows monitor/DPI transfer are explicitly unverified, not simulated by CSS.
