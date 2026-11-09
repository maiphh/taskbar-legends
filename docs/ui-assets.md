# Free commercial-use pixel UI assets

Checked 9 Nov 2026 (Asia/Saigon). Only CC0 assets are used in these mockups. “Free download” alone is not taken as commercial permission. Source evidence is saved under `vendor/` (UI/font) or the existing shared `raw/` (approved art). No Raven Fantasy Icons are used.

## Used: Kenney Pixel UI Pack — panels, buttons, frames, bars

- Author: Kenney Vleugels, with help from Lynn Evers.
- Verified source/mirror: https://opengameart.org/content/pixel-ui-pack-750-assets — **HTTP200** via public requests; text fetch provider separately returned403.
- Verified archive: https://opengameart.org/sites/default/files/PixelUIpack.zip — **HTTP200**, ZIP extracted successfully.
- Page licence field: **“License(s): CC0”**. Description: **“Included are: Panels; Buttons; Cursors/pointers; Bars; Checkmarks; Scrollers”** and **“Separate 9-slice PNG files (30x)”**. Source has750 tile assets.
- Included `License.txt`: **“License (Creative Commons Zero, CC0)”**, **“You may use these graphics in personal and commercial projects.”**, **“Credit (Kenney or www.kenney.nl) would be nice but is not mandatory.”**
- Canonical author asset page `https://kenney.nl/assets/pixel-ui-pack` returned403 to this provider; the verified OpenGameArt upload and its enclosed licence are the evidence actually used. This is not a404 or missing asset.
- Downloaded: `vendor/kenney-pixel-ui.zip`, extracted `vendor/kenney-pixel-ui/`; page snapshot `vendor/oga-source.txt`.
- Used source: `9-Slice/Ancient/grey.png`. Recoloured navy/brass derivatives are `runtime/panel-9slice.png` and `runtime/button*-9slice.png` (48×48,8px corners). The same pack supplies optional bars/cursors/checkmarks without a new licence. The Kenney logo and donation/brand art are **not used**.

## Used: Pixel Operator — readable pixel font

- Author: Jayvee Enaguas / HarvettFox96.
- Verified licence/catalogue page: https://www.fonttoolbox.com/fonts/pixel-operator — **HTTP200**. Quoted label: **“CC0 / Public Domain”**. Page states: **“Full CC0 1.0 Universal legal text is present in LICENSE.txt, confirmed by name table copyright and license description fields explicitly stating Creative Commons Zero 1.0.”**
- Verified public font download: https://dl.dafont.com/dl/?f=pixel_operator — **HTTP200**, actual ZIP, 16 TTFs + LICENSE.txt. The DaFont landing response was empty to this provider, so no licence claim is based on that empty page.
- Definitive downloaded evidence: `vendor/pixel-operator/LICENSE.txt`, headed **“CC0 1.0 Universal”**. TTF copyright metadata independently says **“Released by Jayvee Enaguas (HarvettFox96) ... licensed under a Creative Commons Zero (CC0) 1.0”**.
- Downloaded: `vendor/pixel-operator.zip`, extracted `vendor/pixel-operator/`; evidence snapshot `vendor/pixel-operator-license-page.html`.
- Used: PixelOperator.ttf16px, PixelOperator-Bold.ttf16px, PixelOperator8-Bold.ttf24px, PixelOperator8.ttf8px (decorative only). Commercial embedding/redistribution allowed by CC0; preserve the licence with the shipped font. No attribution obligation, courtesy credit added.
- Not a guaranteed Vietnamese/CJK font. Coverage must be checked before localization.

## Optional alternative: Silkscreen — display pixel font

- Author: Jason Kottke / The Silkscreen Project Authors.
- Verified specimen: https://fonts.google.com/specimen/Silkscreen — **HTTP200**.
- Verified project licence: https://raw.githubusercontent.com/google/fonts/main/ofl/silkscreen/OFL.txt — **HTTP200**; saved `vendor/silkscreen-ofl-source.txt`.
- Quotation: **“This Font Software is licensed under the SIL Open Font License, Version 1.1.”** Also: **“The fonts, including any derivative works, can be bundled, embedded, redistributed and/or sold with any software provided that any reserved names are not used by derivative works.”**
- Good for short headings at8/16px; wider than Pixel Operator, so not the chosen body font. Font file not downloaded or used in mockups. If adopted, bundle OFL.txt, retain copyright, do not sell the font alone, and check naming restrictions when modifying.

## Used: approved project art (not new UI downloads)

### Merchant-Shade / Kurt Gabriel Sotelo — 16×16 equipment and reward icons

- https://merchant-shade.itch.io/16x16-mixed-rpg-icons
- https://merchant-shade.itch.io/free-16x16-weapon-rpg-icons
- Both existing page snapshots load successfully and declare **“Asset license Creative Commons Zero v1.0 Universal”**. Body quote: **“Feel free to use this for your game (commercially or not). Feel free to creatively modify these sprites however you like. No need to give me credit.”**
- Used crops, zero-based16px cells: steel-weapons(c3,r1) sword; armours(c2,r0) armour; chests(c3,r0) reward chest; potions(c2,r1) potion; books(c2,r0) unused candidate cached only. Icons are unchanged crops, not stylistic recreations. Full source/licence evidence remains in `../raw/` and `../LICENSES.md`.
- Gold coin symbol is **original simple pixel geometry**, not a mislabeled consumable icon. No third-party licence attached to that generated mark.

### LuizMelo — approved hero/enemy frames

- https://luizmelo.itch.io/hero-knight (representative source; all pack links in `../LICENSES.md`). Page quote: **“This package can be used freely and commercially - CC0(creative commons zero). Credits are not required but I would appreciate it.”**
- Mockups read `../assets/manifest.json`, each listed atlas and the manifest `outlined` sheet (`sprites.outlined.png`). Priest is the prepared holy-palette Wizard derivative. The baked four-neighbour #e8e4d8/alpha204 stroke is used unchanged, with no runtime stroke. No preview graphics or screenshot crops used as runtime art. Do not ship copyrighted reference imagery as a substitute.

## Packaging and licence cautions

1. CC0 covers included UI/hero/icon sources; retaining licences and courtesy credit is still sensible provenance. No third-party paid asset or free-for-personal-use pack is included.
2. Silkscreen is OFL, **not CC0**; it is an option, not shipped by this concept.
3. Steam screenshots, video thumbnails, wiki screenshots and the Windows-like taskbar studies are **research only**; `ui/ref/` must be excluded from production. Fake taskbar/background geometry is original illustrative material, not a game panel or system asset.
4. Link validation logs and source snapshots are kept, but licences can change for future downloads; the archived versions establish the basis for these copies.
