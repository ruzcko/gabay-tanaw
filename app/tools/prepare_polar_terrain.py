"""Tile NASA LDEM_875S_20M without changing its signed half-metre samples.
Usage: python app/tools/prepare_polar_terrain.py .terrain-raw/ldem_875s_20m.img
Standard library only; asset preparation is not an application build step.
"""
import gzip
import hashlib
import json
import pathlib
import sys

source = pathlib.Path(sys.argv[1])
raw = source.read_bytes()
n, side = 7584, 512
if len(raw) != n * n * 2:
    raise ValueError('Expected the 7584 x 7584 signed int16 NASA product')
target = pathlib.Path(__file__).resolve().parents[1] / 'assets/observer/terrain/polar20'
target.mkdir(parents=True, exist_ok=True)
for row in range(0, n, side):
    for col in range(0, n, side):
        tile = bytearray(side * side * 2)
        for y in range(side):
            start = (min(row+y, n-1)*n+col)*2
            count = min(side, n-col)
            line = raw[start:start+count*2]
            line += line[-2:]*(side-count)
            tile[y*side*2:(y+1)*side*2] = line
        (target / f'{row//side}-{col//side}.bin.gz').write_bytes(gzip.compress(tile, compresslevel=9, mtime=0))
manifest = dict(product='LDEM_875S_20M', version='2.0', width=n, tileSize=side,
    spacingM=20, scaleM=0.5, encoding='int16-le', radiusM=1737400,
    projection='south-polar-stereographic', centerPixel=3791.5,
    frame='MEAN EARTH/POLAR AXIS OF DE421', coverageLatitudeMax=-87.5,
    source='https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_875s_20m.lbl',
    sourceSha256=hashlib.sha256(raw).hexdigest(), license='NASA public-domain data; credit NASA/GSFC/LOLA')
(target / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
print(f'Prepared 225 tiles: {sum(p.stat().st_size for p in target.glob("*.gz")):,} bytes')
