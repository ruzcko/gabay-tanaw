"""Generate direct CSPICE fixtures for the browser's published lighting adapter.

python science/test/check_published_geometry.py KERNEL_DIR OUTPUT_JSON
This compares implementations of pinned DE440, not measured terrain illumination.
"""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from observer_appearance import appearance, load_kernels


def main(kernels, output):
    root = Path(__file__).resolve().parents[2]
    pins = load_kernels(kernels)
    times = [f'{year}-{month:02d}-15T13:37:00Z'
             for year, month in [(2026, 12), *[(2027, m) for m in range(1, 12)]]]
    times += ['2027-03-19T01:08:00Z', '2027-03-19T01:00:00Z',
              '2026-12-31T23:59:00Z', '2027-01-01T00:00:00Z']
    rows = []
    for sid in ('apollo-17', 'shackleton-rim', 'change-4'):
        path = root/f'app/data/forecast/{sid}.json'
        f = json.loads(path.read_text())
        s = f['science']
        site = dict(latitudeDeg=f['lat'], longitudeEastDeg=f['lon'],
                    surfaceElevationM=s['surfaceElevationM'], observerHeightM=s['observerHeightM'])
        for utc in times:
            a = appearance(site, utc)
            rows.append(dict(id=sid, instantUtc=utc, lighting=a['lighting'], overview=a['overview'], sky=a['sky']))
    Path(output).write_text(json.dumps(dict(source='Direct CSPICE geometric NONE; DE440 / ME421',
                                         kernels=pins, rows=rows), indent=2)+'\n')


if __name__ == '__main__':
    main(*sys.argv[1:])
