# Sprite atlas reference
## Files

`assets/manifest.json` lists 18 heroes, nine enemies, and ten icon sheets. All paths in the manifest are relative to `assets/`. Each character atlas names its plain `sprites.png` with `image` and its baked variant with `outlinedImage`. Manifest `outlined` paths are the default character textures. Icons remain unchanged and have no outlined variant. Character frames form a row-major grid with at most 12 columns.

All characters have a consistent cell size within their own sheet. Different characters have different cell sizes. Each atlas includes all source character animations, including the Medieval Warrior and classic monster update archives. Hit frames use reviewed de-flashed native sources. The raw archive versions remain untouched. Projectile-only sheets remain unmodified under `raw`.

## Frame coordinates and anchors

Each character frame has `x`, `y`, `w`, and `h` for its sheet rectangle. `contentBounds` is the opaque rectangle within the cell, or null for an empty frame. The plain cell has two transparent pixels of padding around the shared trim bounds. The baked outline uses one of those pixels. `outlinedContentBounds` describes the variant, while the original `contentBounds` remains unchanged.

The shared trim bounds are the union of every frame in every exported animation after scaling. `anchor.x` is the median center of the bottom opaque row of idle frames, transformed into the trimmed cell. `anchor.y` is the bottom of the idle union, transformed into the same cell. Flying monsters use a virtual baseline at the lowest idle-flight point. Natural bobbing stays intact.

`anchor` uses pixels relative to the top-left of the cell. `pivot` expresses that same point as a fraction of the cell size. All frames of one character use the same anchor. Drawing a frame at `worldX - anchor.x` and `worldY - anchor.y` puts its feet or virtual baseline at the world position. A horizontal flip around that world position preserves the anchor. Sheet dimensions are not body dimensions.

For an unflipped Canvas 2D draw call, the destination rectangle is `[round(worldX - anchor.x), round(worldY - anchor.y), w, h]`. The source rectangle is `[x, y, w, h]`. The Canvas setting is `imageSmoothingEnabled = false`. The delivered size is the intended logical-pixel size, without an additional runtime character scale. A device-pixel-ratio transform affects only backing resolution.

## Animation tags

`animations.<tag>.frames` contains zero-based indices into the top-level `frames` array. `from` and `to` are inclusive. `aliasOf` names another tag if no unique frames are needed. `durationMs` appears on both each frame and each animation. `extentsFromAnchor` gives the maximum plain ink distance above, below, left, and right of the anchor across that tag. `outlinedExtentsFromAnchor` gives the equivalent bounds for the baked variant.

Suggested idle timing is 140 ms per frame. Run, walk, flight, and move use 90 ms. Hit uses 100 ms, death uses 110 ms, and other tags use 90 ms. These are playback defaults, not verified original timings. Attack, hit, death, opening, transform, and transition tags are one-shot. Idle, movement, jump, and fall tags loop. A one-shot death holds its last frame.

## Runtime hit flash

Shipping sheets contain no baked white or tinted hit flash. This also applies to the compatibility tag `hit-white`. The manifest and atlas metadata expose `runtimeHitFlash` with `color: #ffffff`, `presentationFrames: 2`, and `durationMs: 90`. The alpha channel is preserved. The runtime color timer uses 40 ms plus 50 ms in the review GIFs and does not alter original pose durations.

Hit animations name the corrected native sheet with `source`, retain the archive path as `sourceOriginal`, and declare `deFlashed: true`. All other animations continue to reference raw source art. A legacy `hit-white` tag is now a normal-colored alternative hit sequence, not an instruction to flash.

`docs/deflash-report.json` lists every correction. It records zero-based frame indices and one-based `humanFrame` numbers. `docs/deflash-baseline.json` records the pre-fix layout and frame hashes. Validation compares against the corrected native sources and independently reconstructs each native correction from the raw art. All unrelated frame pixels remain unchanged.

The GIFs are `anim-sheet-heroes-1x.gif`, `anim-sheet-heroes-2x.gif`, `anim-sheet-enemies-1x.gif`, and `anim-sheet-enemies-2x.gif`. The names without a scale suffix remain aliases for the corresponding 2x GIFs. Their first two encoded frames last 40 ms and 50 ms. Hit and death play once and hold. Other rows loop with their atlas pose durations. Each row has the full 160-pixel vertical area, and column widths contain the complete effects.

## Hero height and canonical animation mappings

Native height is the maximum opaque height of an idle frame, with the Evil Wizard 2 aura excluded. Output height is the maximum opaque exported idle-body height. Envelope measurements are also retained in the atlas metadata.

A mapping from `attack` to `attack1` is a default choice among original attacks, not a missing animation. Source names `Take Hit`, `Get Hit`, `Hit`, and `Hurt` all normalize to `hit` without a substitute. The only hero without a source named Run is Evil Wizard. Its Move sequence is the run tag.

