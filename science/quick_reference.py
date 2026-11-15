"""Generate independent CSPICE reference fixtures for browser coefficient/geometry tests.

Run with --kernels DIR --spk PATH --out PATH. Does not touch published forecasts.
CN+S is used as a cross-check; browser relativistic/deflection terms differ slightly.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import spiceypy as spice


def main(kernels, spk, out, manifest):
    coverage = json.loads(Path(manifest).read_text(encoding='utf-8'))
    first, last = min(map(int, coverage['years'])), max(map(int, coverage['years']))
    sources = [Path(spk)] + [Path(kernels) / n for n in
        ('naif0012.tls', 'moon_pa_de440_200625.bpc', 'moon_de440_250416.tf')]
    for p in sources:
        spice.furnsh(str(p))
    rows = []
    for lat, lon, ground in [(0., 0., 0.), (0.67416, 23.47314, -1926.567),
                             (-89.4398, 222.83, 1958.503), (45., 170., 4000.)]:
        p, l = np.radians([lat, lon])
        up = np.array([np.cos(p)*np.cos(l), np.cos(p)*np.sin(l), np.sin(p)])
        basis = np.array([[-np.sin(l), np.cos(l), 0.],
                          [-np.sin(p)*np.cos(l), -np.sin(p)*np.sin(l), np.cos(p)], up])
        for utc in [f'{first}-01-01T00:00:00', '2000-01-01T12:00:00', '2026-12-31T23:50:00',
                    '2027-01-01T00:00:00', '2028-02-29T12:00:00', f'{last}-07-01T00:00:00',
                    f'{last}-12-31T23:50:00', coverage['end'].removesuffix('Z')]:
            if utc < '1972-01-01':
                # USNO tai-utc.dat 1968-Feb segment covers every pre-leap manifest year.
                stamp = datetime.fromisoformat(utc).replace(tzinfo=timezone.utc).timestamp()
                mjd = stamp / 86400 + 40587
                tt = stamp - 946728000 + 32.184 + 4.213170 + (mjd - 39126) * .002592
                et = spice.unitim(tt, 'TDT', 'ET')
            else:
                et = spice.str2et(utc)
            frame = 'MOON_ME_DE440_ME421'
            row = dict(lat=lat, lon=lon, groundM=ground, utc=utc+'Z', et=et,
                       rotation=spice.pxform('J2000', frame, et).ravel().tolist(), bodies=[])
            # Independent simultaneous vectors for scene lighting and Moon-frame placement.
            render = lambda v: [float(v[0]), float(v[2]), float(-v[1])]
            unit = lambda v: v / np.linalg.norm(v)
            sun_moon, _ = spice.spkpos('SUN', et, frame, 'NONE', 'MOON')
            earth_moon, _ = spice.spkpos('EARTH', et, frame, 'NONE', 'MOON')
            sun_local = basis @ (sun_moon - up*(1737.4+(ground+2)/1000))
            row['geometry'] = dict(sunMoon=render(unit(sun_moon)), earthMoon=render(unit(earth_moon)),
                                   sunLocal=render(unit(sun_local)))
            for body in ('SUN', 'EARTH'):
                state, _ = spice.spkcpo(body, et, frame, 'OBSERVER', 'CN+S',
                                       up*(1737.4+(ground+2)/1000), 'MOON', frame)
                e, n, u = basis @ state[:3]
                row['bodies'].append(dict(az=float(np.degrees(np.arctan2(e, n)) % 360),
                                         el=float(np.degrees(np.arctan2(u, np.hypot(e, n)))),
                                         rangeKm=float(np.linalg.norm(state[:3]))))
            rows.append(row)
    result = dict(source='NASA/JPL DE440, NAIF CSPICE via SpiceyPy; spkcpo CN+S',
                  sourceSha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}, rows=rows)
    Path(out).write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
    print(f'Wrote {len(rows)} independent reference cases')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--kernels', required=True)
    p.add_argument('--spk', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--manifest', default=Path(__file__).resolve().parents[1] / 'app/assets/computation/quick/manifest.json')
    main(**vars(p.parse_args()))
