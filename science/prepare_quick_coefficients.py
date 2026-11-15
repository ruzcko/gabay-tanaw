"""Prepare lossless yearly coefficient packs for the labelled browser estimate.

No ephemeris fitting or resampling: copy complete type-2 records from pinned kernels.
Usage: python science/prepare_quick_coefficients.py --spk PATH --kernels DIR --out DIR
The original kernels stay local. Prepared packs are Tanaw derivatives, not NAIF kernels.
"""
import argparse
import gzip
import hashlib
import json
import re
import struct
from pathlib import Path

import numpy as np
import spiceypy as spice

PINNED = {
    'de440.bsp': 'a4ce9bf9b3282becc9f4b2ac3cebe03a2ae7599981aabd7265fd8482fff7c4b5',
    'moon_pa_de440_200625.bpc': '60cd55aa401ea2ea97360636f567554bfe4e37bb829f901b4460a455dfaf783f',
    'moon_de440_250416.tf': 'a47c71e9c9f33796bdafb2c9d69a7ee447b6016ecad80f71cd6f3e479f9cf768',
    'naif0012.tls': '678e32bdb5a744117a467cd9601cd6b373f0e9bc9bbde1371d5eee39600a039b',
}
FIRST_YEAR, LAST_YEAR = 1969, 2100


def read_segments(raw):
    if raw[88:96] != b'LTL-IEEE':
        raise ValueError('Requires the pinned little-endian DAF')
    nd, ni = struct.unpack_from('<ii', raw, 8)
    if nd != 2 or ni not in (5, 6):
        raise ValueError('Unexpected DAF descriptor')
    record = struct.unpack_from('<i', raw, 76)[0]
    result = {}
    while record:
        base = (record - 1) * 1024
        following, _, count = struct.unpack_from('<3d', raw, base)
        for i in range(int(count)):
            pos = base + 24 + i * (nd + (ni + 1) // 2) * 8
            ints = struct.unpack_from(f'<{ni}i', raw, pos + nd * 8)
            code = ints[0]
            if code not in (3, 10, 301, 399, 31008):
                continue
            if (ni == 6 and ints[2:4] != (1, 2)) or (ni == 5 and ints[1:3] != (1, 2)):
                raise ValueError('Only J2000 type-2 coefficients are supported')
            first, last = ints[-2:]
            init, step, size, n = struct.unpack_from('<4d', raw, (last - 4) * 8)
            rows = np.frombuffer(raw, dtype='<f8', count=int(size * n), offset=(first - 1) * 8)
            result.setdefault(code, []).append((init, step, rows.reshape(int(n), int(size))))
        record = int(following)
    return result


def slice_series(parts, a, b):
    selected = []
    for init, step, rows in parts:
        left = max(0, int(np.floor((a - init) / step)))
        right = min(len(rows), int(np.floor((b - init) / step)) + 1)
        if left < right:
            selected.append((step, rows[left:right]))
    if not selected or len({p[0] for p in selected}) != 1:
        raise ValueError('Missing or inconsistent coefficient coverage')
    step = selected[0][0]
    rows = np.concatenate([p[1] for p in selected])
    init = rows[0, 0] - rows[0, 1]
    if init > a or rows[-1, 0] + rows[-1, 1] < b or not np.all(np.diff(rows[:, 0]) == step):
        raise ValueError('Coefficient coverage gap')
    return init, step, rows


def prepare(spk, kernels, out):
    paths = [Path(spk)] + [Path(kernels) / name for name in PINNED if name != 'de440.bsp']
    series = {}
    for path in paths:
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != PINNED[path.name]:
            raise ValueError(f'Pinned source changed: {path.name}')
        spice.furnsh(str(path))
        if path.suffix in ('.bsp', '.bpc'):
            series.update(read_segments(raw))
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    if any(p.name != 'manifest.json' and not re.fullmatch(r'\d{4}\.bin\.gz', p.name)
           or not p.is_file() for p in out.iterdir()):
        raise ValueError('Output directory contains files other than generated coefficient assets')
    manifest = {'version': 1, 'model': 'Tanaw-DE440-ME421-v1',
                'preparedBy': 'Team Gabay / Tanaw; lossless coefficient extraction',
                'sourceCredit': 'NASA/JPL-Caltech ephemerides and NAIF lunar orientation',
                'sourceSha256': PINNED, 'start': f'{FIRST_YEAR}-01-01T00:00:00Z',
                'end': f'{LAST_YEAR + 1}-01-01T00:00:00Z', 'years': {}}
    for year in range(FIRST_YEAR, LAST_YEAR + 1):
        a = spice.str2et(f'{year}-01-01T00:00:00') - 1200
        b = spice.str2et(f'{year + 1}-01-01T00:00:00') + 1200
        values = [np.array([1, 5], dtype='<f8')]
        for code in (3, 10, 301, 399, 31008):
            init, step, rows = slice_series(series[code], a, b)
            values += [np.array([code, init, step, rows.shape[1], len(rows)], dtype='<f8'), rows.ravel()]
        raw = np.concatenate(values).astype('<f8').tobytes()
        packed = gzip.compress(raw, compresslevel=9, mtime=0)
        (out / f'{year}.bin.gz').write_bytes(packed)
        manifest['years'][str(year)] = {'sha256': hashlib.sha256(raw).hexdigest(),
                                        'bytes': len(packed), 'decodedBytes': len(raw)}
    # Prune obsolete generated years only after every requested year succeeds.
    for path in out.glob('*.bin.gz'):
        if path.name.removesuffix('.bin.gz') not in manifest['years']:
            path.unlink()
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f"Prepared {len(manifest['years'])} years: {sum(y['bytes'] for y in manifest['years'].values()):,} bytes")


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--spk', required=True)
    p.add_argument('--kernels', required=True)
    p.add_argument('--out', required=True)
    args = p.parse_args()
    prepare(args.spk, args.kernels, args.out)
