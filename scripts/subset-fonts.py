#!/usr/bin/env python3
"""Subset Galmuri to the scripts the game renders or may localize to (Latin, Vietnamese, Cyrillic, punctuation, arrows, shapes).

The OFL-1.1 LICENSE.txt declares no Reserved Font Name, so a subset may keep the Galmuri name.
Usage: python3 scripts/subset-fonts.py /workspace/game-assets/idle-battler/fonts public/fonts
"""
import shutil, sys
from pathlib import Path
from fontTools import subset

RANGES = [(0x20, 0x7E), (0xA0, 0x24F), (0x300, 0x36F), (0x400, 0x52F), (0x1E00, 0x1EFF),
          (0x2000, 0x206F), (0x20A0, 0x20CF), (0x2190, 0x21FF), (0x2500, 0x27BF)]
FILES = ['Galmuri11.ttf', 'Galmuri11-Bold.ttf', 'Galmuri9.ttf']

def main(src: Path, dst: Path) -> None:
    dst.mkdir(parents=True, exist_ok=True)
    unicodes = [code for lo, hi in RANGES for code in range(lo, hi + 1)]
    for name in FILES:
        options = subset.Options()
        options.layout_features = ['*']
        options.name_IDs = ['*']
        options.notdef_outline = True
        font = subset.load_font(str(src / name), options)
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=unicodes)
        subsetter.subset(font)
        subset.save_font(font, str(dst / name), options)
    shutil.copyfile(src / 'LICENSE.txt', dst / 'LICENSE.txt')

if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]))
