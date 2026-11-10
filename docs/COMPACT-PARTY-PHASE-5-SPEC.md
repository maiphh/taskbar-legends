# Phase 5 contract: evidence, balance, and final review

Start after Phase 4 passes its fresh Sol review. User explicitly authorized native checks to remain pending on this machine (Rust and MSVC absent; no Windows administrator rights). Do not install those toolchains. Native compile/install/OS click-through/DPI/manual soak results must be labeled pending, not inferred from browser emulation.

## Establish the actual shipped configuration

Capture source baseline, design JSON hash, party mechanics/kit/economy definitions hash, rules, starter roster, and policy. Historical legacy balance reports stay untouched and clearly labeled. Every new report states whether it measures legacy or party-v2 and which v1.4 rules are enabled. The normal game's default rules must be represented by the primary report.

Do not relabel legacy simulation as proof of the new combat. Extend the reference runner explicitly for party-v2, including current role presets, wearer-aware gear decisions, chest choices, and upgrade spending. Reference sessions remain 6h open /18h closed, credit capped at8h, no offline campaign progression, nine calendar sessions. State exact decision policy and clock semantics in output.

## Encounter robustness

Build a reproducible matrix of ordinary frontline, ranged pressure, local AoE, assassin, and boss sustain at early/mid/late progression. Vary actual HP, ATK, speed and formation positions with documented explicit values. Loot seeds alone do not vary deterministic combat.

Record win/loss/timeout, clear duration, approach time, melee action uptime, effective damage/healing/shielding, support effect contribution, target choice, assassin hits before defensive response, and long no-action intervals. Raw metrics must not confuse overkill/overheal with effective contributions. Confirm fixed-state reruns are deterministic and snapshot/load continuation stays equal.

Include balanced, fast farm, boss sustain, three DPS, and sustain-heavy teams. Demonstrate tradeoffs. Investigate any universally best team or specialist with no favorable encounter; fix actual defects before changing balance numbers.

## Population progression

Run at least100 seeds through nine sessions for the normal party-v2 configuration. Run opt-in v1.4 comparisons separately, clearly labeled. If runtime is long, use bounded worker processes with independent state and deterministic seed assignment; publish seed count/progress, never substitute a small cohort and label it100.

Small explicitly labeled exploratory pilots are allowed before the full cohort to catch engine/policy defects or choose trial tuning values. They are not population acceptance. Freeze mechanics, data and reference policy for the final100-seed run. Each worker reports the hashes of its actually loaded configuration/policy; the aggregate rejects mixed hashes, duplicate seeds, missing seeds or incomplete sessions. Do not edit combat/economy data during that run and label earlier workers with a later file hash. Any subsequent tuning requires a newly identified, internally consistent report.

Include p10/median/p90, reached/censored counts, per-seed results, definition hashes, starter grant/pity semantics, and timing. Unreached milestones rank after reached milestones; do not omit them from quantiles or invent completion dates.

Provisional acceptance bands from the proposal:

- Chapter1 boss median1.5–2.5 open hours; p90 <=4h.
- Full roster median day6–8 if retained as the stated collection target.
- Farm cycles20–40 wall seconds, including real min/max and sample count.
- Initial assassin cannot kill a healthy equal-progression starter support before its defensive response window.

Do not silently rewrite target bands to make the report green. If measurements miss, distinguish engine defects, poor reference policy, and content/economy pacing. Correct defects first. Any tuning must live in versioned party definitions/overrides, preserve legacy fixtures and owned-account values, and get a new hash/report. Document the trigger, changed value, expected effect, and measured result. Avoid adding unrelated time gates or currencies to force collection timing. If a product target cannot be satisfied without such a change, report the concrete tradeoff to the orchestrator.

## Browser and regression acceptance

Run the full unit suite, lint, typecheck/build and each phase's reproducible browser script against the final source. Use independent contexts and real state transitions; synthetic visibility events alone do not count as hide/show. Do not weaken earlier assertions just because defaults migrated: route historical checks through an explicit legacy path and add assertions for the new normal path.

Exercise every management tab and primary action, exact migration/export/import recovery, normal reload,100 menu cycles, repeated zoom/resize, background/foreground, duplicate requests, and stale selection. Confirm one authoritative game/save writer, no duplicate rewards, no accumulated listeners, and simulation independence from menu/viewport operations. Capture final closed and management screenshots at480/640/960 widths and integer zooms where work area fits.

For performance, record environment, browser version, sample duration, frame-work p95, long tasks, memory and listener/timer stability. Separate a short browser repeat-open/resize leak probe from the proposed30-minute desktop and8-hour native idle soaks; native soaks are pending under the user's deferral. Never call a time-skipped simulation an8-hour real-time stability run.

Use at least a 60-second real-time foreground browser sample for frame-work timing. Measure application frame callback work (simulation plus drawing), state sample count and quantile method, and record long tasks separately; elapsed time between animation callbacks is not CPU work time. For lifecycle stability, compare actual event-listener counts on window/document/management root (CDP inspection is suitable) and active interval counts before and after 100 close/open cycles. DOM node counts alone are insufficient. Record JS heap with the sampling/GC method if available; do not label it whole-process memory. Native CPU, whole-process memory and the documented hardware acceptance target remain pending if not directly measured; do not substitute a Chrome heap measurement for a Tauri process claim.

## Delivery and final gate

Update `COMPACT-PARTY-IMPLEMENTATION.md` with each phase's review status, exact current verification commands and results, report/screenshot locations, normal/legacy preview URLs, and all remaining limitations. Update the main README so the user can run the new game and understand the native verification boundary without reading historical milestone documents.

Have a fresh GPT-6.1 Sol medium reviewer inspect the final integration, reports, and acceptance claims. Luna fixes actionable findings before final handoff. Do not publish, push, release installers, or claim native acceptance. The final response should say what works, how it was checked, and which native checks remain pending by user choice.
