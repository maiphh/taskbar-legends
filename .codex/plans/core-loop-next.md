# Next core mechanic: formation-earned offline farming

Prepared 2026-11-16 by Planner GPT-6.1 Sol high for Implementor GPT-6 Luna high and fresh Reviewer GPT-6.1 Sol medium. No product code changed by Planner. No AGENTS.md found. Current workspace contains the previous GREEN continuous-idle implementation **uncommitted** on HEAD695e5ec; preserve it, including its restore coordinator/high-water timestamp, hidden authority gates, continuous resource/chest banks, tests, screenshots and reports. This document describes only the next delta. Do not commit, push, publish, release, or install native toolchains.

## Chosen gap and outcome

Current `src/core/save.ts:offlineProjection`, `farmClearSeconds`, and `applyOffline` use the highest cleared stage with universal `metrics.farmClearSeconds/nativeFarmClearSeconds`. `economy.ts:setParty/equip/upgrade` can change the selected next-encounter team without any relationship to those samples. There is no saved encounter/proof metadata. A weak or newly assembled team can inherit an earlier strong team's fast, high-stage offline rate even if it cannot clear that encounter.

Add one coherent mechanic: **a formation earns its offline farm stage/rate by actually clearing a stage**. Earned rates survive safe upgrades/level gains; swapping or weakening the team uses a conservative stage1 estimate until it earns a compatible clear. Certification is automatic—no button, currency, manual claim or repeated chore. Settings/return summary explain earned versus starting estimate. This implements the focused offline-proof section of `docs/COMPACT-PARTY-PHASE-4-SPEC.md`, while preserving the later single-runtime/canonical-save decisions.

Keep scope bounded: no manual farm-stage selection, offline campaign advancement, auto-recruit/equip/upgrade, new balance values, stage unlocks, combat changes, XP-recipient changes, lifecycle redesign, legacy migration redesign, stash salvage or import/export UI. Shared XP for dead deployed heroes remains a known separate gap (`economy.ts:grantXp` defaults to living deployed units); do not mix it into this slice.

## Player contract

- A successful completed stage automatically records the actual deployed ordered formation, immutable starting stats, current combat context and native/wall duration. A first successful push/boss clear may establish proof; the player need not wait through an extra repeat solely for certification. A repeat updates it. A loss, timeout, aborted encounter or unsettled farmPad never certifies anything.
- Before offline production, select the highest **actually earned compatible stage**, at most highestCleared. Use only its duration samples. If several stages are compatible, choose the highest stage, deterministically. No extrapolation to a higher uncleared/unproven stage.
- Compatibility requires exact ordered selected hero IDs, same combat/kit context, and each current hero's permanent calculated maxHP/ATK/DEF >= the proven starting values and attackTicks <= the proven starting interval. Safe gear upgrades, levels or stars retain the prior conservative measured rate; different heroes, rearrangement, weaker equipment/stats, or changed combat rules do not inherit it. This componentwise rule is an explicit conservative compatibility policy, not a claim of mathematically monotonic battle outcomes for every targeting/threshold interaction.
- Same heroes with different gear that yields equivalent or dominating relevant stats remain compatible. Do not key validity solely to item IDs, gold, economyRevision, roster XP, temporary buffs, HP remaining or current mana. Changing party preset without changing the resulting formation/stats does not invalidate it.
- Without compatible proof, use stage1 and the configured fallback duration, never a stale fast universal sample. Preserve the established stage1 onboarding fallback even highestCleared0. Both gold/XP and optional tickets use a valid positive fallback of at least `CONFIG.idle.avgFarmClearSecDefault`; no idle earnings are disabled.
- A valid proof supplies native duration for gold/XP and wall duration for offline tickets, preserving current semantics. Normal/expedition time-based chest thresholds/rates/caps continue unchanged; chest item drop stage follows the selected valid reward stage/fallback, consistently with the return summary. Document this choice.
- Existing continuous earned gold/XP/chest/ticket fractions are preserved across proof validity/stage/rate changes. They are amounts already earned and never reset/repriced. Eight-hour cap, negative-clock behavior, exactly-once restore checkpoints, no open tick/progression/retry advancement, deterministic RNG and explicit boss entry remain unchanged.
- Existing saves without proof load unchanged, retain all account data/fractions, and start on the clearly explained stage1 estimate until a new completed clear establishes current proof. Do not manufacture proof from historical last-ten arrays, highestCleared, event fragments, or current selected roster stats. Do not backfill old mid-encounter saves with current gear stats.

