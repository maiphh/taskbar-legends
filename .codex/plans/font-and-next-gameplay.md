# Readable typography and visible campaign/boss controls

Prepared 2026-11-16 by Planner (GPT-6.1 Sol high) for implementor GPT-6 Luna high and reviewer GPT-6.1 Sol medium. This is a bounded implementation handoff; no product code has been changed by Planner. No applicable AGENTS.md was found in the repository or its ancestors.

## Scope and outcome

1. Replace broken-looking Galmuri body typography with a locally bundled, readable sans family across DOM management, canvas text, notices, and native controls. Preserve the pixel sprites and frames.
2. Add one coherent game improvement: persistent campaign status and a discoverable, explicit boss start/retry action. Players should understand why the game farms at a boss gate and be able to start the boss without visiting Settings. Reuse the existing core retry action and authority.

Do not expand into new heroes, combat rules, balance tuning, currencies, quests, save migrations, a sixth management tab, or a phase-5 certification project. Do not push/publish/release, install native toolchains, or claim native OS acceptance. Preserve current saves at `taskbar-legends:v1:party-v2`, the separate legacy account, deterministic combat, and existing window routing. Existing untracked `.DS_Store` files belong to the user's workspace; leave them alone.

## Confirmed typography diagnosis

- `src/font.ts` explicitly documents Galmuri11's supported 12/24px and Galmuri9's supported 10px. But `src/style.css` currently uses Galmuri9 at 8px and 9px in the loadout hero/equipment strip, and Galmuri11/Galmuri9 at 11px in native loadout rules. These off-grid sizes produce visibly irregular stems. Inspect `artifacts/review-loadout-480.png` for the current result.
- CSS forces `-webkit-font-smoothing: none`, `font-smooth: never`, and `text-rendering: optimizeSpeed` on the main controls/menu. These constraints should not carry forward to vector UI text.
- `PixelUI.text()` rasterizes every canvas label then forcibly converts its alpha to 0/255. Replacing only the font file would destroy the antialiasing of the new vector face.
- DOM and canvas duplicate font loaders. `ManagementView.loadFonts()` swallows failures. `src/control-entry.ts` imports styles but never loads any Galmuri font, so its native controls can silently use the monospace fallback.
- The 480px screenshot also shows the fixed tabs and wallet colliding. Font replacement needs a bounded layout adjustment to prevent text overlap, rather than shrinking essential text further.

## Font decision and provenance

Use **Noto Sans Regular and SemiBold**, static hinted TTFs, unmodified. These are proven downloadable from the official Noto repository. Retain one existing `Galmuri11.ttf` as an explicit local fallback for UI symbols only; Noto Sans does not itself contain all current stars/arrows. It covers the existing Vietnamese/Cyrillic sample letters. Do not silently depend on host-installed symbol fonts.

Official candidates investigated:

