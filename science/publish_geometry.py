"""Add pinned geometric states to existing sun months, preserving apparent sub-points.

Usage: python science/publish_geometry.py KERNEL_DIR [app/data]
The existing forecast manifest hashes are refreshed only for the changed sun months.
"""
import hashlib
import json
from datetime import datetime, timedelta
from pathlib import Path
import sys

import spiceypy as spice
from observer_appearance import load_kernels, quaternion
from earth_accuracy import FRAME

MODEL = 'CSPICE DE440 / MOON_ME_DE440_ME421; geometric states v1'


def geometric_track(start, count, kernels):
    times = [spice.str2et((datetime.fromisoformat(start) + timedelta(hours=i)).strftime('%Y-%m-%dT%H:%M:%SZ'))
             for i in range(count)]
    # Hermite slopes use SI seconds. Do not silently interpolate across a leap second.
    if any(abs(b-a-3600) > .001 for a, b in zip(times, times[1:])):
        raise ValueError('Geometric track crosses an unsupported leap-second interval')
    return dict(frame=FRAME, origin='MOON', correction='NONE', units='km,km/s',
                interpolation='cubic-Hermite', model=MODEL, kernels=kernels,
                sky=dict(fromFrame='J2000', toFrame=FRAME, interpolation='slerp',
                         quaternionOrder='xyzw',
                         rotations=[quaternion(spice.pxform('J2000', FRAME, et)) for et in times]),
                **{body: [spice.spkezr(body.upper(), et, FRAME, 'NONE', 'MOON')[0].tolist()
                          for et in times] for body in ('sun', 'earth')})


def publish(kernels, data):
    records = load_kernels(kernels)
    data = Path(data)
    index = json.loads((data/'sun.json').read_text())
    manifest_path = data/'forecast-manifest.json'
    manifest = json.loads(manifest_path.read_text())
    for label in index['months']:
        relative = f'sun/{label}.json'
        path = data/relative
        month = json.loads(path.read_text())
        month['geometric'] = geometric_track(month['start'], len(month['subsolarLat']), records)
        path.write_text(json.dumps(month, separators=(',', ':'))+'\n', newline='\n')
        manifest['filesSha256'][relative] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest, indent=2)+'\n')


if __name__ == '__main__':
    publish(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'app/data')
