# Formation-earned idle farm results

## Implementation delta

Added bounded, stage-specific farm proofs based on the actual party and permanent combat stats captured when an encounter starts. Only a successfully settled clear certifies a proof. The selected proof is usable by the same ordered formation when its current stats are at least as strong and the combat/rules signature still matches; weaker, changed, or unproven formations use the existing stage 1 estimate. Proofs drive offline gold/XP, ticket, chest-stage, and projection context together. Older saves without proofs keep their prior data and use the fallback estimate.

New code: `src/core/farm-proof.ts`; focused model, encounter, award, offline-rate and Settings changes in `src/core/model.ts`, `src/core/combat.ts`, `src/core/game.ts`, `src/core/save.ts`, `src/management/view.ts`, and `src/pixel-ui.ts`. Documentation and focused tests were added in `README.md`, `tests/farm-proof.test.ts`, `tests/helpers/farm-proof-fixture.ts`, and adapted offline-rate tests. The earlier idle economy/lifecycle slice remains present as a separate uncommitted change; this report describes only the formation-earned proof delta.

## Verification

- `npm test` — exit 0; 39 files, 327 tests passed.
- `npm run lint` — exit 0.
- `npm run typecheck` — exit 0.
- `npm run build` — exit 0.
- `npx tsx scripts/farm-proof-check.ts` — exit 0; 9 actual-combat cases across seeds 1–3 at stage 1, stage 9, and stage 11; repeated runs deterministic. Artifact: `artifacts/farm-proof-check.json`.
- `node scripts/offline-lifecycle-check.mjs` — exit 0; hidden pull command rejected, tickets remained 6 through foreground restore and reload, no browser errors.
- `node scripts/farm-settings-check.mjs` — exit 0; earned and fallback Settings projections checked at 480, 640, and 960 widths. At 640, a real party change switched to fallback; restoring the formation, upgrading a valid common weapon, and reloading retained the earned proof. No browser errors.

Visually inspected 480px Settings screenshots: `artifacts/farm-settings-earned-480.png` and `artifacts/farm-settings-fallback-480.png`. Both status explanations and rates are readable within the Settings panel. The browser script also captured 640px and 960px earned/fallback variants.

The combat matrix uses three deterministic seeds and the documented fixed, progressed team; it is a bounded smoke matrix, not a broad balance study. Hidden-tab ticket authority is covered by the lifecycle smoke; exhaustive multi-hour browser timing permutations were not repeated in this mechanic pass.