| Key | Native height | Nominal scale | Output height | Canonical aliases | Idle/run/attack/hit/death counts |
| --- | ---: | ---: | ---: | --- | --- |
| hero-knight | 51 | 1.000000 | 51 | attack = attack1 | 11, 8, 7, 4, 11 |
| hero-knight-2 | 39 | 1.230769 | 48 | None | 11, 8, 6, 4, 9 |
| medieval-king-pack | 81 | 0.592593 | 48 | attack = attack1 | 6, 8, 6, 4, 11 |
| medieval-king-pack-2 | 54 | 0.888889 | 49 | attack = attack1 | 8, 8, 4, 4, 6 |
| medieval-warrior-pack | 81 | 0.592593 | 48 | attack = attack1 | 6, 8, 4, 3, 9 |
| medieval-warrior-pack-2 | 41 | 1.170732 | 48 | attack = attack1 | 8, 8, 4, 4, 6 |
| medieval-warrior-pack-3 | 38 | 1.263158 | 48 | attack = attack1 | 10, 6, 4, 3, 9 |
| fantasy-warrior | 45 | 1.000000 | 45 | attack = attack1 | 10, 8, 7, 3, 7 |
| martial-hero | 52 | 1.000000 | 52 | attack = attack1 | 8, 8, 6, 4, 6 |
| martial-hero-2 | 56 | 0.857143 | 47 | attack = attack1 | 4, 8, 4, 3, 7 |
| martial-hero-3 | 41 | 1.170732 | 48 | attack = attack1 | 10, 8, 7, 3, 11 |
| huntress | 42 | 1.142857 | 48 | attack = attack1 | 8, 8, 5, 3, 8 |
| huntress-2 | 36 | 1.333333 | 48 | None | 10, 8, 6, 3, 10 |
| wizard-pack | 86 | 0.558140 | 48 | attack = attack1 | 6, 8, 8, 4, 7 |
| priest | 86 | 0.558140 | 48 | attack = attack1 | 6, 8, 8, 4, 7 |
| evil-wizard | 57 | 0.842105 | 48 | run = move | 8, 8, 8, 4, 5 |
| evil-wizard-2 | 53 | 0.905660 | 48 | attack = attack1 | 8, 8, 8, 3, 7 |
| evil-wizard-3 | 53 | 0.905660 | 48 | None | 10, 8, 13, 3, 18 |

## Enemy mappings

Mimic uses the transformed combat idle. Closed, open, opening, and transform sequences remain bonus tags. Flying Eye and Bat have no separate ground idle or run. Their flight sequences supply both canonical tags. Every exported enemy has a real source hit and death sequence.

| Key | Native height | Nominal scale | Output height | Canonical aliases |
| --- | ---: | ---: | ---: | --- |
| fire-worm | 45 | 1.000000 | 45 | run = walk |
| flying-eye | 32 | 1.500000 | 48 | idle = flight, run = flight |
| goblin | 36 | 1.333333 | 48 | None |
| skeleton | 51 | 1.000000 | 51 | run = walk |
| mushroom | 37 | 1.297297 | 48 | None |
| mimic | 30 | 1.500000 | 44 | idle = idletransformed, run = walk, attack = attack1 |
| rat | 20 | 2.500000 | 50 | attack = attackbite |
| slime | 20 | 2.500000 | 49 | run = walk |
| bat | 46 | 1.000000 | 46 | idle = fly, run = fly |

## Source page discrepancies

Source sheet dimensions take precedence over stale page descriptions. Medieval Warrior Pack 2's page lists three hit frames and nine death frames. Its actual sheets contain four hit frames and six death frames. The Medieval Warrior update page lists Roll as two frames. The update sheet contains four 184-by-137 cells. All cells are retained. These are source-documentation mismatches, not failed downloads or invented replacements.

## Icon sheets

The atlas names each nonempty 16-by-16 cell by its zero-based row and column. Empty source cells are not indexed. There is no trim, scale, gutter removal, or color change in shipping icon sheets.

| Pack | Sheet key | Indexed icons |
| --- | --- | ---: |
| 16x16-mixed-rpg-icons | potions | 315 |
| 16x16-mixed-rpg-icons | consumables | 638 |
| 16x16-mixed-rpg-icons | armours | 171 |
| 16x16-mixed-rpg-icons | weapons | 72 |
| 16x16-mixed-rpg-icons | books | 168 |
| 16x16-mixed-rpg-icons | chests | 48 |
| free-16x16-weapon-rpg-icons | iron-weapons | 480 |
| free-16x16-weapon-rpg-icons | steel-weapons | 480 |
| free-16x16-weapon-rpg-icons | bronze-weapons | 480 |
| free-16x16-weapon-rpg-icons | gold-weapons | 480 |

## Licence evidence

All 22 downloaded source packs explicitly declare CC0. Merchant-Shade's metadata identifies the author as Kurt Gabriel Sotelo. Monsters Creatures Fantasy 2 has no licence field in its metadata panel, but its page body explicitly says "CC0 (Creative Commons Zero)". Older packs and icon packs sometimes omit a standalone licence file. The retained page text supplies their licence evidence. There are no conflicting terms in the fetched descriptions or enclosed licence files.

## Validation artifacts

`scripts/verify_assets.py` verifies atlas bounds, canonical tags, anchors, output heights, source checksums, and every output frame against raw non-hit pixels and reviewed de-flashed hit sources after the declared transforms. `docs/validation.json` contains the result. It also verifies that all shipping icon sheets are pixel-identical to the originals. An independent cardinal-neighbour calculation checks every outlined pixel. `docs/readability-baseline.json` retains the earlier outline-pass snapshot. The hit correction intentionally supersedes its old full-sheet hashes. `docs/deflash-baseline.json` now proves that only the reviewed hit frames changed and that all frame rectangles, anchors, counts, and timings remain fixed. The outline pass still leaves the corrected plain art unchanged. The 160-pixel overlay is checked at baseline y = 136.

The one-row overview images are `contact-sheet-heroes.png` and `contact-sheet-enemies.png`. The hero detail views are `contact-sheet-heroes-review-a.png` and `contact-sheet-heroes-review-b.png`. The two detail views contain all 18 heroes at 2x display scale. They do not change the exported sprite scale. `contact-sheet-heroes-outlined.png` and `contact-sheet-enemies-outlined.png` repeat every character on dark and light halves. `contact-sheet-huntress-readability.png` shows before-and-after Huntress close-ups.
