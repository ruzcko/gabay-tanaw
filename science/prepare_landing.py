"""Prepare arbitrary landing-grid points through the existing authoritative Python pipeline.

Produces a separate data directory consumable by createLandingSource({baseUrl}).
Never edits the shipped catalog. Network work is explicit via --fetch.
"""
import argparse
import json
import math
import re
import subprocess
import sys
from pathlib import Path


def validate_points(points):
    if not isinstance(points, list) or not 1 <= len(points) <= 256:
        raise ValueError('Supply 1–256 points')
    ids = set()
    for p in points:
        if (not re.fullmatch(r'[a-zA-Z0-9_-]+', p.get('id', '')) or p['id'] in ids
                or not isinstance(p.get('name'), str) or not p['name'].strip()
                or not isinstance(p.get('lat'), (float, int)) or not math.isfinite(p['lat']) or abs(p['lat']) >= 90
                or not isinstance(p.get('lon'), (float, int)) or not math.isfinite(p['lon'])
                or p.get('referenceFrame') != 'MOON_ME_DE421' or p.get('elevationDatum') != 'sphere-1737400m'):
            raise ValueError('Points need unique safe IDs, names, finite coordinates and explicit frame/datum')
        ids.add(p['id'])
        p['lon'] %= 360
    return points


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('points', help='JSON list of sites, one per region sample')
    parser.add_argument('output', help='Separate prepared data directory')
    parser.add_argument('--ldem', required=True, help='NASA LDEM_75S_240M IMG')
    parser.add_argument('--fine', help='NASA PGDA fine GeoTIFF directory')
    parser.add_argument('--polar60')
    parser.add_argument('--windows', help='Existing SLDEM2015 windows named by point ID')
    parser.add_argument('--fetch', action='store_true', help='Fetch Horizons; otherwise reuse an existing cache')
    args = parser.parse_args()
    points = validate_points(json.loads(Path(args.points).read_text(encoding='utf-8')))
    output = Path(args.output).resolve()
    root = Path(__file__).resolve().parents[1]
    if output == root / 'app/data':
        raise ValueError('Choose a separate preparation directory, not the shipped catalog')
    output.mkdir(parents=True, exist_ok=True)
    sites = output / 'sites.json'
    sites.write_text(json.dumps(points, indent=2)+'\n', encoding='utf-8')
    def run(script, *arguments):
        subprocess.run([sys.executable, str(root/'science'/script), *map(str, arguments)], check=True)
    flags = []
    for name in ('fine', 'polar60', 'windows'):
        if getattr(args, name):
            flags.extend(['--'+name, getattr(args, name)])
    run('horizon.py', args.ldem, sites, output/'horizons', '--require-terrain', *flags)
    run('landing_terrain.py', sites, output/'landing-terrain.json', *(['--fine', args.fine] if args.fine else []))
    if args.fetch:
        run('fetch_ephemeris.py', sites, output/'cache', '2026-12-01', '365', '--horizons', output/'horizons', '--batch')
    run('build_forecast.py', sites, output/'cache', output/'horizons', output/'forecast')


if __name__ == '__main__':
    main()