## Suggested implementation shape and exact integration

### 1. Optional saved structures in `src/core/model.ts`

Use small explicit JSON records, bounded by configured party/sample/stage sizes. Suggested names:

```ts
encounterFarmContext?: {
  encounter: number; stage: number; startedTick: number;
  rulesSignature: string;
  heroes: { id: string; maxHp: number; atk: number; def: number; attackTicks: number }[];
}
farmProofs?: {
  stage: number; rulesSignature: string;
  heroes: { id: string; maxHp: number; atk: number; def: number; attackTicks: number }[];
  nativeSeconds: number[]; wallSeconds: number[];
}[]
```

`heroes` order is the formation order; exactly three distinct owned known IDs. Stats are positive/bounded integer where appropriate, DEF nonnegative. Durations strictly positive finite; arrays nonempty, same length and <= current last-ten window. At most one proof per stage, at most CONFIG.stages.length proofs. Deterministic ordering by stage is sufficient. Current context must identify its actual encounter/stage/start; do not confuse progression after a clear with the completed encounter's stage.

Old saves may omit both fields. Unknown prior rulesSignature is valid saved data but not compatible under today's rules; preserve rather than treating a merely old signature as corruption. Malformed IDs/stats/durations/duplicate stages/inconsistent arrays reject before authority/storage replacement. Avoid trusting proof.stage above highestCleared. A pending context cannot certify a different encounter after a restart/retry. Keep current format/version2 and canonical storage key; new optional fields do not require a new envelope.

### 2. New small pure module, e.g. `src/core/farm-proof.ts`

Own capture/record/compatibility/context selection here, with no clocks/DOM/randomness. Avoid importing game.ts or save.ts into it; keep dependency direction clean. Useful functions: capture context from spawned party, record settled successful clear, get compatible proof, derive offline farm context.

Rules/kit identity must catch combat definition changes. Use an explicit resolver/kit revision constant plus CONFIG.version and a deterministic fingerprint of relevant loaded combat data (party definitions/family stats/basic/signature/mana values, enemy definitions/wave overrides, relevant sim/gap/farm-tempo parameters). Existing `getPartyHeroDefinitions()` exposes validated kits. `turnSpd` currently derives role/style rather than attackTicks; ensure its code changes are covered by the explicit resolver revision. Include a clear comment requiring that revision to change with resolver/targeting/movement/gauge/timing behavior changes. No WebCrypto, wall-clock hashes or async asset reads in core. A stable small JSON signature/hash is sufficient; no new package or generalized hash framework.

Do not include UI/fonts/audio or economy-only recruit/chest flags in the combat fingerprint. Pure economy v14 rule toggles should not invalidate the same proven combat team. Proof's stage-specific rewards are always recalculated through current shared `rewards.ts` at payment time, with prior fractional resource amounts preserved. If reward-only definition changes require a documented invalidation, state the chosen conservative behavior; never silently reuse a different combat version because CONFIG.version failed to change.

Store one proof per stage to bound state and retain useful lower-stage earned contexts. On a successful clear of the same stage, append to its last-ten samples only if signature, ordered IDs and **exact immutable starting stats** match. Otherwise replace that stage's context with the new successful one and start a fresh window. Never mix fast stronger-team samples with slower weaker-team samples. Multiple team histories per stage/LRU machinery are outside scope. When selecting, highest compatible stored stage wins; do not overwrite a higher-stage proof simply because another lower stage cleared.

### 3. Capture actual encounter stats in `src/core/combat.ts`

