# Art direction for the taskbar battler

## A 48-pixel body suits the strip

The target is **48 pixels from the top of the idle body to the feet**. The accepted range is 44 to 52 pixels. The game uses a fixed 160-pixel transparent overlay. The bottom 80 pixels contain the HUD strip, and effects can extend into the upper 80 pixels. A baseline at y = 136 keeps the idle bodies in the lower strip and leaves room for the complete effects.

The original heroes use different drawing scales. Their maximum idle silhouettes measure 36 to 86 pixels, except Evil Wizard 2's overhead aura. That aura reaches 104 pixels across the idle cycle. Its actual hood-to-feet body measures 53 pixels. Widths such as the advertised 26 pixels are not heights.

The exporter keeps an integer or half-integer scale if it falls within four pixels of the target. Otherwise it uses 48 divided by the maximum opaque idle-frame height. Only Hero Knight, Fantasy Warrior, and Martial Hero retain their native 1x scale. The other heroes need non-integer scales to avoid large height differences. Every frame uses nearest-neighbour sampling. The plain sheets have no smoothing, palette quantization, or per-frame recentering. A separate baked outline variant adds contrast without changing the source pixels.

Rounding the complete source frame to whole pixels makes the effective horizontal and vertical scales differ slightly. Both effective scales are in the manifest. The final body height is measured from the exported pixels, rather than inferred from the nominal scale. Most heroes reach 48 pixels. The largest accepted hero is Martial Hero at 52 pixels.

Evil Wizard 2 uses the source region at y >= 114 for its body-height measurement. The hood starts at that row. The exported sprite keeps the complete aura and all attack effects.

## The original pixel grids remain visible

All heroes and enemies come from LuizMelo. They share side-view poses, strong silhouettes, and hand-drawn attack arcs. The older King, Warrior, and Wizard have narrower proportions after downscaling. Hero Knight 2 has a larger head. These differences do not disappear through height normalization.

Nearest-neighbour scaling preserves hard pixel edges but cannot preserve one uniform pixel size across art drawn at different native scales. The large old packs lose some fine details. The smaller packs have repeated pixel columns after enlargement. This is the cost of equal body heights without repainting the roster.

The green and brown Huntress is darker on the background than the silver knights. Evil Wizard uses saturated red and gold. Evil Wizard 2 has a purple aura almost twice the body height. Those outliers are intentional source palettes, not accidental tint changes.

## The priest has a separate holy palette

The priest uses every Wizard Pack animation with the same geometry and alpha channel. Exact RGB substitutions turn violet cloth into ivory and pale blue. Dark blue-grey replaces the deepest violet shadows. Gold replaces the burgundy accent. Skin, wooden staff, and most leather colors stay unchanged. Cyan spell colors stay cyan.

The exact nine-color map is in [priest-palette.json](priest-palette.json). The source and recolored sheets remain separate assets.

## A fixed 160-pixel overlay contains the full effects

The exporter does not cut off attacks, jumping poses, weapons, or death frames. All frames of a character share one trimmed cell and one fixed anchor. This can make the cell much taller or wider than the idle body.

The overlay is 160 pixels tall. Its HUD occupies y = 80 through 159, while effects can draw above the HUD. With the baked outline, all animation ink reaches at most 128 pixels above the baseline and 18 pixels below it. A baseline at y = 136 leaves eight pixels above the highest effect and six pixels below the lowest frame. The complete set fits without vertical clipping or temporary window expansion. Frame cells include transparent padding, which is not visible ink.

The manifest and each animation tag include plain and outlined extents from the anchor. The old 64-to-96-pixel window warning is superseded by the fixed 160-pixel layout.

## A one-pixel outline separates sprites from wallpaper

The baked variant is the default for all 18 heroes and nine enemies, including every bonus animation and effect frame. Each `sprites.outlined.png` uses the same frame rectangles, dimensions, and anchors as its adjacent plain `sprites.png`. The manifest exposes its path as `outlined`. The atlas exposes the filename as `outlinedImage`.

The stroke is one final-resolution pixel wide and uses four cardinal neighbours, not diagonals. A pixel joins the stroke if it is fully transparent and directly above, below, left, or right of a source pixel with alpha at least 128. The color is `#e8e4d8` at alpha 204 out of 255, or 80 percent. Original pixels, including partially transparent pixels, stay unchanged. The rule applies after scale and priest recolor, separately within each cell.

