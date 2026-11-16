# Formation-earned offline farming review — 2026-11-16

**GREEN** — no blocking findings in the formation-proof delta.

## Source assessment

- `beginEncounter` captures the actual spawned, slot-ordered permanent unit stats into a separate immutable JSON context. Queued team/equipment changes do not rewrite that evidence. Successful settlement records it before clear XP/progression changes; losses clear pending evidence, and entering farmPad alone does not certify.
- Selection requires the current signature, exact selected formation order, and componentwise permanent-stat dominance, then chooses the highest compatible stored cleared stage. Unknown signatures remain loadable but incompatible. Old global timing arrays no longer price either resources or tickets.
- Offline payout captures one context before XP/loot side effects; its stage/native duration/wall duration drive resource rewards, tickets and chest drop stage consistently. Existing fractional balances and prior lifecycle/high-water fixes remain intact.
- Proof schemas bound stages, stats and sample counts; reject duplicate/unsorted stages, unknown/duplicate hero IDs and mismatched/invalid duration arrays. Existing optional-field saves remain supported. Context identity/stage/start checks prevent a stale context certifying a subsequent encounter.
- Reviewed tempo-test normalization: only signatures expected to differ under deliberately changed combat parameters are normalized; reward/state assertions remain. Explicit proof fixtures replace old universal-metric authority in rate arithmetic tests. No observed disabling of an economy or timing assertion to conceal a regression.

## Independent verification

- `npx vitest run tests/farm-proof.test.ts tests/farm-tempo.test.ts tests/v14-offline.test.ts tests/offline-continuous.test.ts`: **4 files, 39 tests passed**.
- `npx tsx scripts/farm-proof-check.ts`: passed **9 actual-combat scenarios** (seeds1–3, stages1/9/11) with deterministic repeated output. Reviewed the generated report and fixture: configured maximum-level/star roster is disclosed, actual encounter capture/settlement is exercised, and earned/fallback payouts, safe upgrade retention, save roundtrip and changed-team stage1 recertification are asserted.
- `node scripts/farm-settings-check.mjs`: passed at480/640/960, including the real640 management party swap, restored formation, gear upgrade and proof-preserving reload; no page errors.
- `node scripts/offline-lifecycle-check.mjs`: passed; hidden mutation rejected, tickets6/pulls0 and credited14gold/0clear equivalents retained through foreground/reload; no page errors.
- Inspected actual earned/fallback480 Settings, earned640 and fallback960 images. Status/rate explanations are readable and fit within the Settings scroll container; shared campaign chrome remains intact.

Full **39files/327tests**, lint/typecheck/build are implementor-reported passing. This review independently ran the focused tests and scripts above. It reviews only the new formation-earned mechanic; the earlier continuous-idle implementation remains a separate previously reviewed delta.

Real native/OS visibility acceptance, previously documented narrow welcome-layout limitations, and shared XP for dead deployed heroes remain outside this bounded mechanic review. No product code changed by reviewer; only generated verification artifacts and this report were written.
