# Taskbar Legends — milestone 1

Local fantasy idle auto-battler: TypeScript + Vite + hand-written Canvas 2D, no engine. Branch `m1-prototype` comes from local `main`. **No remote repository, push, deployment or merge has been created.**

## Run / verify

Node 24 LTS recommended.

```sh
npm ci
npm run dev                 # localhost:5173
npm run build
npm run preview             # debug API is included
npm run typecheck
npm run lint
npm run test
npm run shot                # build + isolated Playwright preview on 127.0.0.1:4175
```

For screenshots install Chromium with `npx playwright install chromium`, or set `CHROMIUM_EXECUTABLE_PATH`. The script detects `/usr/bin/google-chrome` on this box and uses a fresh, unsigned-in profile. It checks browser errors, all sprite/UI/font loads, debug snapshot roundtrip, panel resizing, keyboard roster access, actual purchase costs, insufficient tickets, continued battle, flash expiry and emulated DPI. Results are `shots/ui-checks.json`; screenshots/state artifacts are retained in `shots/`.

### HUD / controls

The **160 source-pixel canvas** is transparent above its **80px opaque strip**. Outlined sprites share **baseline y=136**. Heroes, Gear and Recruit toggle one upward **400px panel**, growing the framebuffer to **488px** with baseline **464**. Switching tabs does not resize. Close, Esc, or the active strip button collapses it. Opening/hovering management never pauses battle.

- **Heroes:** all 18 cards are reachable by wheel or arrows/Home/End. Inspecting a card never changes formation. Owned, benched heroes offer explicit replacement-slot actions. Auto-equip and actual-cost gear upgrades are available.
- **Gear:** stable item IDs, actual stats and comparison, target party slot, equip, auto-equip and upgrade. Overflow auto-salvage follows the core; destructive manual salvage is not exposed in this M1 shell.
- **Recruit:** actual configured base odds and pity, explicit x1/x10 ticket spending, disabled insufficient-funds controls, immediate in-panel result and recent-history view. No auto-recruit in the player UI. The *headless reference policy* intentionally spends every ticket.
- **Fight boss / R:** explicit first attempt or retry; bosses never start automatically.
- **Space / pause:** pause/resume. **P** pulls one; **E** selects reference formation and auto-equips; **U** upgrades the cheapest equipped item.

All essential UI uses local Pixel Operator 16px; headings use PixelOperator8-Bold at 24px. Text is cached into monochrome-alpha rasters after fonts load. Kenney-derived 48px 9-slices preserve their 8px corners. Hover/pressed/disabled/selected/focus states are explicit. Controls are accessible DOM hit targets over Canvas labels, with input restricted to two HUD islands and the open panel. This is **not a claim of native desktop click-through**; Tauri/Windows acceptance remains M2.

Native-pixel q=1 mode uses physical backing dimensions `floor(CSS width * DPR) × sourceHeight`, CSS display dimensions divided by DPR, integer draw coordinates, and `imageSmoothingEnabled=false`. This preserves physical 160px height at DPR1/1.25/1.5, rather than double-applying OS scaling. Browser DPI emulation is tested; real Windows monitor transfer is not. Default width is 1280; the exact 1920px reference is captured too. Compact HUD activates below 1000 source pixels to keep controls usable; below 736 only two representative enemy sprites plus `+N` draw, while all enemies still simulate. The spec's separate native management-window fallback below 608px is deferred to M2; use a wider browser viewport for management.

Uniform hit feedback is renderer-owned: **`CONFIG.view.hitFlashMs=90`**, **`hitFlashColor='#ffffff'`**. Each outlined sheet gets one cached white copy using offscreen `source-atop`; frames are not re-tinted during play. Every hit flashes its target for the first two 20Hz state frames, then returns to its normal animation. The cleaned delivery explicitly marks bakedHitFlash=false; source hurt/attack animation timing stays unchanged and independent of the90ms flash. `shots/10-hit-flash-1280.png` shows both a hero and enemy mid-flash; screenshot 11 shows recovery at +100ms. Audio remains an isolated no-op adapter.

## Configuration / provenance

- **`src/config.ts`** is the single typed entry point for all tunables. It imports exact delivered copies **`src/design-config.json`** and **`src/ui-tokens.json`**, validates domain discriminants, and adds implementation/presentation constants and asset-ID mappings. Drop future designer JSONs into these paths. Config wins over prose; bump its balance version when incompatible values change.
- The design directory and manifest were absent at kickoff but arrived during implementation. Final code uses the delivered v1.1 game config, UI tokens, 18 heroes, 9 enemies, and outlined atlases—not provisional placeholder balance.
- `public/assets/` contains approved CC0 atlas assets; `public/ui/` only the runtime frame/icon crops and license; `public/fonts/` only the four used font faces and license. Research references, mockups, previews, source archives and unused vendor font alternates are excluded from shipping.
- `CREDITS.md` lists every supplied source/license, including LuizMelo, Merchant-Shade/Kurt Gabriel Sotelo, Pixel Operator/Jayvee Enaguas and Kenney/Lynn Evers. Evidence: `docs/asset-licenses.md`, `docs/ui-assets.md`.
- Docs preserve the design, art, atlas and UI handoffs. `docs/DECISIONS.md` explains resolved ambiguities. `docs/VERIFICATION.md` records measured results; `docs/UI-CHECKS.md` separates browser proof from native pending gates.

