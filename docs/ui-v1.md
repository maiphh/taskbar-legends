# Idle battler — pixel UI implementation spec

Status: implementation handoff, 9 Nov 2026 (Asia/Saigon). The latest Game Lead decision supersedes the earlier 80px-only window: **fixed 160px transparent combat overlay; opaque HUD/ground in its bottom 80px**. No resizing during combat. Panels expand the window once on open and restore it once on close. **Art authority: `../docs/art.md` and `../assets/manifest.json` override older UI outline/baseline proposals.**

## 1. Research: what was actually observed

Reference images are study material only. Never package `ui/ref/`, Steam art, wiki images, thumbnails, logos, or wallpaper imagery with the game. All mockup backgrounds and geometry are original; heroes and item icons use the approved CC0 packs.

| Game/source | Visible UI pattern | Adopt / avoid |
|---|---|---|
| [TBH: Task Bar Hero — Steam](https://store.steampowered.com/app/3678970/TBH_Task_Bar_Hero/) | `ref/tbh-1.jpg` shows a small **floating** battle lane, not a full-width 80px strip, beneath a tall framed Hero window. Red/green unit HP bars; currency on a dark top plate; equipment slots surround a selected hero; inventory grid and circular navigation below. `tbh-2.jpg` adds separate Status and Portal windows; `tbh-5.jpg` adds a Cube window and an item tooltip. Dark stone borders, gold edging, red title plates, opaque backing, large pixel headings and more compact body text. `tbh-3.jpg` shows tiny heroes sitting over the taskbar; `tbh-4.jpg` is an enlarged combat close-up with HP/XP plates. | Keep the idle/management separation, strong slot frames, high-contrast backplates and compact HP bars. Use **one tabbed panel**, not three competing windows. Do not copy its ornament, icons, typography or screen assets. A Cube crafting panel is **not evidence of gacha**. |
| [TBH gameplay video](https://www.youtube.com/watch?v=AJQgeo5ghNU) and [thumbnail](https://i.ytimg.com/vi/AJQgeo5ghNU/maxresdefault.jpg) | The fetched thumbnail is a Steam Deck/promotional composite, with taskbar-sized characters. Search-exposed video transcript discusses window scaling and tiny text. The thumbnail is not a measurement source; full gameplay was not played. | Keep explicit zoom controls and never assume a thumbnail reveals actual control dimensions. |
| [TBH GameWiki screenshots](https://gamewiki.games/games/tbh-task-bar-hero/) / [community database](https://taskbarhero.wiki/) | `ref/tbh-gamewiki-screenshot.jpg` reproduces the Steam Hero screenshot, corroborating that arrangement but **not an independent UI example**. The database exposes classes/gear/stages, not a usable in-game layout screenshot. | Treat wiki data as context, not authority for gacha or panel behaviour. |
| [Rusty's Retirement — Steam](https://store.steampowered.com/app/2666510/) | `rusty-1.jpg`: full-width farm occupies roughly the lower third of the promotional desktop; grid/store attached on right, resource totals low down. Pale stone panels have dark text and patterned edges. The scene itself supplies the backing. Store description supports bottom/vertical placement and Focus Mode. | Keep persistent quiet activity at the edge; reveal detailed management on demand. Our height is much smaller, so do not copy its dense always-visible shop. |
| [Deskrawl — Steam](https://store.steampowered.com/app/4623570/) | `deskrawl-1.jpg` and `deskrawl-3.jpg`: shallow combat world along bottom; left health orb/action bar, central enemy bar, right menu icons. It uses rendered/3D fantasy rather than pixel art. Many bright damage numbers overlap badly in the busy shot. | Use left/right HUD anchoring; cap simultaneous damage labels. Do not adopt the art style or damage-number density. [Its wiki](https://wikily.gg/deskrawl) returned 403 to this fetch; no wiki-only visual claims. |
| [Tiny Pasture — Steam](https://store.steampowered.com/app/3167550/) | `tiny-pasture-1.jpg`: animals along bottom, coin plate and compact building/menu buttons on right. Warm wood/gold frames; `tiny-pasture-3.jpg` shows strong character silhouettes against a busy scene. The store supports repositioning/resizing the pasture. | Borrow calm silhouettes, a compact currency plate and right-side controls, not pastel farm UI. |

All screenshot size comparisons above are visual proportions of promotional images, **not verified runtime pixel dimensions**. The source JPEGs are 1920×1080. Border appearance suggests reusable tiled frames; screenshots cannot prove any game's actual 9-slice implementation or exact font family. Their click-through behaviour was not tested. Full extracted Steam screenshot URLs are in `ref/sources.json`; 5 images per game were downloaded from public HTML metadata (HTML entities and escaped JSON URLs decoded, no private API).

## 2. Coordinate system and window sizes

All values below are **source-art pixels**, not automatically CSS DIP. Default pixel zoom `q=1`. A source pixel must land on exactly one physical display pixel. At an explicitly selected 2x accessibility zoom, each source pixel becomes a 2×2 physical block. Never use 1.25x/1.5x sprite or UI scaling.

Reference viewport width `W=1920`; actual source width is `floor(monitorWorkAreaPhysicalWidth/q)`. Use selected monitor work area and taskbar position, not hard-coded 1080p or taskbar height. Bottom of the overlay sits **at the top of the Windows taskbar/work-area bottom**, never over its buttons.

### Closed / combat layout

- Main visual framebuffer: **W×160**, fixed throughout combat; reference **1920×160**.
- Effects ceiling: `y=0..79`, alpha 0 except spell pixels, baked outlined sprites/aura extending upward, floating text, and sprite-attached HP bars in its bottom6px. No full-area backdrop here.
- Core strip: `y=80..159`, fully opaque navy/ground, exactly **80px**.
- Unit anchor baseline: **y=136** (= core-local **56**), exactly as `manifest.overlay.recommendedBaselinePx` and `../docs/art.md`. The **baked outlined ink** reaches at most **128px above** and **18px below** the anchor, so its bounds are y=8..154 (bottom exclusive): **8px clear above and 6px below** in the fixed 160px window. These are already outlined extents; do not add another outline margin. The verifier measures actual outlined-sheet pixels and checks atlas/manifest extents. No per-effect window growth or sprite rescaling.
- Draw each delivered frame at `(round(worldX-anchor.x), round(136-anchor.y))` using its atlas source rectangle and the manifest item's **`outlined`** sheet (`sprites.outlined.png`; atlas `outlinedImage`). Do not use the plain `path` sheet for default UI rendering. Flips pivot about the anchor. Do not crop/recenter independently per frame or infer body size from the sheet cell.
- Heroes target 48px, accepted 44–52px, as shipped. Some source pixels were already resampled during normalization; integer rules here apply to **these exported assets**, not a claim that every original pack had the same pixel grid.
- No gameplay jumps by default; if a future animation exceeds the measured envelope, reject it in an envelope test or choose an authored compact effect, not a runtime window resize.

### Expanded panel: grow once, do not squeeze it into 160px

Choose **720×400** for the Heroes/Gear/Recruit panel, with an **8px** gap above the core strip. Four rows of text, a useful inventory grid and readable buttons cannot reasonably fit into the 80px effects ceiling.

- Window on open: **W×488** (`400 panel + 8 gap + 80 core`). Bottom edge and all screen-space unit anchors stay fixed. Window top moves up by 328px exactly once; closing restores **W×160** exactly once. Switching tabs does not resize.
- Expanded panel reference rect `(W-728, 0, 720, 400)`; at W=1920 that is `(1192,0,720,400)`. Core origin becomes `(0,408)`, baseline **y=464** (=408+56). Combat effects still use the same fixed 160px region at the window bottom (y=328..487); effects behind the panel are occluded by its opaque backing. Do not make the panel translucent to show effects through text.
- Clamp panel right edge to W-8, with left margin >=8. For W<736, see compact variant below. Never let a panel extend into another monitor or above the selected monitor's work area.
- Minimum available source work-area height is 488. If zoom 2x would violate this, keep combat zoom 1x and open management in a normal, scrollable framed window rather than cutting off controls.
- All sample hero names, level, gold, stats, upgrade prices and formation numbers are illustrative—not game balance data.

## 3. Core strip zones (core-local coordinates; add 80 closed / 408 expanded)

Rectangles are `(x,y,width,height)` with exclusive right/bottom bounds.

| Zone | Rect / rule | Content |
|---|---|---|
| Entire backing | `(0,0,W,80)` | #17212d, 1px steel top rule; quiet original meadow in field only. No scrolling wallpaper. |
| Progress/currency island | `(8,8,280,64)` | Stage heading at (20,13): `GREENWAY / 01-07`; wave at (20,34); coin + gold at (160,33)/(182,34). Wave progress track `(20,59,256,4)`, no floating combat text in this zone. |
| Elastic field | `(304,0,W-608,80)` | Party/enemies, HP and ground. Side gutters separate it from controls. |
| Party positions | field x + field width × **0.32, 0.39, 0.46** | Back line Priest, middle Huntress, front Knight in mockup; actual formation data controls these slots. Anchor baseline **56** core-local (=136 closed,464 expanded). |
| Enemy positions | field x + field width × **0.54, 0.61, 0.68** | Same baseline56 core-local. Front-to-back enemy slots. Mirror only sprites authored facing right. Wide attacks may cross slots, not HUD plates; clip horizontal gameplay drawing to field. |
| HP bars | party `(anchorX-17,-6,34,6)`; enemy `(anchorX-16,-6,32,6)` | Core-local y=-6 gives closed y=74..79 / expanded y=402..407: bars sit immediately above the core so the higher baseline does not put them over heads. Draw them on the full overlay, not a clipped80px subcanvas; their dark backing is allowed in the otherwise transparent ceiling. These sprite-attached bars remain click-through. 1px #0d121b outline; dark track; party green, enemies muted red. No numbers in tiny bars. Numeric HP in panel/tooltip. Never infer side solely from colour: use position and party/enemy labels in inspector. |
| Status/actions island | `(W-288,8,280,64)` | DPS left; green square + `RUNNING` right, 28×22 pause button at `(W-48,12)`. Pause text state `PAUSED`, amber square; don't use colour alone. |
| Management buttons | `(W-280,38,80,28)`, `(W-192,38,80,28)`, `(W-104,38,88,28)` | Heroes / Gear / Recruit, each with 16px Merchant-Shade icon. Recruit = the requested gacha tab, not real-money purchase UI. |

At W=1920 party anchors round to 724,816,908; enemies 1012,1104,1196. Formation tag near field left and optional AUTO BATTLE label at field right are decorative 8px microcopy; hiding them loses no function.

Ground top around core y=48, feet at**56**, ground depth**24**. The unchanged left/right HUD islands still fit; only sprite-attached HP bars move up to avoid heads. Never put terrain or backing in the transparent effects ceiling.

Damage labels: 16px bold, #e9bd68 (damage), #90c99b (healing), **1px #0d121b opaque stroke**; integer motion, max 3 visible labels per target, coalesce hits inside 250ms, 650ms lifetime, rise at most32px, clamp to window y>=8. Crit may use24px but is not a screen flash. Spell samples in the mockups are original spark geometry, not an extracted TBH effect.

## 4. Expanded panel anatomy (720×400)

`mockup-panel.png` is the exact native reference. Page coordinates here are panel-local.

- Outer 9-slice `(0,0,720,400)`. Safe content inset16; header `(8,8,704,28)`.
- `PARTY CAMP` at (16,9), 24px bold. Close `(680,8,28,24)` labelled X; accessible name “Close management”. Status `BATTLE CONTINUES` is decorative; battle really remains running unless explicitly paused.
- Tabs: Heroes `(16,40,104,28)`; Gear `(128,40,96,28)`; Recruit `(232,40,112,28)`; currency at (572,45).
- Shared content body y80..351. Bottom divider y357. Footer y364..391.

### Heroes

- Roster heading y80; scroll viewport `(16,104,392,248)`.
- **4 columns × 3 visible rows**, 88×80 cards, x stride96, y stride84. Cards `(16+96c,104+84r,88,80)`; 12 of18 visible. Wheel scroll is restricted to this viewport; 4px scrollbar at x402. Remaining6 heroes are reachable by scroll and keyboard; never silently omit them.
- Draw delivered idle frame at anchor `(cardX+43, cardY+59)`, native 1x, clip to card interior. Name centred in `(cardX+4,cardY+60,80,16)`; truncate with ellipsis if necessary and expose full name in inspector. Green 6px active square at top-right; selected card has left gold rule, bright backing and text, not colour alone.
- Selected detail `(424,80,280,272)`. Name24px at (440,90). Portrait native2x anchored(487,213), clipped to portrait viewport `(440,112,96,104)`; rare tall aura may be clipped **in this portrait only**, never in combat. Class/level/role at x550. Numeric HP row at(440,223), 248×6 bar y244. ATK/DEF at y262. Equipment heading y288; three32×32 slots at x440/480/520,y304 with 16px icons centred, 1px rarity underline plus written rarity in tooltip.
- Footer: formation text (16,368), contextual hint (208,372), primary Upgrade `(536,364,168,28)`. When gold is insufficient: disabled style, actual cost remains visible, tooltip “Need N more gold”. Clicking a card selects; selecting does not alter active formation. Equip/remove via explicit detail action. Replacing an active hero must name the replaced slot before commit.

### Gear/inventory

- Keep header, tabs, body and footer fixed. Left heading `INVENTORY 24/120`; filter row at y80 has compact `All / Weapon / Armour / Other` selector.
- Left grid starts(16,112): **8 columns × 5 rows** of40×40 slots with8px gaps =>376×232, bottom344. 16px icons can remain1x or use a consistent2x inside 40px slots. Counts16px at lower-right on opaque plate. Never stretch icons to arbitrary sizes.
- Right280×272 inspector at(424,80): item name/rarity, icon48px preview only if 3x integer, equipped comparison with explicit +/− labels; Equip and Salvage actions at footer. Right-click only opens a context menu; never destroys immediately. Salvage equipped/rare gear requires confirmation; avoid accidental double-click salvage.
- Empty inventory: an outlined empty slot + `No gear yet. Defeat a wave.` Selection persists across sorting by stable item ID.

### Recruit (gacha)

- UI title “Recruit”; feature can be called gacha in code. Left area has two banner cards `(16,104,184,224)` and `(208,104,184,224)`, each showing an approved hero frame, banner title, currency type and actual cost.
- Right inspector(424,80,280,272) shows **actual server/game-config odds**, duplicate conversion and pity progress. No invented percentages, “free” claims, fabricated timers or cash-price sample data. Provide a readable scroll area for the full rate table.
- Footer actions: `Recruit x1` `(424,364,132,28)` and `Recruit x10` `(564,364,140,28)`. Deduct only after explicit click and valid funds; disable while result is pending. No auto-recruit, flashing summons, or fake countdown. Reveal results inside this same panel, with Skip and result history; don't resize again.

### Compact widths

- W>=736: 720×400 panel above.
- 608<=W<736: panel width `W-16`, height400; right detail width216, right inset16. Left roster uses3 columns of88×80, x stride96; 8px gutter. Gear grid uses6 columns, scrolls; right inspector moves to `panelWidth-232`. Footer hint hides before any action or price does.
- W<608: keep the160px combat overlay but use an ordinary management window, minimum608×400, within available work area, with its own scrolling content. Do not shrink the font below16px. Control islands: reduce left to200px, right to200px, use three56px icon+short-label buttons, field width `W-432`; hide DPS before gold/stage. For W<640 show only 2 representative enemy sprites with `+N` label; simulation still runs all enemies. Player can opt into a wider monitor.

## 5. Pixel grammar, type and colour

### Fonts

Use **Pixel Operator** (Jayvee Enaguas / HarvettFox96), **CC0**, downloaded and included in `vendor/pixel-operator/` with LICENSE.txt.

- Regular16px: labels, numeric stats, prices, main HUD.
- Bold16px: selected headings, gold, DPS, primary actions.
- PixelOperator8-Bold24px: panel title and selected hero name (native8px bitmap grid at3x). Body PixelOperator16px is its native16px grid at1x.
- PixelOperator8 at8px: optional decorative hints only. Never use this size for costs, outcomes, actions or essential state.
- Font smoothing off in mockups. Production: load local font before drawing, wait for font-ready, rasterize once into a pixel text atlas/offscreen canvas with monochrome alpha threshold; `imageSmoothingEnabled=false` alone does **not** turn off vector-font antialiasing. Browser-rendered fallback must never reflow a frame after its controls are active.
- Font does not guarantee Vietnamese/non-Latin coverage. For future localization choose an appropriate openly licensed readable fallback, remeasure strings and enlarge panels; don't claim current font supports it. The handoff is English.

| Token | Hex | Use |
|---|---|---|
| ink | #0d121b | outer stroke / text stroke / shadow track |
| base | #17212d | strip backing |
| panel | #202c39 | panel fill |
| raised | #293948 | buttons |
| edge | #536276 | steel separator |
| text | #f2e9cf | primary text |
| muted | #b0bcc8 | secondary text; not grey-on-grey low-opacity text |
| gold | #e9bd68 | currency / selected rule / primary emphasis |
| green | #90c99b | friendly HP / healing / active |
| red | #de7c80 | enemy HP / damage alerts |
| blue | #8dbfe3 | information / gear accent |
| purple | #c19cd9 | rarity accent |

Dark iron/navy + restrained brass works with the heroes' warm skin/steel/brown palettes and Merchant-Shade's detailed 16px icons. Don't tint the approved heroes merely to match the UI.

### Sprite readability: explicit light rim

Every hero/enemy sprite, including panel portraits, uses the **delivered baked outlined sheet by default**: load the character manifest's **`outlined`** path (`sprites.outlined.png`), or the atlas's `outlinedImage` filename relative to that atlas. Frame rectangles, sheet dimensions and anchors are identical to the plain sheet. **No runtime dilation, second stroke, extra padding or anchor shift.** Use the atlas's `outlinedContentBounds` / animation `outlinedExtentsFromAnchor` for ink measurements; `contentBounds` still describes the plain sprite.

The authoritative baked rule is **one final-resolution pixel, four cardinal neighbours only**, colour **#e8e4d8 / RGB(232,228,216)**, alpha **204/255 =0.8**. It was applied **after sprite normalization/scaling and priest recolour**, independently inside each atlas cell. A fully transparent pixel receives the stroke only when immediately above/below/left/right of a source pixel whose alpha is at least128. Original pixels, including partial alpha, remain unchanged. No diagonal expansion, blur or drop shadow. Existing2px cell padding contains the1px stroke and retains a transparent guard; no new geometry is needed. At an integer2x display or portrait enlargement, enlarge the baked pixels with nearest sampling; do not rebake or thicken the stroke.

Fallback note only: if an outlined file is genuinely unavailable, reproduce **that exact four-neighbour/alpha-threshold/transparent-only rule** on the plain frame, after normalization and before integer display enlargement, preserving geometry. Do not apply it to an already outlined sheet. The default mockup and production path must use the baked files, not this fallback.

Both wallpaper mockups show the baked rim. The lower band remains opaque on either wallpaper; upper sprite effects carry their baked outline, and floating numbers retain their separate dark text stroke. Essential text never sits directly on the wallpaper. Top steel rule distinguishes the band from a dark desktop; dark ink edging distinguishes it from a light desktop. No theme auto-detection or wallpaper-dependent palette swapping.

### 9-slice construction and states

Derived from Kenney's CC0 **Ancient/grey.png** (48×48), recoloured locally. Shipping samples are in `runtime/`.

- `panel-9slice.png`, all `button*-9slice.png`: source48×48, **8px corners**. Source cuts x/y=0,8,40,48. Corners8×8 are copied without scale; each edge is stretched only on its long axis with nearest sampling; central32×32 stretched to destination interior. Destination minimum16×16; use>=24px for actual controls. Do not scale the whole border.
- 8px frame inset; content normally16px inset. Tiled/scaled edges follow mockup implementation; 9-slice metadata supplied in `runtime/ui-tokens.json`.
- Normal: raised fill, muted brass/steel bevel. Hover: #354a59 with gold text/1px focus edge. Pressed: #182330; label shifts down1px. Disabled: #252b34, text #82909d, no gold rule, do not rely on opacity alone. Selected tab: persistent2px gold bottom rule plus label emphasis. Keyboard focus: 1px #f2e9cf inset ring, independent of hover.
- Tooltip: 240px max width,16px line height,8px padding, ink fill + edge1px. Delay300ms; no movement of the underlying layout. Keep inside work area and away from pointer. Errors are inline text, not silent red flashes.

## 6. Interaction and native hit regions

- Transparent effects ceiling, visible spell pixels, damage numbers, ground and characters are **desktop click-through**, not just CSS pointer-events:none. Only the two HUD islands and the currently open management panel get input. The portrait grid is selectable in the panel, not by clicking the battlefield.
- **Do not mark the entire full-width rectangle interactive.** A fully transparent pixel inside a WebView is not proof that clicks reach another desktop application. This is a native integration acceptance gate.
- Reliable implementation option: an entirely click-through visual surface plus two small native interactive HUD companion windows and an opaque interactive panel companion window, all owned/moved as one overlay group. They must use the exact same screen-space rectangles above. The visual host grows160→488 once for panel composition/shadows on open, and companion panel appears720×400; it restores once on close. No effect creates/moves/resizes a native window. Alternatively a tested native per-region hit-test adapter may expose the same rectangles. **A single whole-window ignore-input flag cannot simultaneously provide clickable HUD and click-through spells.** Use the companion approach if the adapter is unavailable; never scrape input or rely on an untested CSS-only substitute.
- Hover exists only over HUD/panel controls. No hover capture over transparent air. Enable native pointer input over those windows without stealing focus while idle; panel may take focus on the user's click.
- Clicking Heroes/Gear/Recruit opens that tab. Clicking the active strip button again, Close, or Esc collapses. Clicking another tab switches without resizing. Clicking the desktop does not consume the desktop click; do not auto-close through a blocking backdrop. Preserve tab/selection/scroll on reopen.
- Tab/Shift+Tab, arrows within roster, Enter/Space activate, Esc closes, visible focus ring. Hover does not pause combat. Pause is an explicit state. No drag-to-move the full-width overlay; monitor/zoom options live in a standard settings menu, not on the battle scene.
- OS work-area/DPI changes relocate the anchored overlay once and recalculate width; taskbar auto-hide/fullscreen apps need a tested policy (hide overlay on exclusive fullscreen by default). Never resize because of a projectile or damage label.

## 7. DPI, other resolutions and rendering

**Default native-pixel mode stays physically160px tall at all OS DPI settings.** This resolves the conflict between crisp integer pixels and keeping the fixed small overlay. Do not multiply both an OS-scaled window and its backing store by DPR a second time.

| Windows DPI | q | Physical closed/core | WebView CSS closed/core | 1920px physical monitor: CSS width | Panel physical / CSS |
|---|---:|---|---|---|---|
|100% / DPR1|1|160 /80|160 /80|1920|720×400 /720×400|
|125% / DPR1.25|1|160 /80|128 /64|1536|720×400 /576×320|
|150% / DPR1.5|1|160 /80|106.667 /53.333|1280|720×400 /480×266.667|

Canvas backing width/height = physical source dimensions at q=1. Set CSS display size to physical/DPR. Round **physical** window coordinates; fractional CSS DIP above is intentional and must resolve to the exact physical extent. At explicit2x zoom, physical dimensions double (closed320/core160/panel1440×800); source dimensions do not change, and CSS size is physical/DPR. Give this zoom an honest “uses more desktop space” note. If it won't fit, open management in the normal fallback window. Zoom changes are user-driven, not per-effect.

At1366 physical width/q1 use W1366; at2560 use W2560. HUD islands remain anchored; field stretches and units use the proportional anchors. At2x use floor(physicalWidth/2) and fill the at-most1px residual gutter with the strip base, not fractional scaling. Backing canvas is drawn on an integer grid with no fractional camera translation; switch smoothing off after any resize (canvas state resets). Freeze long numbers to short notation such as12.4K with exact value in panel/tooltip rather than pushing buttons sideways.

## 8. Handoff files and verification gates

- `mockup-strip.png` **1920×160 RGBA**: fixed overlay, 80px transparent ceiling and80px opaque band.
- `mockup-panel.png` **720×400 RGBA**: Heroes panel.
- `mockup-strip-light.png`, `mockup-strip-dark.png` **1920×400**: original wallpaper studies + fake48px Windows-style taskbar. Taskbar is illustrative only, never a screenshot to ship.
- `mockup-overview.png` **1920×608**: panel+combat contextual composition. Panel sits8px above the core; it may cover upper VFX by design.
- Every image has a matching `@2x.png`, exact nearest-neighbour enlargement.
- `scripts/build_mockups.py` rebuilds concepts from current `../assets/manifest.json` (no writes into the sprite job). `runtime/` contains derived frame/button PNGs, selected16px item icons, original currency mark, and tokens. `vendor/` preserves third-party originals/licences. `assets-list.md` lists verified commercial-use licences.

Before claiming the app is implemented, test in actual Tauri/Windows (not done by these PNG prototypes):
1. Desktop app receives clicks through empty air **and through visible spell/sprite pixels**; HUD controls still work.
2. Fixed160px host height over every canonical and extra combat frame; no resize callback during effects. Use baseline136 (core-local56; expanded464). Measured baked outlined ink reaches128px above /18px below, fitting y=8..154 exclusive with8px/6px clear margins. Compare actual outlined pixels with atlas/manifest extents; do not add a second stroke. Check future art extents automatically.
3. Open changes height only once to488, close once to160, tabs do not change height; screen-space feet and taskbar stay still.
4. Outline and stroked numbers remain clear over near-white, near-black and busy wallpapers. Every hero/enemy uses the manifest `outlined` path, with no extra runtime stroke. Sprite-attached HP bars at core-local y=-6 remain above heads and click-through.
5. At100/125/150% Windows DPI each exported pixel remains a uniform physical square. Verify monitor transfer and the last residual pixel column.
6. All18 heroes reachable, actual prices/odds shown, insufficient funds handled, controls keyboard reachable, localization fallback explicit.
7. Exclude `ref/`, previews, source archives, script-only font alternates and unused vendor material from the shipped asset bundle. Retain licences for what is actually included.
