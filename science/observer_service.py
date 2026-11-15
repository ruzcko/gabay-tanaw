"""Loopback-only observer preview service. Existing published forecasts remain unchanged.

python science/observer_service.py --kernels PATH --port 4399
Custom coordinates use the existing Horizons query/validation + terrain horizon routines.
All SPICE and upstream work is serialized. Raw day responses are cached outside app/.
"""
import argparse
import gzip
import hashlib
import json
import math
import re
import select
import socket
import threading
import zlib
from collections import OrderedDict
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from functools import lru_cache, partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from jsonschema import Draft202012Validator, FormatChecker

from build_forecast import mask_at
from fetch_ephemeris import query, validate_response
from observer_appearance import appearance, load_kernels
from observer_terrain import GlobalTerrain
from validate_data import read as read_json


def selection(params):
    if any(len(values) != 1 for values in params.values()):
        raise ValueError('Duplicate query parameters')
    utc = params.get('t', [''])[0]
    if not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:00:00(?:\.000)?Z', utc):
        raise ValueError('Select an exact saved UTC hour')
    instant = datetime.fromisoformat(utc.replace('Z', '+00:00'))
    if not datetime(2026, 12, 1, tzinfo=timezone.utc) <= instant < datetime(2027, 12, 1, tzinfo=timezone.utc):
        raise ValueError('Date outside the forecast year')
    lat, lon = float(params.get('lat', ['nan'])[0]), float(params.get('lon', ['nan'])[0])
    if not math.isfinite(lat) or not math.isfinite(lon) or not -90 < lat < 90 or not -180 <= lon <= 360:
        raise ValueError('Choose a nonpolar latitude and an east-positive longitude')
    lat = round(lat, 6)
    if not -90 < lat < 90:
        raise ValueError('Choose a location away from the exact pole')
    return lat, round(lon % 360, 6) % 360, instant


def window_selection(params, instant):
    bounds = []
    for name in ('startUtc', 'endUtc'):
        values = params.get(name, [])
        if len(values) != 1 or not re.fullmatch(r'\d{4}-\d\d-\d\dT00:00:00(?:\.000)?Z', values[0]):
            raise ValueError('Window boundaries must be UTC midnights')
        bounds.append(datetime.fromisoformat(values[0].replace('Z', '+00:00')))
    start, stop = bounds
    if (stop-start != timedelta(days=30) or not start <= instant < stop
            or start < datetime(2026, 12, 1, tzinfo=timezone.utc)
            or stop > datetime(2027, 12, 1, tzinfo=timezone.utc)):
        raise ValueError('Select 30 consecutive UTC days inside the forecast year containing the selected hour')
    return start, stop