Four-neighbour expansion avoids the heavier diagonal corners of an eight-neighbour stroke. It outlines narrow weapons, detached sparks, and transparent gaps as well as bodies. Thin isolated effects can look brighter, but every character uses the same rule. No drop shadow or character-specific exception is baked.

The existing two-pixel cell padding already contains the one-pixel stroke and leaves one transparent pixel at the edge. No extra padding, atlas coordinate change, or anchor shift is needed. `contentBounds` remains the plain bound. `outlinedContentBounds` records the added stroke. Both the manifest and animation tags include outlined extents.

The developer can instead apply this exact outline rule at runtime to the plain sheets. Runtime rendering must not also outline the baked variant, or the stroke doubles. Baked outlines are the default because their final-resolution pixel width is predictable and needs no per-frame image processing.

The dark and light halves of `contact-sheet-heroes-outlined.png` repeat all 18 heroes on `#14141a` and `#d8dce4`. Huntress now has a visible perimeter on the dark half. Her original dark body supplies contrast on the light half, where the pale stroke is naturally subtle. `contact-sheet-huntress-readability.png` compares both Huntresses before and after the pass. Both sheets and the enemy comparison were opened for visual review.

The rat and slime become broad at the common height. The slime's attack can reach 281 pixels in cell width. The bat's first flying frame has folded wings and looks small. Its complete flying cycle reaches the target height range. Matching heights does not give these monsters equal body mass.

## Hit sprites have no baked flash

Every shipping hit frame has normal character colors, including the legacy `hit-white` bonus tags. The legacy names remain for compatibility, but their images no longer contain a white flash. Normal white clothing, eyes, metal highlights, and spell colors are not hit flashes. The priest retains its ivory clothing throughout the hit pose sequence.

The runtime applies one uniform pure-white silhouette at the start of a hit event. The flash lasts two presentation frames, 40 ms and 50 ms, for 90 ms total. The RGB becomes `#ffffff` while the alpha channel stays unchanged. The color timer is independent of sprite-pose timing. Atlas frame counts and `durationMs` values do not change, so the first two preview samples can show the same source pose. Normal colors return at 90 ms even if that pose has not advanced yet.

All 27 characters and 30 hit tags were audited using native color histograms, mean luminance, bright-grey pixel fraction, and palette comparison against non-hit animations. Each hit pose was also viewed. Ten fully flashed frames were found. No additional tinted or partially recolored body flashes were found. Goblin also had detached white impact sparks in two later frames. Those sparks were removed so the runtime flash supplies the only transient white hit cue.

Most flashed poses retain their exact alpha mask. Their normal colors come from a matching non-flash pose at the same pixel coordinates. A few unmatched edge pixels use the nearest normal-palette pixel. Evil Wizard has no close matching normal pose, so its flashed second frame uses the following normal-colored hit pose. That is the only full-pose substitution.

Raw downloads remain unchanged. Reviewed native corrections are stored in `processed/deflashed`. The build applies those corrections before nearest-neighbour export, priest recolor, and the readability outline. The published atlas rectangles, anchors, animation tags, frame counts, and timings stay fixed. Only the corrected hit-frame pixels and their actual ink bounds change.

The complete frame-by-frame record is [deflash-report.json](deflash-report.json). The before and after histogram audits are `hit-flash-audit-before.json` and `hit-flash-audit-after.json`. The animation GIFs simulate the runtime timer rather than storing the flash in the sheets.

## The schema avoids animation-specific alignment

Character keys use the requested lowercase hyphenated pack slug. The derived recolor is `priest`. Enemy keys name the creature. Every character has `sprites.png`, `sprites.outlined.png`, and `atlas.json` in its own directory.

Canonical tags are `idle`, `run`, `attack`, `hit`, and `death`. Extra tags keep normalized source names such as `attack2`, `jump`, `fall`, `dash`, `run2`, `idletransformed`, and `hit-white`. Spaces, underscores, and hyphens are removed from source animation names. Hit aliases become `hit`.

Icons keep their 16-by-16 source grid. Their keys use the sheet name plus zero-based row and column, such as `potions-r00-c00`. These are coordinate identifiers, not inferred item names. Irregular Pixelquest monthly bonus sheets and projectile-only character sheets remain in `raw` and are not in the shipping manifest.

The exact measurements, animation mappings, frame counts, timing defaults, and coordinate fields are in [atlas-reference.md](atlas-reference.md). Licence quotations are in [LICENSES.md](../LICENSES.md), with courtesy attribution in [CREDITS.md](../CREDITS.md).
