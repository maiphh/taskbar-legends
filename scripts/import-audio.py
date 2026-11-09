#!/usr/bin/env python3
"""Import the audio handoff into the game.

Copies every shipped clip (OGG + MP3) from the art handoff into public/audio/, encodes an AAC/M4A copy of the ambient
loop for macOS WebKit (which may not decode Ogg Vorbis), and writes src/audio-manifest.json with only the fields the
runtime needs. Held for v1.4 and not shipped: `crit` (skipped by design) and the `ultimate_*` clips (legendary ultimates).

Usage: python3 scripts/import-audio.py /workspace/game-assets/idle-battler public/audio src/audio-manifest.json
"""
import hashlib, json, shutil, subprocess, sys
from pathlib import Path

SKIP = {'crit'}
HOLD_PREFIXES = ('ultimate_',)

def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main(src: Path, dst: Path, out: Path) -> None:
    manifest = json.loads((src / 'audio/manifest.json').read_text())
    dst.mkdir(parents=True, exist_ok=True)
    clips = []
    for clip in manifest['clips']:
        key = clip['key']
        if key in SKIP or key.startswith(HOLD_PREFIXES):
            continue
        paths = {}
        for fmt in ('ogg', 'mp3'):
            source = src / clip['paths'][fmt]
            shutil.copyfile(source, dst / source.name)
            paths[fmt] = source.name
        entry = {'key': key, 'bus': clip['bus'], 'defaultVolume': clip['defaultVolume'], 'durationMs': clip['durationMs'],
                 'sampleRate': clip['sampleRate'], 'paths': paths, 'sha256': {fmt: sha(dst / name) for fmt, name in paths.items()},
                 'source': {k: clip['source'][k] for k in ('type', 'author', 'licence', 'pack', 'url', 'file') if k in clip['source']}}
        if clip['loop'].get('enabled'):
            entry['loop'] = {'startSample': clip['loop']['startSample'], 'endSample': clip['loop']['endSample']}
            m4a = dst / f'{key}.m4a'
            # AAC from the OGG master; -movflags +faststart keeps the moov atom first for streaming. Priming is measured
            # separately (scripts/measure-aac-offset.ts) and recorded as loop.m4aOffsetSamples.
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(src / clip['paths']['ogg']),
                            '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', str(m4a)], check=True)
            paths['m4a'] = m4a.name
            entry['sha256']['m4a'] = sha(m4a)
        clips.append(entry)
    groups = {k: v for k, v in manifest['groups'].items() if k != 'ultimate'}
    previous = json.loads(out.read_text()) if out.exists() else {}
    result = {'source': 'game-assets/idle-battler/audio/manifest.json', 'sourceSha256': sha(src / 'audio/manifest.json'),
              'defaultVolumes': manifest['defaultVolumes'], 'gainFormula': manifest['gainFormula'], 'groups': groups,
              'skipped': sorted(SKIP), 'heldForV14': sorted(c['key'] for c in manifest['clips'] if c['key'].startswith(HOLD_PREFIXES)),
              'm4aOffsetSamples': previous.get('m4aOffsetSamples', None), 'clips': clips}
    if 'm4aOffsetMeasurement' in previous:
        result['m4aOffsetMeasurement'] = previous['m4aOffsetMeasurement']
    out.write_text(json.dumps(result, indent=2) + '\n')

if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
