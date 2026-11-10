# Phase 4 contract: account migration and progression safety

Start only after Phase 3 review passes. User authorized native checks to remain pending; this is not permission to skip browser/core migration checks.

## Activate the completed game

Make party-v2 the normal new-game UI/runtime after this phase. Retain an explicit legacy preview/test path so historical golden checks remain meaningful. Keep `createState()` legacy-compatible for old fixtures; use the party constructor deliberately in the normal bootstrap. Expose the chosen rules in simulation/debug output and do not silently run legacy simulation while calling it new balance.

The original account key remains discoverable. Do not just change the default save key and present existing players with an apparently lost account. The temporary party-v2 preview slot is separate; do not silently merge its currencies/items into a real legacy account.

Use explicit, documented bootstrap choices: a normal no-query launch uses party-v2, compact presentation, and the original account key with transactional migration. `?combat=party-v2` remains the isolated preview slot, with an explicit `compact=0` diagnostic option when earlier contact checks require it. `?combat=legacy` selects historical core/presentation on an isolated legacy diagnostic slot. Update historical browser fixtures to seed that chosen slot and retain their exact recovery assertions; also test equivalent corrupt/future-format recovery on the normal original-key path. Do not accidentally read a migrated normal save as legacy. Preserve native `--party-preview` as isolated preview; the normal native launch now uses the compact runtime, so native resizability, tray routing, control/management creation, and opaque relaunch must no longer depend exclusively on that preview flag. If a native legacy diagnostic flag is added, preserve that discriminator on relaunch too. Separate rules selection from storage-slot selection rather than overloading a `partyPreview` boolean for both.

## Migration transaction

Implement migration as a pure conversion plus an adapter-level backup/write transaction. No in-place partial account edits:

1. Read the original raw string. Decode v1 through the existing migration or decode v2 under its recorded legacy rules. Any read/decode error follows Phase 0 recovery and blocks writes.
2. Before replacing any valid legacy bytes, store an exact raw backup under a discoverable versioned backup key and verify the stored bytes equal the original. Do not overwrite a different prior backup. If backup write/verification fails, retain the original primary, block conversion writes, and expose export/retry. Never claim a backup exists just because `setItem` was attempted.
3. Clone the decoded account. Apply any owed offline interval exactly once using the old rules/rate, before resetting old combat samples. Do not award a clear, advance a frontier, or spend a ticket merely for migrating. Record the timestamp consumed.
4. Preserve seed/RNG, roster ownership/stars/levels, all item IDs/provenance/equipment, gold/tickets, highest clear, first-clear history, pity, pending chest choices, retry/backoff and already-earned reward state. Retain the player's selected party if valid. Match the preview's onboarding grant consistently: add `mw1` (melee DPS) and `priest` (healer) at level 1 / one star / zero XP / blank equipment only when missing. Existing copies retain their exact progression; this is not a duplicate pull and grants no duplicate currency/stars. Keep all old starters and never silently replace a custom team. Fresh normal accounts therefore own the original three plus these two and deploy `[mw2,mw1,priest]`; migrate existing valid formations unchanged. Report this five-hero fresh roster explicitly in Phase 5 collection measurements.
5. Set the explicit new combat rules/version. Initialize new action/effect/projectile state and restart the current encounter at wave 1 under its current progression mode, fully healed, at the same open tick. This documented one-time encounter restart does not grant clear/replay rewards. A boss already explicitly entered may restart its own fight; migration never starts a waiting boss.
6. Clear old incompatible farm-rate samples/proofs. Keep historical campaign/statistics fields as historical, not certified under the new rules. Initialize newly required fields deterministically, without drawing loot RNG merely to assign metadata.
7. Validate the complete converted state and encode it in an explicitly supported save envelope. If optional fields suffice, do not bump the format solely for a label; if an incompatible format is needed, implement and test both old readers and the new writer explicitly. Never accept an unknown future format as an empty slot.
8. Write the converted save with the consumed-interval timestamp. If this write fails, the exact original and backup must remain recoverable and autosave must not replace them with a fresh run. Surface a persistent recovery error. Only after successful conversion/write does the authority expose the new account for gameplay.

Serialize restores/imports with an in-flight guard and generation token. While restore/migration owns the state, ordinary commands and frame stepping must not mutate the provisional account; reject/disable them briefly and refresh when ready. Rapid visibility transitions cannot let an older restore overwrite later gameplay. Management windows never perform this transaction.

## Offline proof and stale-rate prevention

Legacy offline behavior remains legacy-only. For party-v2, tie reward-rate samples to a proven party rather than a universal last-ten array:

