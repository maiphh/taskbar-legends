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

## Font: Noto Sans (2026-11-16)

- Replaced active Galmuri body typography with the unmodified upstream Noto Sans Regular and SemiBold static hinted TTFs from the official Noto repository. The primary files and exact SHA-256 values are recorded in `CREDITS.md`; full SIL OFL 1.1 notices ship in `public/fonts/OFL-1.1-Noto.txt` and `LICENSES/OFL-1.1-Noto.txt`.
- Galmuri11 remains locally bundled only after Noto Sans in the per-glyph fallback stack for symbols such as stars and arrows. No host font install or runtime network request is required. Both CSS and Canvas use the shared cached `loadFonts()` helper and the same regular/600 face registrations.
- Canvas text retains grayscale antialiasing and uses padded glyph bounds for accents and descenders. Measurement uses matching face, weight, and size. Vector UI text no longer disables browser smoothing; sprite scaling remains pixelated.
- Active text sizes are body 12px, heading 22px, and compact metadata 11px (with 10px as the compact card metadata floor). Text overflow may use a modest 11px fallback or an ellipsis; names retain accessible full labels in the DOM.
- The `scripts/subset-fonts.py` and older Galmuri-specific design measurements remain historical tooling/specification. They do not build or modify the new Noto assets.

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

## Config 1.4.2 (2026-11-11)

- Land the Designer's `config.json` 1.4.2 verbatim (SHA-256 `5da9e34cf80aebfed587c410712918291289f25cfbe2109a31e605e50f4db172`).
  Expedition Chests are 3.5 per hour, max 28; `rewards.farmTicketChance` is 0.005.
- The six v1.4 rules are on by default in the game and sim. `?v14=none` and `--v14 none` opt out. Saves still do not store the rule flags; compatibility is via the `balance` union, which now also accepts `'1.4.1'`.
- Rules-off golden regenerated to `V142_RULES_OFF_GOLDEN` (`6b332874…`) because the farm ticket chance is top-level. The 1.4.1 hash is kept as `V141_RULES_OFF_GOLDEN`.
- Welcome-back grid for more than 16 chests: 14 per row, 26 px, stride 29, last row ends at cy + 81. Stagger 60 ms (`chestStaggerMsOver16`).

- T6 farm-clear band (20–40 s) allows a 1-tick epsilon (0.05 s at 20 Hz). A 19.95 s clear passes; a 19.4 s clear is still a miss. This is a checker-only change; farm tempo itself is unchanged.

## Item lock and protected salvage (spec #4, stacks on 1.4.2)

- New `gear.salvage` block in `config.json`: `protectEquipped` / `protectLocked` / `lockMax` proposed **true / true / 30**. The code default when the block is absent is false / false / 0, which is byte-identical to 1.4.2 (same `V142_RULES_OFF_GOLDEN` and the same 2-seed 1-day aggregate).
- The game and sim apply the file values at their entry points (`?salvage=off` / `--salvage off` opt out). Tests start from the code defaults so existing goldens stay stable.
- Overflow candidates skip equipped items (when `protectEquipped`) and locked items (when `protectLocked`). The incoming item is always a candidate. Gold and tie-break (lowest `gearScore`, then lowest id) are unchanged. A `{ type: 'salvage', ..., reason: 'overflow' | 'incoming' }` event is emitted only when protection is on.
- Optional `locked: true` on a Gear item; absent means unlocked. Saves with more than `lockMax` locks still load; further locks are refused until the count is under the cap. Never auto-unlock.
- The reference player never locks. Designer will retune with protection on; this branch does not retune economy numbers.

## Boss repeat min-cycle pad (design.md §20, after 1.4.3)

- New key `combat.bossRepeatMinCycle` (boolean, optional). When the campaign is COMPLETE and the farm stage is the boss2 stage, `captureFarmClock` gives the repeat a clock of `{ scale: 1, minCycleTicks: ceil(nonBossFarmMinCycleSec × 20) }`. The fight runs at native speed (§4: boss repeats are never accelerated; padding is not acceleration) and the clear settles at `max(win + stageGap, start + minCycle)`, like other farm clears. `nativeFarmClearSeconds` keeps the unpadded fight + gap, so offline pay is unchanged.
- Key absent = 1.4.3 behaviour: no clock on boss stages. The rules-off golden (`7e9ee45a…`) and the protection-off 2-seed aggregate (`85eee5f5…`) are unchanged with the key on too, because the 1-day reference runs never reach COMPLETE.
- `config.json` ships the key as `true` (§20: "set it to true when the code ships"); Game Lead accepted it, and the boss countdown is hidden during the pad.
- Save validation accepts a farm clock on a boss stage only for a COMPLETE repeat at scale 1. The boss countdown is hidden during the pad, as it is during the stage rest.
- BOSS_READY, BOSS_FIGHT, first clears and boss1 retries are unchanged.

## Config 1.4.4 (Game Lead, folded into the §20 PR, 2026-11-11)

- `sim.stageGapSec` 8 → 6 and `version` 1.4.4; `combat.bossRepeatMinCycle` true. Nothing else changes from 1.4.3. The §20 pad now holds T6 by construction, so the 8 s gap (a config-only T6 workaround in 1.4.3) is no longer needed.
- Both config copies are byte-identical (`design/config.json` and `src/design-config.json`), SHA-256 `608614798cc81b4c4a44aa238b94cedf2a88b8d1b26fdd54a5f30dc5efd56c41`; the CI v14 smoke checks it.
- The `balance` union accepts `'1.4.3'`, so 1.4.3 saves load under 1.4.4.
- Goldens move because the gap is top-level and the snapshot carries `balance: '1.4.4'`: rules-off `7e9ee45a…` → `b70e3c56…`; protection-off 2-seed aggregate `85eee5f5…` → `04de8e49…`. The 1.4.3 hashes are kept and asserted as not-equal.

## Normal stages have no timer (owner request, 2026-11-18)

- Non-boss stages omit `timeoutSec`. A normal stage ends only when every hero is dead or every wave is cleared. The old hidden 90 s timer was sending a live push (both sides still up) back to farming the previous stage.
- Boss stages keep `timeoutSec` (1-10 is 22 s, 2-10 is 21 s) and the visible countdown. The countdown is still wall time from `stageStartedTick`, hidden during the stage rest and the §20 boss-repeat pad.
- `combat.lossCondition` matches that split. Balance version stays `1.4.4`; old saves still load.
- Runtime `src/design-config.json` SHA-256 is `a21b75425011e8aa3255d1d82a5b8a0660ee5e51f6804f4dddf95c91e224c258`. The CI v1.4 smoke checks it. This copy is no longer byte-identical to the 1.4.4 designer file.