- Noto Sans: [official project license](https://raw.githubusercontent.com/notofonts/noto-fonts/main/LICENSE), SIL OFL 1.1. Recommended for its ordinary readable body shapes and existing multilingual requirements.
- Inter: [official project](https://rsms.me/inter/) and [license/source](https://github.com/rsms/inter). A suitable alternate screen UI family, also OFL. Do not ship multiple selectable font families in this change.

Verified download URLs and SHA-256 values (read-only network check by Planner):

| Asset | Official URL | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| NotoSans-Regular.ttf | https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf | 569208 | b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5 |
| NotoSans-SemiBold.ttf | https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-SemiBold.ttf | 572924 | 87a8b90ece1e89746b544e4e086f85a3710e41485a8078f9be874837dfad45d5 |

Download into `public/fonts/`; retain the exact upstream Noto OFL in an unambiguous new filename in `public/fonts/` and `LICENSES/`. Keep the existing Galmuri license because its fallback font remains shipped. Record URLs/hashes and actual copyright notices in CREDITS/license docs. Do not install fonts into the OS. Unmodified full static files avoid introducing a font build dependency. `fontTools` is not currently installed on this machine; do not make it required merely for this work.

## Implementation A: shared font loading and rendering

### `src/font.ts`

- Replace active face registry with Noto regular, Noto semibold, and the one local Galmuri regular symbol fallback. Stable aliases such as `GameSans`, `GameSansSemibold`, `GameSymbols` are fine; preserve the actual file metadata/license.
- Export a single cached `loadFonts()` promise/helper used by canvas, management, and native control entry. Resolve asset URLs with `import.meta.env.BASE_URL` and the current window URL, matching existing conventions. Never assume root `/fonts/`, since the Vite build supports nonroot base paths.
- Register actual regular/semibold distinctly and construct a shared canvas/CSS stack with local symbols then `system-ui, sans-serif`. If using one family with weights instead, register explicit FontFace weight descriptors and ensure canvas and measureText set the same weight.
- Remove the old `BOLD_SAFE` Latin-only routing. Both new text weights must support Vietnamese/Cyrillic without switching all bold text to a different face. Symbol fallback is per glyph through the stack.
- Keep named BODY/HEADING/SMALL constants if useful. Suggested starting metrics: canvas body12px, heading22px or24px, small11px; DOM main body12px/16px, headings20–22px, compact metadata at least10px (prefer11). Essential labels/buttons must remain at least12px where space allows. Choose final metrics by actual screenshots, not by preserving Galmuri cap-height assertions.
- Remove or recalibrate Galmuri-specific optical offsets. Explicit `exactY` behavior may remain for caller compatibility, but do not propagate obsolete pixel-font comments.
- The current body-to-small fit fallback may remain with the new floor. If a label still does not fit, use ellipsis and accessible full text/title in the DOM, and clipped/ellipsized text with sane measurement in canvas. Never use horizontal text compression or reduce text to8px.

### `src/pixel-ui.ts`

- In `load()`, await the shared font helper and preserve observable `errors` on failure. Existing art readiness behavior must continue to work.
- In `text()`, preserve grayscale alpha; remove the 128 threshold pass. Keep the existing bounded text cache and integer source placement. Size cached rasters with enough top/bottom padding for accented glyphs; account for actual bounding boxes/bearings where needed. Avoid clipping Vietnamese accents and descenders.
- `measureText()` must use the exact same family, weight, and size as rendering. Do not round advance widths down before fitting; ceil or retain fractional measurement at the comparison boundary.
- Keep sprite `imageSmoothingEnabled=false` and image-rendering rules where they preserve pixel art. Text antialiasing within the source raster must survive. Check reveal, welcome-back, banners, stage labels, and damage popups, not only management text.

### `src/management/view.ts`, `src/control-entry.ts`, `src/style.css`, tokens

- Delete the duplicate ManagementView font-loading implementation; consume the shared helper and report failures accessibly rather than silently hiding them. Use a reasonable system fallback if local font loading fails.
- Ensure the native controls load/register the same fonts when `/control.html` starts. Canvas/native management/windows must share the same font contract even when opened independently.
- Define CSS family variables centrally, use actual semibold weight/face consistently, remove disabled antialiasing directives from text. Do not apply a blanket smoothing change to sprite assets.
- Audit every active Galmuri reference and tiny text size in style.css, especially `.px-loadout-equip small`, `.px-loadout-item small`, `.px-loadout-hero-name`, `.px-loadout-hero small`, native loadout overrides, `.px-card-lv`, `.px-stars`, notices and controls. Adjust fixed line heights/boxes to avoid accents or descenders being cut off.
- Fix the header/nav/wallet collision at480px by giving the wallet its own reserved area/row or responsively tightening the tab layout while preserving full labels and readable sizes. It is acceptable to modestly adjust header/main offsets and corresponding body-height variables if needed; keep browser management400px and native760x560 unless a demonstrated fit issue requires otherwise.
- Update the active `font` block of `src/ui-tokens.json` and relevant active explanatory text. Historical designer measurements elsewhere can remain historical; do not mass-rewrite old specs/screenshots.
- Update README's active font statement, CREDITS.md, LICENSES/README.md, and a short dated decision in docs/DECISIONS.md. Existing `scripts/subset-fonts.py` can remain clearly labeled historical Galmuri tooling; do not pretend it builds the new assets.

## Implementation B: campaign status and explicit boss control

### Product behavior

Persistent short status appears in the compact lane (currently only the stage ID in `PixelUI.drawCompactLane`) and in common management chrome visible on Party, Stash, Recruit, Upgrades and Settings. It must not disappear after the transient boss-ready banner expires.

| State | Player-facing meaning | Action |
| --- | --- | --- |
| PUSHING | `Stage 1-3` / `Pushing` (include wave progress in management if available) | none |
| FARMING | `Farming 1-3` and next target `1-4`; explain automatic retry | `Push now` via existing retry, where space permits |
| BOSS_READY, bossLosses0 | `Boss 1-10 ready`; `Farming 1-9 until you start` | `Fight boss` |
| BOSS_READY, bossLosses>0 | same gate plus failed-attempt count if useful | `Retry boss` |
| BOSS_FIGHT | `Boss 1-10` / `Fighting` | none |
| COMPLETE | `Campaign complete`; acknowledge continuing farm repeats | none |
| paused flag | append/show `Paused` accurately | existing Settings pause remains |

Use `stageConfig(number).id` consistently; a numeric stage index10 is not the same presentation label as1-10. At boss-ready, `progress.stage` is the farm stage and `bossStage` is the boss target; distinguish them. Bosses must never auto-start as a consequence of displaying status or opening menus.

### Concrete integration

- Add a small pure presentation selector in `src/core/selectors.ts` (or a dedicated shared campaign-status module) that accepts only the required progress/paused information and returns short lane text, management text, tone, and optional action label. Unit-test all discriminants. Keep this helper read-only.
- `src/pixel-ui.ts:drawCompactLane()` replaces the bare stage text with the short persistent status, constrained to available width. Respect edit-mode controls and keep hero sprites/bars visible. No need to add a new canvas hit island or bypass authority.
- `src/management/view.ts`: add persistent campaign status plus the boss action to shared header/chrome rather than any tab body. The existing common header contains only title/run-state, while the y72 status row is used for action feedback. Maintain both campaign status and feedback; do not overwrite one with the other permanently. Use a responsive two-line/header layout if necessary, adjusting main offset/body height consistently. Preserve the five tabs and reveal behavior.
- Common CTA dispatches `this.command({type:'retry'})`, using the current revision/request-ID flow. Put the button outside the transient tab footer so it is available on every tab. Prevent double submission while a campaign command is pending and refresh on rejection/stale state. Do not add a direct state mutation or second save writer.
- `renderHeader()` runs on every fresh management snapshot. Update status/action in place when possible so the200ms polling does not steal keyboard focus or recreate focused buttons continuously. When action becomes unavailable, remove/disable it and move focus sensibly only if needed. Add aria labels; do not announce a changing countdown every200ms.
- `src/management/authority.ts` already validates retry only for FARMING/BOSS_READY and `core/game.ts:retry()` handles exact progression. Reuse these contracts; extend tests, change no combat/economy behavior.
- Remove/move the redundant Settings-only retry footer and correct stale developer copy saying the current game is an opt-in preview. Settings can retain explanatory text that agrees with the new selector.
- Avoid timers/countdown calculations in this scope unless they are demonstrably needed. No wave/clock/save schema additions are required for a useful persistent gate/status feature; optionally expose read-only current wave in ManagementSnapshot only if it meaningfully improves the concise copy and corresponding native snapshot checks stay compatible.

## Acceptance and verification

Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` against the final source. Do not claim success based only on focused tests. Fix actual regressions, preserving meaningful tests rather than disabling them.

Focused verification to update/add:

- `tests/font-coverage.test.ts`: replace Galmuri-specific expected names/native-size assertions with coverage of printable ASCII, current UI punctuation/symbols, Vietnamese and Cyrillic in both new text weights plus the explicit shipped symbol fallback. Keep actual cmap checks; repair DataView construction to respect Buffer.byteOffset/byteLength if touched. Do not require primary Noto fonts alone to contain stars/arrows known to be in the local fallback. Drop brittle exact old advance widths.
- `tests/ui-tokens.test.ts`: update intended font metrics assertions if changed. Keep unrelated art/feedback contracts intact.
- Selector tests: all5 progress kinds; first boss vs retry; paused; correct bossStage/farmStage labels; pure/no state mutation.
- Management authority regression: from BOSS_READY, one explicit command enters BOSS_FIGHT exactly once; duplicate request replays do not create a second encounter; repeated/stale requests reject or replay appropriately; normal progress cannot retry; opening/refreshing tabs never starts the boss. Existing authority tests provide patterns.
- Browser checks: use the installed Playwright library and available Chromium, or supported in-app Browser skill. Existing scripts hardcode a Windows Chrome default; use `CHROMIUM_EXECUTABLE_PATH` when needed or a portable local fallback. Do not rely on nonexistent README `npm run shot` script. Follow browser skill instructions if using that skill. A project-local Playwright check script is appropriate for reproducible font/campaign verification.

Browser scenario and screenshot minimum:

1. Fresh isolated context at bare `/`, fresh starter account. Await game assets and document.fonts; confirm local font requests succeed, expected faces are loaded, no page errors or asset errors. After load, block external network and confirm everything renders/reloads from local assets (do not block the local app).
2. Capture readable after screenshots under `artifacts/` at480,640,960 widths, with closed lane and Party loadout. At480, tabs must not overlap wallet; all essential labels12px where feasible, metadata10px minimum; hero names can ellipsize with full accessible names.
3. Exercise Formation, Stash selected-item comparison, Recruit x1 and x10 reveal, Upgrades and Settings at least at480 and960. Inspect actual screenshots for clipping, accents, white/cream contrast, aligned baselines and overlapping text. Capture a representative Vietnamese/Cyrillic specimen using actual rendering helper/temporary debug fixture without adding translation work.
4. Check DPR1 and2 and at least one fractional DPR1.25 (browser emulation only); integer zoom1/2 where viewport fits. Sprites remain crisp while text retains antialiased edges. Do not label this native monitor testing.
5. Load a deterministic valid BOSS_READY fixture through `__game.load`, display the status from each management tab, click the common boss button on a non-Settings tab, and assert BOSS_FIGHT and one encounter transition. Include first-attempt and failed-boss fixtures, transient banner expired, paused state, farming and complete. Reload a normal save and verify unchanged account/progression.
6. Capture native management variant with `?shot&menu=native` (existing main.ts supports it), and check `/control.html` local font registration with a suitable Tauri mock or source/browser harness. Real Tauri windows and OS checks remain pending if unavailable.

Save test/check results and screenshot paths in a short artifact report (e.g. `artifacts/font-campaign-checks.json` plus a concise dated verification note). Report any pre-existing failures separately with concrete evidence. No100-seed balance run, long performance certification, or native toolchain installation is required for this UI-focused change. Run native checks only if Rust code becomes necessary and the existing toolchain is available; avoid changing Rust for this scope.

## Delivery checklist for implementor/reviewer

- Typography is visibly improved in actual screenshots, not merely a changed CSS name; canvas text is no longer binary-alpha thresholded.
- Noto files and both relevant license families are shipped locally, with accurate provenance. No runtime external font dependency.
- All five management tabs retain usable controls at480/640/960 and native variant dimensions. Current save compatibility is preserved.
- Boss readiness remains visible after banners expire, with explicit start/retry available on every management tab through the authority. Simulation continues while menus are open; pausing behaves as before.
- Full test/lint/typecheck/build results and useful visual evidence exist. A fresh Sol medium review examines actual final diffs and images; Luna fixes actionable findings before final delivery.