- A farm proof records rules/kit version, ordered party IDs, stage, base per-hero HP/ATK/DEF/attack interval at the successful encounter, and measured native/wall clear-duration samples. Do not record a failed/aborted/padded-incomplete clear as proof.
- Capture that proof from the actual deployed encounter units and their immutable base encounter stats before the clear changes progression. Do not use newly selected `partyIds` or post-upgrade/post-XP `heroStats` to describe a fight that used the old team/stats. A mid-fight party/equipment change is queued; the old clear can only prove the old deployed composition. Current selected-team validation then rejects that proof until the new team completes its own valid encounter. Timed status multipliers and temporary shields are not base proof stats.
- Samples pool only when stage, ordered party, rules/kit version, and base encounter stats match. A changed sample context starts a fresh sample window; this prevents fast samples from a later stronger build being reused by an earlier weaker build.
- Before offline rewards, current ordered party and kit/rules must match proof, and each hero's current base HP/ATK/DEF must be >= the proven values with attack interval <= the proven interval. Otherwise the proof is invalid. This permits a straightforward gear upgrade to retain a conservative prior proof, while a weaker or different team cannot inherit a stronger team's rate.
- For valid proof, use the proven stage and its verified duration window, capped by highest clear. Keep native-duration gold/XP and wall-duration offline-ticket policies explicitly distinct where the existing rules require it.
- Compute party offline expected kill rewards from the actual party wave override/getter, including assassin/bomber replacements and their declared reward bases. The historical `expectedFarmRewards(stage)` loop over legacy wave IDs remains legacy-only; do not price a replaced brute as a brute after the party wave replaced it with a grunt-reward special. Use a rules-aware reward getter without mutating historical data.
- With no valid proof, use a documented conservative stage-1 estimate at no faster than the configured fallback duration. Do not silently reuse highest-stage rewards at a stale fast rate. Once the selected team proves a farm stage, use that proof. The return summary shows the reward stage so this is understandable.
- Preserve the existing offline time cap, fractional ticket carry, chest caps, zero awards for negative clock shifts, and no offline campaign/retry/open-tick advancement. Mark-and-consume each restore interval once; reopening management or acknowledging the summary grants nothing further.

Implement shared deployed-party encounter XP for party-v2: every deployed owned hero receives the same configured award even if killed earlier in that encounter. Do not grant extra XP to undeployed roster members. Legacy XP tests remain unchanged. This prevents a tank death/underlevel feedback loop.

Online encounter XP uses the actual encounter unit source IDs, including dead deployed units; a mid-fight newly selected bench hero does not receive that encounter's XP before it is deployed. Offline awards deliberately use the selected offline team and its validated proof/fallback context. Keep these two recipient rules explicit rather than reusing a current `partyIds` shortcut for both.

## Inventory safety

Add optional `locked` item state (absence means false), plus explicit lock/unlock and salvage actions validated by the authority.

Overflow algorithm for party-v2:

1. Add the new item normally.
2. Build the equipped-ID set from the entire owned roster, not only the deployed party.
3. Candidates for automatic salvage are only unequipped, unlocked items, including the incoming item.
4. If over cap, remove the lowest-value candidate with stable ID tie-breaking and grant the existing salvage formula once. Equipped or locked items are never candidates.
5. If protected items fill all existing slots, the incoming unprotected item can be salvaged with a clear inventory-full indication. Do not silently unequip an existing protected item to make room.

Explicit salvage rejects locked or equipped items, verifies ownership again at command execution, removes once and pays once. Replayed/double-click commands cannot pay twice. Upgrading/equipping still queues encounter stats according to the established policy; it must not rewrite live combat HP mid-fight.

Stash must show owner/lock state, allow filtering and selected-wearer comparison, and keep inventory inspectable while chest choices are pending. Chest choices belong to a separate inbox/subview, not a replacement of the entire stash. Show the item and gold consequences before a destructive salvage confirmation.

## Normal save export/import

Provide Settings controls for exporting the current complete save envelope and exact migration/recovery backups. An export must include the timing/format fields necessary for import, not just a developer-only core snapshot.

Import validates a candidate without mutating the active account, shows a concise account summary, and requires an explicit Replace action. Preserve the current raw save before replacing it. A corrupt/unknown-format import does not overwrite current state or storage. Import uses the same migration and single-authority transaction, never a second offline award path. Keep this local; no account server or cloud sync is in scope.

## Acceptance

- Fixture matrix: fresh/geared v1, legacy v2 at pushing/farming/boss-ready/boss-fight/complete, party-v2 reload, corrupt JSON, future format, duplicate IDs and malformed action/effect state. Preserve wallet/items/roster/progress or reject before replacement.
- Inject failures at backup write, backup verification, conversion, and final write. Exact prior bytes must remain exportable; no five-second autosave or hide/quit flush may overwrite them.
- Repeat/reload migration and summary acknowledgment; verify no duplicate offline interval, chest, ticket, or first-clear reward. Preserve RNG except documented actual old-rule offline rolls.
- Strong proven team -> weaker party, swapped formation, role/kit version change, weaker gear, upgrade, and level-up cases. Only a valid safe proof may supply its historical rate. New team proves a stage and subsequent offline rewards use it.
- Dead deployed tank receives the same encounter XP as surviving deployed allies; bench heroes do not.
- Inventory cap with equipped lowest-score item, bench-equipment, locked item, all-protected inventory, same-score ties, explicit salvage replay, and save/load locks. No protected item disappears.
- Browser: real legacy-key migration followed by reload, exact backup download, valid/invalid import, stash lock/salvage, pending-choice inspection, role presets, and normal no-query new-game launch into compact party-v2. Preserve Phase 0 recovery scenarios and all previous suites.
- Record migration version, normal/legacy/preview storage keys, APIs/actions, proof algorithm, tests and browser evidence. Stop for a fresh Sol 6.1 medium review before Phase 5.
