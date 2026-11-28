# v1.4 M3: offline Expedition Chests, offline tickets, gacha reveal, welcome-back, audio

## Rules (on by default from 1.4.2, not saved)

`expeditionChests` (CR-14-04) and `offlineTickets` (CR-14-05) join the v14 rule list. From 1.4.2 the six rules are on
by default in the game and `npm run sim`. Opt out with `?v14=none` or `--v14 none`. With them off `CONFIG.v14.offline`
is `{ expeditionChestsPerHour 0, expeditionBestOf 1, expeditionChestMax 0, ticketRateVsOnline 0 }`. 1.4.2 also lowers
`rewards.farmTicketChance` to 0.005 (top-level), so the rules-off golden is `V142_RULES_OFF_GOLDEN` (`6b332874…`).

## Expedition Chests (design.md §14.3, keys `v14.offline`, `v14.gearPity.rollUnits.expeditionChest`)

- Count `floor(min(t, 8 h) × 3.5 / h)`, so at most 28 (1.4.2). They replace the 1.3.0 offline chest count while the rule is on.
- Each is the best of 4 chest-rarity rolls (Legendary 3.94 %, Epic+ ≈ 34 %, Rare+ ≈ 87 %, checked over 1M chests) and counts
  4 Fortune units.
- With `chestChoice` on and the drop stage ≥ `fromStage`, each goes to the pick-1-of-2 queue (both options best-of-4; option B 0
  units). The queue keeps ≤ 3; a 4th auto-resolves the oldest by score (1.3.0 queue rule), so most of a 28-chest return resolves itself.

## Offline tickets (CR-14-05, key `v14.offline.ticketRateVsOnline` 0.5)

- `owed = seconds / avgWallFarmClearSec × farmTicketChance × 0.5 + offlineTicketFrac`; the floor is granted, the fraction is kept
  in the optional save field `offlineTicketFrac` (0 ≤ x < 1). A `tickets` event is emitted only for a whole amount > 0.
- `avgWallFarmClearSec` is the mean of `metrics.farmClearSeconds` (wall time per farm clear), falling back to `idle.avgFarmClearSecDefault`.

## Gacha reveal

The Summoning Hall charges in warm white for 1.48 seconds. The runes light in sequence. A beam then holds the best rarity in the pull for one second. Common gives a dim grey-white, rare blue, epic purple and legendary gold. Some legendary pulls first show blue or purple for an extra 0.60 seconds before turning gold. The ordered hero IDs and the pull index determine the upgrade.

| Pull | From click to result |
| --- | --- |
| One common or rare | 3.20 or 3.32 s |
| One epic | 4.76 s |
| One legendary | 5.36 s, or 5.96 s with an upgrade |
| Ten heroes | 9.36–11.96 s, depending on the cards and the upgrade |

For one ticket, the doors part around a rarity-tinted silhouette. Epic and legendary silhouettes hold longer before the burst. For ten tickets, ten cards fly from the gate and land face down with colored rims. They flip in pull order with an extra pause before each epic or legendary. The summary lists new heroes, duplicates and pity.

Tap the stage or use **Skip reveal** at any point to show the same results. Enter and Space also activate Skip. Reduced motion and frozen animations open directly on still results. The legendary burst uses the existing flash limiter (at most two flashes per rolling second, at least 400 ms apart). The first highest-rarity card plays the burst cue. Legendary uses the sting, other pity pulls use the pity cue.

See the [illustrated walkthrough](../.grok-run/gacha-v2/w-gacha-v2.md).

## Welcome back (ui/offline-rewards.md)

- Shown on restore when the away time earned anything. It shows time away, a capped note when raw time > the 8 h cap, gold count-up,
  levels `before → after` per hero, Expedition Chests (28-slot grid at 14×2, 26 px, stride 29; shorter 60 ms stagger over 16 chests), offline tickets, and pending choices.
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