class ObserverScience:
    def __init__(self, app, kernels, cache):
        self.app, self.cache = Path(app), Path(cache)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.kernels = load_kernels(kernels)
        self.validators = {name: Draft202012Validator(json.loads((Path(__file__).with_name('schemas') / f'{name}.schema.json').read_bytes()), format_checker=FormatChecker())
                           for name in ('sites', 'manifest', 'forecast', 'forecast-month', 'horizon', 'sun')}
        self.manifest = read_json(self.app / 'data/forecast-manifest.json')
        self.validators['manifest'].validate(self.manifest)
        self.sites = read_json(self.app / 'data/sites.json')
        self.validators['sites'].validate(self.sites)
        if self.digest('sites.json') != self.manifest['catalogSha256']:
            raise ValueError('Catalog changed since the published audit')
        self.window = self.read('sun.json')
        if self.window['months'] != ['2026-12', *[f'2027-{m:02}' for m in range(1, 12)]]:
            raise ValueError('Unsupported published forecast year')
        self.terrain = GlobalTerrain(self.app / 'assets/observer/terrain')
        self.prepared_windows = OrderedDict()

    def digest(self, relative):
        return hashlib.sha256((self.app/'data'/relative).read_bytes().replace(b'\r\n', b'\n')).hexdigest()

    @lru_cache(maxsize=64)
    def read(self, relative):
        if self.digest(relative) != self.manifest['filesSha256'].get(relative):
            raise ValueError(f'Published data changed since audit: {relative}')
        value = read_json(self.app / 'data' / relative)
        schema = 'sun' if relative == 'sun.json' else 'horizon' if relative.startswith('horizons/') else 'forecast-month' if relative.count('/') == 2 else 'forecast'
        self.validators[schema].validate(value)
        if schema == 'forecast-month':
            start = datetime.fromisoformat(value['start']); label = Path(relative).stem
            stop = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
            n = int((stop-start).total_seconds()/3600)
            if start.strftime('%Y-%m') != label or start.day != 1 or start.hour != 0 or start.minute != 0 or any(len(v) != n for k, v in value.items() if isinstance(v, list)):
                raise ValueError('Incomplete or misaligned forecast month')
            for name in ('sun', 'earth'):
                if any(type(v) is not int or v not in (0, 1) for v in value[name+'Visible']):
                    raise ValueError('Invalid published visibility')
        return value

    def site(self, lat, lon, identifier=None):
        saved = next((s for s in self.sites if abs(s['lat']-lat) < 1e-7 and abs((s['lon']-lon+180)%360-180) < 1e-7), None)
        if identifier and (not saved or saved['id'] != identifier):
            raise ValueError('Site ID and coordinates disagree')
        if saved:
            index = self.read(f"forecast/{saved['id']}.json")
            science = index['science']
            horizon = self.read(f"horizons/{saved['id']}.json")
            if (any(value[k] != saved[k] for value in (index, horizon) for k in ('id', 'lat', 'lon'))
                    or index['window'] != self.window['window'] or index['months'] != self.window['months']
                    or science['surfaceElevationM'] != horizon['surfaceElevation'] or science['observerHeightM'] != horizon['observerHeight']
                    or science['horizonSha256'] != self.digest(f"horizons/{saved['id']}.json")
                    or science['referenceFrame'] != saved['referenceFrame'] or science['elevationDatum'] != saved['elevationDatum']
                    or science['frameEvidence'] != saved['frameEvidence'] or science.get('positionAccuracy') != saved.get('positionAccuracy')):
                raise ValueError('Published site, terrain or forecast metadata disagree')
            return {'id': saved['id'], 'latitudeDeg': saved['lat'], 'longitudeEastDeg': saved['lon'],
                    'referenceFrame': science['referenceFrame'], 'elevationDatum': science['elevationDatum'],
                    'surfaceElevationM': science['surfaceElevationM'], 'observerHeightM': science['observerHeightM']}, saved
        ground = float(self.terrain.sample(lat, lon))
        return {'id': f'custom-{lat:.6f}-{lon:.6f}', 'latitudeDeg': lat, 'longitudeEastDeg': lon,
                'referenceFrame': 'MOON_ME_DE421', 'elevationDatum': 'sphere-1737400m',
                'surfaceElevationM': ground, 'observerHeightM': 2.}, None

    def custom_series(self, site, start, stop):
        lat, lon = site['latitudeDeg'], site['longitudeEastDeg']
        ground, mask = self.terrain.profile(lat, lon)
        catalog_shape = {'id': site['id'], 'lat': lat, 'lon': lon, 'referenceFrame': site['referenceFrame'], 'elevationDatum': site['elevationDatum']}
        horizon = {'id': site['id'], 'lat': lat, 'lon': lon, 'referenceFrame': site['referenceFrame'], 'datum': site['elevationDatum'],
                   'surfaceElevation': ground, 'observerHeight': 2., 'terrain': 'LOLA LDEM16 coarse global'}
        hourly, sources = {}, []
        for name in ('sun', 'earth'):
            key = hashlib.sha256(json.dumps([site, str(start), str(stop), name, 'observer-service-v2'], sort_keys=True).encode()).hexdigest()
            path = self.cache / f'{key}.txt.gz'
            rows = None
            if path.exists():
                try:
                    with gzip.open(path, 'rt', encoding='utf-8') as source:
                        raw = source.read()
                    rows = validate_response(raw, name, catalog_shape, horizon, start, stop, observer=True)
                except (gzip.BadGzipFile, EOFError, UnicodeError, ValueError, zlib.error):
                    # Explicit preparation may repair a corrupt cache; playback never fetches.
                    pass
            if rows is None:
                raw = query(name, catalog_shape, horizon, start, stop)
                rows = validate_response(raw, name, catalog_shape, horizon, start, stop, observer=True)
                temporary = path.with_suffix('.tmp')
                temporary.write_bytes(gzip.compress(raw.encode())); temporary.replace(path)
                # Bound local exploratory raw-cache storage. Catalog data is never touched.
                for old in sorted(self.cache.glob('*.txt.gz'), key=lambda p: p.stat().st_mtime)[:-256]:
                    old.unlink()
            times, az, el, ranges, diameters = rows
            for k, instant in enumerate(times):
                if instant.minute == 0 and start <= instant.date() < stop:
                    hourly.setdefault(instant, {})[name] = {'azimuthDeg': az[k] % 360, 'elevationDeg': el[k], 'rangeKm': ranges[k],
                                                           'angularDiameterDeg': diameters[k], 'centerVisible': bool(el[k] > mask_at(mask, az[k]))}
            sources.append({'body': name, 'sha256': hashlib.sha256(raw.encode()).hexdigest(), 'header': raw.split('$$SOE')[0]})
        return hourly, {'source': 'JPL Horizons', 'model': 'Airless apparent observations; LDEM16 coarse terrain center visibility',
                        'warnings': ['Custom-site terrain is coarse (~1.9 km equatorial sampling), not the reviewed catalog terrain stack.',
                                     'Center visibility is not a communications or partial-disc model.'], 'rawSources': sources}

    def custom_hour(self, site, instant):
        hourly, provenance = self.custom_series(site, instant.date(), instant.date()+timedelta(days=1))
        return hourly[instant], provenance

    def prepare_window(self, lat, lon, instant, bounds, identifier=None):
        site, saved = self.site(lat, lon, identifier)
        if saved:
            raise ValueError('Use published forecasts for catalog sites')
        start, stop = bounds
        key = (site['id'], start, stop)
        if key not in self.prepared_windows:
            hourly, provenance = self.custom_series(site, start.date(), stop.date())
            expected = {start+timedelta(hours=h) for h in range(720)}
            if set(hourly) != expected or any(set(bodies) != {'sun', 'earth'} for bodies in hourly.values()):
                raise ValueError('Incomplete prepared window')
            self.prepared_windows[key] = (hourly, provenance)
            while len(self.prepared_windows) > 8:
                self.prepared_windows.popitem(last=False)
        self.prepared_windows.move_to_end(key)
        # Exact daily snapshots at the selected hour: immediate date scrubbing, no interpolation.
        observations = [self.observe(lat, lon, start+timedelta(days=d, hours=instant.hour), identifier, bounds) for d in range(30)]
        return {'coverage': {'startUtc': start.strftime('%Y-%m-%dT%H:%M:%S.000Z'),
                             'endUtc': stop.strftime('%Y-%m-%dT%H:%M:%S.000Z'),
                             'stepSeconds': 3600, 'sampleCount': 720},
                'observation': observations[(instant-start).days], 'observations': observations}

    def observe(self, lat, lon, instant, identifier=None, bounds=None):
        site, saved = self.site(lat, lon, identifier)
        if saved and bounds:
            raise ValueError('Use published forecasts for catalog sites')
        if saved:
            month = self.read(f"forecast/{site['id']}/{instant:%Y-%m}.json")
            k = (instant.day - 1) * 24 + instant.hour
            bodies = {name: {'azimuthDeg': month[name+'Az'][k] % 360, 'elevationDeg': month[name+'El'][k],
                            'rangeKm': month[name+'RangeKm'][k], 'angularDiameterDeg': month[name+'AngularDiameterDeg'][k],
                            'centerVisible': bool(month[name+'Visible'][k])} for name in ('sun', 'earth')}
            provenance = {'source': 'JPL Horizons saved forecasts', 'model': 'Published hourly airless apparent observations',
                          'forecast': self.read(f"forecast/{site['id']}.json")['science'],
                          'warnings': ['Coordinate evidence is retained as published; empirical terrain consistency is not a measured frame registration or positional error bound.']}
            if saved.get('positionAccuracy') == 'approximate':
                provenance['warnings'].append('Approximate planned target coordinates; not a surveyed landing position.')
        elif bounds:
            key = (site['id'], *bounds)
            if key not in self.prepared_windows or not bounds[0] <= instant < bounds[1]:
                raise ValueError('Window is not prepared. Prepare the same 30-day window and retry.')
            self.prepared_windows.move_to_end(key)
            hourly, provenance = self.prepared_windows[key]
            bodies, provenance = deepcopy(hourly[instant]), deepcopy(provenance)
        else:
            bodies, provenance = self.custom_hour(site, instant)
        utc = instant.strftime('%Y-%m-%dT%H:%M:%S.000Z')
        provenance['appearance'] = {'source': 'NASA NAIF / DE440', 'frame': 'MOON_ME_DE440_ME421', 'kernels': self.kernels,
                                   'correction': 'NONE for geometric illumination; epoch-dependent ICRS-to-local rotation'}
        provenance['warnings'] += ['Hipparcos positions remain at epoch J1991.25; proper motion, parallax and stellar aberration are not modeled.',
                                  'Star exposure is a display approximation. Earth uses low-accuracy IAU orientation and static imagery; eclipses are unsupported.']
        return {'site': site, 'instantUtc': utc, 'directionKind': 'apparent', 'interpolated': False,
                'bodies': bodies, 'provenance': provenance, **appearance(site, utc)}


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # A development preview must not retain stale imported modules between edits.
        if not self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def response(self, status, value):
        raw = json.dumps(value, allow_nan=False, separators=(',', ':')).encode()
        self.send_response(status); self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store'); self.send_header('Content-Length', str(len(raw)))
        self.end_headers(); self.wfile.write(raw)

    def do_GET(self):
        path = urlsplit(self.path)
        if not path.path.startswith('/api/'):
            return super().do_GET()
        allowed = self.headers.get('Host')
        if allowed not in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}') or self.headers.get('Origin', f'http://{allowed}') != f'http://{allowed}':
            return self.response(403, {'error': 'Use the loopback preview origin'})
        if path.path == '/api/health':
            return self.response(200, {'service': 'tanaw-observer', 'version': 1, 'observerWindow': {'durationDays': 30}})
        if path.path not in ('/api/observer', '/api/observer-window', '/api/terrain'):
            return self.response(404, {'error': 'Unknown endpoint'})
        if not self.server.slots.acquire(blocking=False):
            return self.response(429, {'error': 'Science service busy. Wait for the current calculation, then retry.'})
        try:
            params = parse_qs(path.query, keep_blank_values=True)
            lat, lon, instant = selection(params)
            bounds = window_selection(params, instant) if path.path == '/api/observer-window' or 'startUtc' in params or 'endUtc' in params else None
            with self.server.science_lock:
                # Skip disconnected queued requests before terrain or NASA work starts.
                readable, _, _ = select.select([self.connection], [], [], 0)
                if readable and self.connection.recv(1, socket.MSG_PEEK) == b'':
                    return
                if path.path == '/api/observer':
                    result = self.server.science.observe(lat, lon, instant, params.get('site', [None])[0], bounds)
                elif path.path == '/api/observer-window':
                    result = self.server.science.prepare_window(lat, lon, instant, bounds, params.get('site', [None])[0])
                else:
                    site, saved = self.server.science.site(lat, lon)
                    if saved:
                        raise ValueError('Use published terrain meshes for catalog sites')
                    site['longitudeEastDeg'] = (site['longitudeEastDeg'] + 180) % 360 - 180
                    result = self.server.science.terrain.mesh(site)
            self.response(200, result)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except ValueError as error:
            self.response(400, {'error': str(error)})
        except Exception as error:
            print(f'Observer calculation failed: {error}', flush=True)
            self.response(502, {'error': 'Science calculation unavailable. Check the local service terminal and retry.'})
        finally:
            self.server.slots.release()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--kernels', type=Path, required=True)
    ap.add_argument('--app', type=Path, default=Path(__file__).resolve().parents[1] / 'app')
    ap.add_argument('--cache', type=Path, default=Path(__file__).resolve().parents[1] / 'science/cache/observer-cache')
    ap.add_argument('--port', type=int, default=4399)
    args = ap.parse_args()
    science = ObserverScience(args.app, args.kernels, args.cache)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(args.app.resolve())))
    server.science = science; server.science_lock = threading.Lock(); server.slots = threading.BoundedSemaphore(3)
    print(f'Tanaw observer: http://127.0.0.1:{args.port}/observer/', flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