At `beginEncounter()` after `spawnParty()`, capture a fresh immutable encounter context from the actual `state.party` units in slot order. Their sourceId/maxHp/atk/def/attackTicks are the freshly spawned permanent encounter values before buffs/damage. Use `state.encounter`, `progress.stage`, stageStartedTick, and current signature. Do not recompute heroStats later at payout.

`setParty/equip/upgrade/pull` can change selected roster stats mid-fight; these must not rewrite the captured context or live encounter units. Failed/retried/rebuilt encounters replace their pending context; previously earned stage proofs remain available for compatibility checks. Do not make a selected weaker team temporarily use the deployed stronger team's rate.

Old saves midbattle lacking context finish their encounter normally but do not certify that fight; next beginEncounter captures a trustworthy new context automatically. This is safer than inventing a start snapshot. A save/load with an existing valid pending context must preserve it through windup/recovery/farmPad.

### 4. Record at successful settlement in `src/core/game.ts:awardClear`

Record from the pending context at the point a clear is truly awarded, before clear XP/loot/level changes and progression mutation can alter source evidence. For first clears, record the completed stage before highestCleared advances, but the final state must validate proof.stage <= newly highestCleared. Never reject an otherwise valid first clear just because highestCleared is still old inside the function.

Use existing provided `duration` and `nativeDuration` values, which include the configured stage gap; avoid adding a second gap. For farmPad, the hook runs only when settlement occurs, using phase nativeDurationTicks and actual wall duration as today. No proof on entering pad, per-wave win, retry interruption, timeout/loss, or manual clearing/debug state mutation. Guard captured encounter identity/stage/start so old context cannot certify a newer fight.

Keep existing global metrics arrays/hashes/reporting as historical/reporting values; offline calculations must stop treating them as authority for new proof. No need to delete metrics or change online farm clock/pacing.

### 5. Consume proof in existing continuous idle code

In `src/core/save.ts`, replace the universal-rate/highest-stage selection with one shared derived farm context used by **offlineProjection, applyOffline and offlineTickets/avgWallFarmClearSec**. Context supplies stage, nativeSeconds, wallSeconds and earned/fallback status/reason. All three must agree, and no function may accidentally retain stale ticket samples while gold/XP falls back.

Preserve current continuous splitWhole arithmetic, offlineAccrual, separate chest-kind banks and offlineTicketFrac. Applying offline XP may level the selected heroes; that should retain compatibility rather than rewrite proof stats into their newer values. Capture context once at the start of the operation so payout side effects do not change its stage/rates midway. Offline awards never create/update proofs.

Return selected stage/status where needed for welcome notices, including zero-time replies without state mutation. ManagementAuthority already derives `offlineProjection(this.state)`; extend this readonly projection to say earned or fallback with a concise reason. `main.ts:welcomeData` already uses result.stage—keep it accurate. Preserve RestoreCoordinator/SaveTimestamp/input gating as delivered; no lifecycle refactor needed.

### 6. Small player explanation and docs

`management/view.ts:settings()` already has Offline progress. Add concise state such as `Earned by this formation` or `Starting estimate — clear a stage with this formation to improve it`. On upgrade/level gain keep the earned rate and optionally say `Last measured clear`; do not claim a newly faster rate before a real new sample.

At a known different/weaker formation, show fallback farm1-1/rates immediately, even before next beginEncounter, with no state mutation. When that formation completes a stage, earned projection appears automatically. Return summary shows actual credited stage; no manual certification dialog, no internal proof/hash fields. Keep existing font/header/shared boss controls and responsive Settings scroll.

Update README active offline behavior to distinguish earned proof and safe fallback; append a short dated design/verification note. Existing historical reports remain historical. Clearly list shared dead-hero XP and native checks as still pending where relevant.

## Acceptance tests and bounded evidence

Run meaningful focused tests, then full `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`. Previous GREEN baseline is38files/322tests with uncommitted continuous-idle changes. Preserve these regressions; tests setting universal metrics now need explicit proof or a fallback expectation. Do not simply lower all expected payouts to get green.