## Architecture

`src/core/` contains only deterministic plain-JSON state transitions: fixed 20Hz movement/targeting, role skills, damage/DEF/shields/heals, seeded mulberry32 **only for drops/gear/gacha**, XP, stars, equipment, rewards, boss gates and retry backoff. No DOM, assets, clocks, global RNG or timers. HP carries between waves; the party fully heals and applies queued stats/formation at each new encounter. Three-wave stage timers cover gaps too.

Failures farm the highest clear. Non-boss retries use 120/240/480/600s backoff, or next encounter start after 5% power growth since the failed attempt. Timer retries land on the exact deadline, even if that interrupts farming. Bosses are gated before their *first* attempt and after losses. Stage 20 completion enters an explicit COMPLETE farming state rather than inventing stage 21.

Renderer, atlas loader, pixel UI, input, stub audio and localStorage are separate adapters. State/event snapshots are schema-validated and canonicalized. The last 600 structured events plus lifetime event counts keep saves bounded. A hit event is `{seq,tick,data:{type:'hit',attackerId,targetId,damage,side}}`; `side` is the target side, and damage includes absorbed shield damage. No rendering information is emitted by combat.

## Agent API

Available as `window.__game` in dev and built previews:

```js
__game.pause();
__game.setSeed(1);                      // resets run and pauses; uint32, including 0
__game.step(600);                       // throws unless paused; ticks, not ms
__game.getState();                      // isolated plain-JSON object
__game.input({type:'pull'});
__game.input({type:'autoParty'});
__game.input({type:'autoEquip'});
__game.input({type:'upgrade',gearId:1});
__game.input({type:'equip',heroId:'wiz',gearId:2});
__game.input({type:'party',heroIds:['mw2','hu1','wiz']});
__game.input({type:'retry'});
const saved = __game.snapshot();        // validated JSON string; no clock/offline award
__game.load(saved);                     // string or object; preserves pause state
__game.getEvents();                     // structured event tail, including every retained hit
__game.getHitRegions();                 // CSS-pixel HUD islands + optional panel, NOT entire strip
__game.getLayout();                     // source dimensions/regions, DPR, baseline, resize count, UI state
__game.openPanel('heroes');             // 'gear', 'recruit', or null
await __game.whenReady();               // sprites + fonts + UI images settled and rendered
__game.getAssetErrors();                // [] on verified build
__game.isPaused();
__game.resume();
```

The transparent effects area, HP bars, battlefield and sprites are excluded from native-interaction regions. `getLayout().sourceHitRegions` gives physical/source-pixel rectangles for a future native adapter; `getHitRegions()` gives CSS coordinates for browser controls. No native input bypass is implemented or claimed.

## Headless simulation

```sh
npm run sim -- --seed 1 --ticks 600
npm run sim -- --seed 1 --hours 1
npm run sim -- --seed 1 --ticks 600 --inputs scripts/example-inputs.json --events full
npm run sim -- --seed 1 --policy reference --days 7
npm run --silent sim -- --seed 1 --hours 1 > sim-1h.json
npm run --silent sim -- --seed 1 --policy reference --days 7 > sim-ref-7d.json
```

Inputs are `[{"tick":0,"action":{"type":"pull"}}, ...]`, applied in order before the tick advances; actions on the final tick also apply. `--ticks` and `--hours` are mutually exclusive. Hours mean open play. `--events summary` (default) returns lifetime counts; `--events full` returns the 600-event structured tail, including attacker/target/damage/tick. It is not an unbounded recording. `sim-hit-events.json` is a retained short example.

The reference policy follows config order: spend every ticket immediately; top-power formation with exactly one tank front if owned and support last if owned; best-scored gear; cheapest equipped upgrades until unaffordable; first boss attempt immediately, then only after +5% power since its last failure. Each day is **6h open / 18h closed**, with the latter capped to **8h** credited at the next session. Seven sessions therefore include six overnight credits and end after day 7's open session.

