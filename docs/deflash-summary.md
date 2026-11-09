# Hit flash corrections
All frame numbers below are zero-based. Frame 1 means the second frame.
| Character | Tag | Frame | Correction |
| --- | --- | ---: | --- |
| hero-knight | hit | 1 | palette-transfer, preserve flashed alpha from hit frame 0; 2 nearest-color edge pixels |
| hero-knight-2 | hit | 1 | palette-transfer, preserve flashed alpha from hit frame 2; 1 nearest-color edge pixels |
| medieval-king-pack-2 | hit-white | 1 | palette-transfer, preserve flashed alpha from hit frame 1; 1 nearest-color edge pixels |
| medieval-warrior-pack-2 | hit-white | 1 | palette-transfer, preserve flashed alpha from hit frame 1 |
| martial-hero | hit-white | 1 | palette-transfer, preserve flashed alpha from hit frame 1 |
| evil-wizard | hit | 1 | nearest normal pose; original colors and exact pose unrecoverable from hit frame 2 |
| flying-eye | hit | 1 | palette-transfer, preserve flashed alpha from attack frame 0; 12 nearest-color edge pixels |
| goblin | hit | 1 | palette-transfer, preserve flashed alpha from hit frame 0 |
| goblin | hit | 2 | remove detached pure-white impact particles; body and blade unchanged |
| goblin | hit | 3 | remove detached pure-white impact particles; body and blade unchanged |
| skeleton | hit | 1 | palette-transfer, preserve flashed alpha from hit frame 0; 1 nearest-color edge pixels |
| mushroom | hit | 1 | palette-transfer, preserve flashed alpha from hit frame 0 |

## Uncertainty
- Evil Wizard hit frame 1 is a destroyed-color silhouette with no close exact normal pose. Replaced by the following normal-colored hit frame 2.
- Flying Eye and near-identical silhouette matches require a few nearest-palette pixel estimates; their original alpha poses are preserved.
- Goblin hit frames 2 and 3 contain detached white impact sparks rather than a body tint. Removed conservatively so runtime flash is the only baked-free hit cue.

## Unchanged characters
No baked flash was found in the other hit sequences, including the priest recolor. Normal bright cloth and highlights remain. No tinted or partial-body flash was confirmed.