1. **Actual capture/record:** real deterministic successful push clear certifies correct completed stage and deployed hero starting stats; clear XP-induced level gains cannot rewrite evidence. Include a real repeat through farmPad settlement, first boss clear and COMPLETE boss repeat where practical. Per-wave win/aborted pad/loss/timeout do not certify. Observe duration correspondence with actual existing native/wall metrics.
2. **Queued changes:** capture teamA, select B/equip stronger or weaker gear midfight, finish A's encounter. Proof describes A's start values, not current partyIds/stats. If B differs, projection stays fallback until B clears. Test order-only swaps. Pending context roundtrip before impact and during pad must produce equal continuation/proofs.
3. **Compatibility/dominance matrix:** unchanged team valid; levels/stars/permanent stat upgrades valid; equivalent gear different item ID valid; every component reduction or slower attack interval invalid; tradeoff gear (moreATK but lessHP/DEF) invalid; selected IDs/order change invalid; kit/resolver version change invalid; current HP/mana/buffs/preset label/economy-only flags do not invalidate. Verify input changes do not mutate stored proofs.
4. **Window/context control:** append identical stage/team/start stats; cap at10; changed start stats replace that stage's sample window; lower-stage clear cannot delete higher-stage proof. Choose highest compatible actual stored stage. Bad duration samples cannot yield zero/infinite rates. Never turn current highestCleared or stale last-ten arrays into proof.
5. **Offline calculation:** explicit proof with distinct native/wall durations verifies gold/XP vs ticket rates independently. Strongteam->weakteam fallback prevents old highstage/fastsample income, then real weakteamclear earns its own context. Existing gold/XP/chest/ticket fractions remain byte-for-byte until ordinary production changes them; carry is not repriced/reset.8h/12h cap and negative/zero intervals preserve prior contracts. Chest item dropStage equals selected proof/fallback stage.
6. **Save compatibility:** older save lacking metadata loads without changing owned resources/fractions/progression; safe fallback, then auto-certification after next valid contextclear. Existing proof signatures unknown to current code load as stale/fallback. Invalidduplicate stages/hero IDs/stats/arrays reject without overwriting raw account. Snapshot/save continuation produces same proof and economy outputs.
7. **Deterministic small simulation artifact, mandatory:** add/run a bounded script or reproducible test report for seeds1..3 and representative real encounters at earlystage, bossgate farm and stage11 special enemies. Use explicitly documented fixed progressed roster/gear states if necessary; do not silently alter balance. For each: complete a real encounter to earn proof; apply fixed1h offline; swap/weaken; show fallback rate/payout; restore/upgrade eligible formation; demonstrate retained proof; complete the changed team encounter where feasible to show new proof. Repeat fixed initial state to assert deterministic wallet/RNG/proof outputs. Include precise rules/config/kit signature and fixture stats. This is mechanic validation, not populationbalance certification or1h realtime soak. Avoid a report that only calls a constructed proof helper without exercising actual combat capture/settlement.
8. **Browser:** Settings at480/640/960 shows earned/fallback accurately without overlap; select/swap an owned hero through real management UI, see fallback, complete a bounded real encounter, see earned state; upgrade matching gear and confirm rate stays earned; reload preserves proof and fractions. Capture representative fallback/earned Settings images and one return summary with actual stage. Run prior lifecycle check after integration to ensure no restore regression. Native variant browser evidence may use `?shot&menu=native`; real native/toolchain/OS checks remain pending.

Create `.codex/plans/core-loop-next-results.md` and a machine-readable artifact report plus screenshots. Distinguish this next delta from the previous uncommitted idle slice; do not rebrand earlier work/tests as newly delivered. If a fixture cannot clear, record its actual loss/fallback and include another valid scenario to prove the path; do not change balance to force a proof. Fresh Sol medium reviews final source, actual tests/report and key screenshots; Luna fixes actionable findings before handoff. No publish/push/commit/native-toolchain installation.
