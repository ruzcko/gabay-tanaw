"""Publish 100 m slope screens using shipped LOLA 20 m terrain or supplied PGDA maps.

python science/landing_terrain.py app/data/sites.json app/data/landing-terrain.json
Unknown terrain stays unknown; global 1.9 km pixels cannot certify 100 m flatness.
"""
import argparse
import gzip
import json
import math
from functools import lru_cache
from pathlib import Path
import numpy as np

R = 1737400


class PolarTerrain:
    def __init__(self, folder):
        self.folder = Path(folder)
        m = json.loads((self.folder / 'manifest.json').read_text())
        if (m.get('sourceSha256') != 'dc16bba853b22fa29e26dc26b411acc180de70478578b2c75c8e6f253f56a9d9'
                or m.get('spacingM') != 20 or m.get('radiusM') != R or m.get('width') != 7584
                or m.get('frame') != 'MEAN EARTH/POLAR AXIS OF DE421'):
            raise ValueError('Unreviewed polar terrain')

    @lru_cache(maxsize=32)
    def tile(self, row, col):
        data = gzip.decompress((self.folder / f'{row}-{col}.bin.gz').read_bytes())
        if len(data) != 512 * 512 * 2:
            raise ValueError('Invalid polar tile')
        return np.frombuffer(data, dtype='<i2').reshape(512, 512) * .5

    def sample(self, lat, lon):
        p, l = np.radians([lat, lon])
        scale = 2 * R / (1 - math.sin(p)) / 20
        x = 3791.5 + math.cos(p) * math.sin(l) * scale
        y = 3791.5 - math.cos(p) * math.cos(l) * scale
        c, r = math.floor(x), math.floor(y)
        if not (0 <= r < 7583 and 0 <= c < 7583):
            raise ValueError('Outside polar terrain')
        pixel = lambda row, col: self.tile(row // 512, col // 512)[row % 512, col % 512]
        fx, fy = x - c, y - r
        return ((pixel(r, c) * (1-fx) + pixel(r, c+1) * fx) * (1-fy)
                + (pixel(r+1, c) * (1-fx) + pixel(r+1, c+1) * fx) * fy)


def footprint(lat, lon):
    p, l = np.radians([lat, lon])
    up = np.array([np.cos(p)*np.cos(l), np.cos(p)*np.sin(l), np.sin(p)])
    east = np.array([-np.sin(l), np.cos(l), 0.])
    north = np.cross(up, east)
    points = []
    for axis in (east, north):
        for sign in (1, -1):
            angle = sign * 50 / R
            v = up * np.cos(angle) + axis * np.sin(angle)
            points.append((float(np.degrees(np.arcsin(v[2]))), float(np.degrees(np.arctan2(v[1], v[0]))) % 360))
    return points


def slope_from_heights(heights):
    if len(heights) != 4 or not np.isfinite(heights).all():
        raise ValueError('Four finite footprint heights required')
    return float(np.degrees(np.arctan(np.hypot((heights[0]-heights[1])/100, (heights[2]-heights[3])/100))))


def screen(lat, lon, polar, fine_dir=None):
    if not math.isfinite(lat) or abs(lat) >= 90 or not math.isfinite(lon):
        raise ValueError('Invalid point')
    points = footprint(lat, lon)
    result = dict(slopeDeg=None, baselineM=100, resolutionM=1900,
                  source='NASA LOLA LDEM16; insufficient resolution for a 100 m footprint')
    if fine_dir:
        import horizon as hz
        # One fine DEM must cover all four samples; never silently mix in a coarse fallback.
        for z, left, top, res in hz.fine_maps_near(fine_dir, lat, lon):
            if res > 20:
                continue
            heights = []
            for plat, plon in points:
                x, y = hz.to_xy(plat, plon)
                row, col = (top-y)/res-.5, (x-left)/res-.5
                if not (0 <= row < z.shape[0]-1 and 0 <= col < z.shape[1]-1):
                    break
                heights.append(float(hz.bilinear(z, np.array(row), np.array(col))))
            if len(heights) == 4 and np.isfinite(heights).all():
                return dict(slopeDeg=slope_from_heights(heights), baselineM=100, resolutionM=res,
                            source='NASA PGDA LOLA fine DEM; central-difference slope')
    if max(p[0] for p in points) <= -87.5:
        result = dict(slopeDeg=slope_from_heights([polar.sample(*p) for p in points]), baselineM=100,
                      resolutionM=20, source='NASA LOLA LDEM_875S_20M; central-difference slope')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sites')
    parser.add_argument('out')
    parser.add_argument('--assets', default=str(Path(__file__).resolve().parents[1] / 'app/assets/observer/terrain/polar20'))
    parser.add_argument('--fine', help='Optional NASA PGDA 5 m GeoTIFF directory')
    args = parser.parse_args()
    polar = PolarTerrain(args.assets)
    sites = json.loads(Path(args.sites).read_text(encoding='utf-8'))
    rows = []
    for s in sites:
        if s.get('referenceFrame') != 'MOON_ME_DE421' or s.get('elevationDatum') != 'sphere-1737400m':
            raise ValueError('Unverified point frame/datum')
        rows.append(dict(id=s['id'], lat=s['lat'], lon=s['lon'], **screen(s['lat'], s['lon'], polar, args.fine)))
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps({'version':1, 'referenceFrame':'MOON_ME_DE421', 'rows':rows}, indent=2)+'\n', encoding='utf-8')
    print(f'Published {len(rows)} terrain screens; {sum(r["slopeDeg"] is None for r in rows)} unresolved')


if __name__ == '__main__':
    main()
