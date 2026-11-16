# Continuous idle economy implementation

Date: 2026-11-16

## Delivered

- Offline gold and XP now use the actual party wave composition and the same per-enemy/per-clear rounded reward helpers as online play. Stages 9/11/20 totals are covered by concrete parity tests.
- Positive absences accrue gold, XP, clear equivalents, normal or expedition chest progress, and fractional seconds continuously. Resource fractions survive save encode/decode; stage/rate changes do not reprice earned amounts. Existing ticket arithmetic, stage-1 fallback, and the 8-hour cap remain in place.
- Restore work is serialized and generation-aware. A consumed absence is checkpointed before state becomes playable; input and simulation are gated while restoration or a failed checkpoint owns the state. Settings show stage, rates, chest timing, carry behavior, and cap.
- Follow-up P1 fixes gate management authority and debug mutations as soon as the document hides. Restore checkpoints preserve the maximum of current wall time and the already-consumed timestamp; regular autosaves and hide saves retain that session high-water too.
- README offline behavior was updated.

## Verification

- `npm test` — passed, 38 files / 322 tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed after correcting one type-only import.
- `npm run build` — passed.
- Focused offline/restore tests — 50 passed. Coverage includes actual-wave price parity, three 10-second absences versus one 30-second absence with save round-trips, chest carry, stage/rate transitions, cap/negative-time behavior, old-save compatibility, invalid banks, and restore overlap/checkpoint failure.
- Playwright Chrome Settings checks at 480, 640, and 960 CSS-pixel compact widths — the Offline progress section was visible at all widths; no page errors. Images: [480](../../artifacts/idle-settings-480-final.png), [640](../../artifacts/idle-settings-640-final.png), [960](../../artifacts/idle-settings-960-final.png).
- A seeded 1-hour save restored with 5,040 gold, 5,040 XP, 120 clear equivalents, and 3 expedition chests. An immediate reload retained the same gold/clear totals and a fresh consumed timestamp; no page errors. Collect closed the welcome panel back to the 160px lane height.
- `node scripts/offline-lifecycle-check.mjs` — passed against the local Vite app. The integrated hidden event rejected a management pull and ignored debug input (tickets stayed 6, pulls stayed 0); rollback hide and regular saves kept timestamp 100000; foreground restore and reload retained the seeded 14 gold and zero clear equivalents. No browser page errors.
- `npx vitest run tests/restore-coordinator.test.ts tests/save-timestamp.test.ts tests/management-authority.test.ts` — passed, 15 tests.
- A representative welcome-back image is [idle-return-summary-960-final.png](../../artifacts/idle-return-summary-960-final.png), captured after the count-up completed. It uses a 960px compact window so the existing 720px panel has room.

## Limits of this verification

- A true two-tab hidden-to-visible Playwright transition remains unverified. The integrated lifecycle script exercises the actual `main.ts` visibility handler with synthetic visibility state and reload; coordinator and save-timestamp units cover serialization and rollback behavior.
- The broader requested multi-seed, 8-hour default/all-rules simulation matrix and a controlled real online combat-clear trace were not run. The deterministic unit matrix and actual wave-price tests are the bounded evidence in this pass; this is not population-balance certification.
- At the default 640px compact window the existing welcome layout is wider than the canvas and its right side clips. The representative screenshot uses 960px; no renderer-scale redesign was attempted.
- Storage quota/write-failure was exercised at the restore-coordinator unit boundary; a browser DOM quota-failure fixture was not completed.
