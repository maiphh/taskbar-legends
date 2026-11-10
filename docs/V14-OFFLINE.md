# v1.4 M3: offline Expedition Chests, offline tickets, gacha reveal, welcome-back, audio

## Rules (opt-in, not saved)

`expeditionChests` (CR-14-04) and `offlineTickets` (CR-14-05) join the v14 rule list: `--v14 all` (sim), `?v14=all` (URL),
`__game.setV14Rules([...])`, `--rules all` (`scripts/v14-targets.ts`, now the default). With them off `CONFIG.v14.offline`
is `{ expeditionChestsPerHour 0, expeditionBestOf 1, expeditionChestMax 0, ticketRateVsOnline 0 }`. Offline reward math
is unchanged with the rules off; the 1.4.1 first-clear ticket table (option A) still makes the rules-off golden and
25-seed aggregate differ from 1.3.0.

## Expedition Chests (design.md §14.3, keys `v14.offline`, `v14.gearPity.rollUnits.expeditionChest`)

- Count `floor(min(t, 8 h) × 2 / h)`, so at most 16. They replace the 1.3.0 offline chest count while the rule is on.
- Each is the best of 4 chest-rarity rolls (Legendary 3.94 %, Epic+ ≈ 34 %, Rare+ ≈ 87 %, checked over 1M chests) and counts
  4 Fortune units.
- With `chestChoice` on and the drop stage ≥ `fromStage`, each goes to the pick-1-of-2 queue (both options best-of-4; option B 0
  units). The queue keeps ≤ 3; a 4th auto-resolves the oldest by score (1.3.0 queue rule), so most of a 16-chest return resolves itself.

## Offline tickets (CR-14-05, key `v14.offline.ticketRateVsOnline` 0.5)

- `owed = seconds / avgWallFarmClearSec × farmTicketChance × 0.5 + offlineTicketFrac`; the floor is granted, the fraction is kept
  in the optional save field `offlineTicketFrac` (0 ≤ x < 1). A `tickets` event is emitted only for a whole amount > 0.
- `avgWallFarmClearSec` is the mean of `metrics.farmClearSeconds` (wall time per farm clear), falling back to `idle.avgFarmClearSecDefault`.

## Gacha reveal (ui/gacha.md, ui/rarity-drops.md, ui.md §11, `rarityDrop` tokens)

- 1-pull: anticipation (rim per tier), flip (48/0/48/96 px), Epic+ silhouette, burst with motes, then the card. Tier totals 1000 /
  1280 / 1600 / 2000 ms. Legendary: one 80 ms flash through the shared limiter (≥ 400 ms apart, ≤ 2 per s) and shake [1,−1,1,−1,0].
- 10-pull: card i flips at 120 + i × 120 ms; +400 ms hold after the highest Epic+ card; then badges and the tally.
- Skip (click/Enter/Space after 120 ms) snaps to the end state. Reduced motion shows the end state at once.
- Pity pulls show a `PITY` tag and play `gacha_pity`; Legendary plays `gacha_legendary_sting` (falls back to `gacha_reveal_legendary`).
- No legendary drop beam and no ultimates (PR 5).
- Hotspots: `reveal-skip`, `reveal-again`, `reveal-ok`.

## Welcome back (ui/offline-rewards.md)

- Shown on restore when the away time earned anything. It shows time away, a capped note when raw time > the 8 h cap, gold count-up,
  levels `before → after` per hero, Expedition Chests (16-slot strip, best rarity), offline tickets, and pending choices.
- Hotspots `welcome-collect`, `welcome-close`. 1.3.0 (rules off) shows the same panel without the Expedition and ticket rows.

## Audio (docs/audio.md, audio/manifest.json)

- Buses music 0.5, sfx 0.3, ui 0.6, gacha 0.5; gain = master (volume, 0 when muted) × bus × clip `defaultVolume`.
- Variant groups pick a random variant with no immediate repeat, with rate jitter, `minIntervalMs` and `maxVoices`.
  Cues: hit (enemy hits), enemy/hero death, coin (kill gold), stage_clear (first clears), boss_warning, gacha_pull/reveal/pity/sting,
  drop_pop (gear and tickets), ui_click/open/close. `crit` is skipped (no crit event). Cues only play for events in the last
  20 ticks, so loading or restoring a save does not replay a backlog.
- Unlocks on the first pointer/key gesture. Mute and volume persist in `localStorage['taskbar-legends:audio']`. Controls
  `sound-toggle`, `volume-down`, `volume-up` sit in the management tab row.
- Ambient loop: the OGG loops samples 0–2,304,000 (48 s at 48 kHz). If OGG can't be decoded, an M4A/AAC copy is used for the loop (WebKit),
  with MP3 as the last fallback. loopStart/loopEnd are shifted by the measured priming offset (`PRIMING_OFFSETS`).

### Priming offset (`npm run measure:aac` → shots/aac-offset.json, Playwright)

| Engine | OGG | M4A (AAC, edit list) | MP3 |
|---|---|---|---|
| Chromium 156.0.8078.47 | 0 | 0 | 0 |
| WebKit 27.2 | 0 (length +1) | 0 | 1105 (length +1152, canPlayType "maybe") |

The M4A has an edit list, so both engines trim the 1024-sample AAC priming; a control encode without it decoded with a 1024 offset in both.
Playwright Linux WebKit decodes OGG, so it uses OGG there; Safari on macOS takes the M4A path.

Credits: CREDITS.md (Audio) and LICENSES/README.md.
