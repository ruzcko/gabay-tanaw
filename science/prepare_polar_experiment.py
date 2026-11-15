"""Lossless private experiment tiles; never installs assets in the app.

python science/prepare_polar_experiment.py --raw RAW --out out/matched-polar/tiles
Existing sources/licences: science/README.md and app/SOURCES.md. No new dataset.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
TILE = 256


def export_grid(out, name, pixels, left, top, spacing, scale, source_hash):
    folder = out / name
    folder.mkdir(parents=True, exist_ok=True)
    rows, cols = pixels.shape
    grid = dict(id=name, width=cols, height=rows, left=left, top=top,
                spacingM=spacing, scale=scale, dtype=pixels.dtype.str,
                sourceSha256=source_hash, tiles={})
    for r in range(0, rows, TILE):
        for c in range(0, cols, TILE):
            chunk = np.zeros((TILE, TILE), dtype=pixels.dtype)
            part = pixels[r:r+TILE, c:c+TILE]
            chunk[:part.shape[0], :part.shape[1]] = part
            raw = chunk.tobytes()
            packed = gzip.compress(raw, compresslevel=6, mtime=0)
            key = f"{r//TILE}-{c//TILE}"
            (folder / f"{key}.bin.gz").write_bytes(packed)
            grid['tiles'][key] = dict(bytes=len(packed), sha256=hashlib.sha256(raw).hexdigest())
    return grid


def main():
    import rasterio
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if (ROOT/'app') in args.out.resolve().parents or args.out.resolve() == ROOT/'app':
        parser.error('Experiment output must remain outside app/')
    pins = json.loads((ROOT/'app/computation/polar-accuracy.json').read_text())['terrainReferenceInputs']
    grids = []
    for pin in pins:
        path = args.raw / (pin['file'] if pin['file'].endswith('.img') else 'pgda_5mpp/'+pin['file'])
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != pin['sha256']:
            raise ValueError(f"Unreviewed source bytes: {path.name}")
        if path.suffix == '.img':
            pixels = np.fromfile(path, dtype='<i2').reshape(3812, 3812)
            grids.append(export_grid(args.out, 'lola240', pixels, -457440, 457440, 240, .5, digest))
        else:
            with rasterio.open(path) as src:
                if src.dtypes != ('float32',) or src.res != (5., 5.) or src.transform.b or src.transform.d:
                    raise ValueError(f"Unexpected fine raster layout: {path.name}")
                grids.append(export_grid(args.out, path.stem, src.read(1).astype('<f4'),
                                         src.bounds.left, src.bounds.top, 5, 1, digest))
        print(path.name, sum(t['bytes'] for t in grids[-1]['tiles'].values()), flush=True)
    manifest = dict(format='Tanaw-polar-experiment-v1', frame='MOON_ME_DE421',
                    datum='sphere-1737400m', radiusM=1737400, tileSize=TILE, grids=grids)
    (args.out/'manifest.json').write_text(json.dumps(manifest, separators=(',', ':'))+'\n')
    print('Packed tile bytes:', sum(t['bytes'] for g in grids for t in g['tiles'].values()))


if __name__ == '__main__':
    main()