Output includes daily checkpoints, all seven target measurements and honest per-run pass/fail/pending diagnostics. Targets requiring 100-seed medians are labelled `aggregatePass:null`, not misrepresented as proven by seed 1. Target 4 separately executes **10,000 gacha-only seeds** (override `--gacha-seeds N` for speed), starting with the free starter roster. A missing full roster on day 7 remains pending through day 8. Runtime milliseconds are diagnostic, not part of deterministic state. Designer-delivered balance is imported verbatim, not silently retuned when targets fail.

## Offline / save

Saves go to localStorage every 5s, on hide/unload, and restore via timestamps. A returning hidden tab uses the same closed-time accounting. Storage failures are visible and nonfatal; incompatible versions fail validation.

The later design overrides the initial generic tick-replay request: offline awards `floor(min(elapsed,8h)/average last 10 farm clear durations)` expected gold/XP at the highest cleared stage (stage 1 fallback), plus one opened chest per 2h, capped at 4. **No tickets, progress, open ticks or retry deadlines advance.** Negative clock changes award zero. This is O(roster + capped chests), not hundreds of thousands of combat ticks. Tests prove 12h equals the 8h cap, exact rounding and stable-stage open/offline gold within 1%.

## CI / later deployment

CI runs typecheck, ESLint, Vitest (core, million-pull distribution/pity, deterministic policy, actual PNG envelopes and packaging), build and JSON-validated sim smoke. The Pages workflow deploys `m1-prototype` pushes (and supports manual dispatch) once the repository and Pages are enabled. `VITE_BASE_PATH=/repo-name/ npm run build` controls app and asset paths; nested-base browser capture is verified. No repo name is hardcoded.

**M2 remains separate:** Tauri 2 transparent/frameless/always-on-top shell, actual taskbar/work-area anchoring, click-through adapter/companion windows, fullscreen policy, monitor transfer, real Windows DPI and separate compact management windows. None is claimed proven by this Linux browser prototype.

## Local M2 desktop shell (not yet published)

See [M2 architecture](docs/M2-ARCHITECTURE.md) and the [real-Windows checklist](docs/M2-WINDOWS-TESTS.md). `npm run desktop:dev` runs Tauri2; `npm run shot:desktop` verifies the adapter against emulated OS IPC, not native click-through. The Windows artifact workflow is ready but has not run while M2 push is on hold. Linux native compilation is blocked by unreachable apt prerequisites.

M1 browser preview: https://maiphh.github.io/taskbar-legends/ ; M1 PR: https://github.com/maiphh/taskbar-legends/pull/1 (not merged). M2 source does not alter that deployed M1 build.

### Population balance report (M2)

```sh
npm run --silent sim -- --policy reference --days 7 --seeds 100 > sim-ref-100seeds.json
```

Runs consecutive reference seeds 1..100 (change starting seed with `--seed`). The gacha-only target remains a **separate 10,000-seed cohort**, evaluated once, not 100 repeated gacha cohorts. `--gacha-seeds` can override that diagnostic cohort. Aggregate mode defaults to 7 days and requires `--policy reference`; it cannot combine with `--hours`, `--ticks`, or scripted inputs. Progress goes to stderr; stdout is JSON.

Each of the seven targets has p10/median/p90, observation/censor counts, and its actual design pass criterion. Target 4 also includes gacha pull percentiles; target 6 reports both per-seed farm minimum and maximum distributions and applies universal bounds, not a median-only pass. Quantiles use R-7 linear interpolation. Unreached milestones rank above reached ones; censored quantiles stay `null` rather than quietly excluding unsuccessful seeds. A day-7 roster not yet acquired remains pending through day 8. Per-seed measurements and the exact designer-config SHA256 and the complete loaded config snapshot are retained for auditing. Target 1 uses its >=95% criterion; targets 5/6/7 require every sampled seed/clear to satisfy the bound. No balance numbers are changed.

## License

Copyright (c) 2026 Mai Gia Phu. All rights reserved. Game code is proprietary (`UNLICENSED`); see [LICENSE](LICENSE). Third-party assets retain their CC0 licences; see [CREDITS.md](CREDITS.md) and [LICENSES/](LICENSES/).

### Mac test build (M2 draft)

The desktop workflow also builds universal Apple Silicon/Intel `.app.zip` and `.dmg` test artifacts, with no Developer-ID certificate or notarization (ad-hoc only for Apple Silicon). macOS 14+; see [Mac first-launch, opaque fallback and manual checks](docs/M2-MAC-TESTS.md). Both desktop builds have a tray/menu-bar icon with Show/Hide, a persistent **Opaque window** switch (relaunches) and **Save and quit**; the desktop HUD adds an X quit button (browser build unchanged). `--opaque-window` or `TASKBAR_LEGENDS_OPAQUE=1` force the opaque fallback for one launch. Real fullscreen Spaces are a known limitation; Windows behavior and the deterministic core are unchanged.
