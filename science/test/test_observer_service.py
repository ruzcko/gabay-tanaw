import gzip
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import numpy as np
import spiceypy as spice

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from observer_service import selection, window_selection, ObserverScience
from observer_appearance import local_basis, quaternion
from observer_terrain import GlobalTerrain
from site_elevation import global_height

ROOT = Path(__file__).resolve().parents[2]
KERNELS = os.environ.get('TANAW_TEST_KERNELS')


class RequestTests(unittest.TestCase):
    def test_window_bounds_are_exact_and_preserve_instant(self):
        instant = datetime(2027, 1, 1, 13, tzinfo=timezone.utc)
        params = {'startUtc': ['2026-12-22T00:00:00Z'], 'endUtc': ['2027-01-21T00:00:00.000Z']}
        self.assertEqual((window_selection(params, instant)[1]-window_selection(params, instant)[0]).days, 30)
        for change in ({'startUtc': ['2026-12-22T01:00:00Z']}, {'endUtc': ['2027-12-01T00:00:00Z']},
                       {'startUtc': []}, {'endUtc': ['2027-01-01T00:00:00Z']},
                       {'startUtc': ['2027-02-29T00:00:00Z']}, {'startUtc': ['2026-12-22T00:00:00Z']*2}):
            with self.assertRaises(ValueError): window_selection({**params, **change}, instant)

    def test_requests_reject_nonfinite_poles_dates_duplicates(self):
        base = {'lat': ['1'], 'lon': ['2'], 't': ['2026-12-01T00:00:00Z']}
        for change in ({'lat': ['90']}, {'lat': ['89.9999999']}, {'lat': ['nan']}, {'lon': ['inf']}, {'t': ['2027-12-01T00:00:00Z']},
                       {'t': ['2027-02-29T00:00:00Z']}, {'t': ['2026-12-01T00:01:00Z']}, {'lat': ['1', '2']}):
            with self.assertRaises(ValueError): selection({**base, **change})
        self.assertEqual(selection({**base, 'lon': ['-137.17']})[1], 222.83)

    def test_quaternion_and_axis_conventions(self):
        np.testing.assert_allclose(local_basis(0, 0), [[0, 1, 0], [1, 0, 0], [0, 0, -1]], atol=1e-14)
        for lat, lon in [(0, 0), (-89.4398, 222.83), (40, 350)]:
            basis = local_basis(lat, lon)
            np.testing.assert_allclose(basis @ basis.T, np.eye(3), atol=1e-14)
            self.assertAlmostEqual(np.linalg.det(basis), 1)
            q = quaternion(basis)
            np.testing.assert_allclose(spice.q2m([q[3], *q[:3]]), basis, atol=1e-14)

    def test_global_sampler_matches_existing_sampler_and_wraps_seams(self):
        terrain = GlobalTerrain(ROOT / 'app/assets/observer/terrain')
        for lat, lon in [(0.5, 20.5), (-34.1, -72.1), (80.2, 45.3)]:
            self.assertAlmostEqual(float(terrain.sample(lat, lon)), global_height(terrain.folder/'16', lat, lon), places=8)
        np.testing.assert_allclose(terrain.sample(np.array([0., 89.999, -89.999]), 180), terrain.sample(np.array([0., 89.999, -89.999]), -180))
        self.assertTrue(np.isfinite(terrain.sample(np.array([90., -90.]), 0)).all())


@unittest.skipUnless(KERNELS, 'Set TANAW_TEST_KERNELS for pinned-kernel integration tests')
class ScienceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.science = ObserverScience(ROOT/'app', KERNELS, self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_catalog_unchanged_and_orientation_tracks_time(self):
        utc = datetime(2026, 12, 1, tzinfo=timezone.utc)
        for site in self.science.sites:
            snap = self.science.observe(site['lat'], site['lon'], utc, site['id'])
            month = self.science.read(f"forecast/{site['id']}/2026-12.json")
            self.assertEqual(snap['bodies']['sun']['elevationDeg'], month['sunEl'][0])
            self.assertEqual(snap['bodies']['earth']['rangeKm'], month['earthRangeKm'][0])
            q = snap['sky']['catalogToLocal']
            self.assertAlmostEqual(np.linalg.norm(q), 1.)
            # A fixed inertial unit vector rotates into the site's E/U/S basis.
            local = spice.q2m([q[3], *q[:3]])
            np.testing.assert_allclose(local @ local.T, np.eye(3), atol=1e-12)
        s = self.science.sites[0]
        a = self.science.observe(s['lat'], s['lon'], utc)
        b = self.science.observe(s['lat'], s['lon'], datetime(2026, 12, 8, tzinfo=timezone.utc))
        self.assertGreater(np.linalg.norm(np.array(a['sky']['catalogToLocal'])-b['sky']['catalogToLocal']), .1)
        self.assertEqual(a['earthAppearance']['bodyFrame'], 'earth-fixed-x0-yNorth-zWest')
        self.assertAlmostEqual(np.linalg.norm(a['earthAppearance']['bodyToLocal']), 1.)
        self.assertAlmostEqual(np.linalg.norm(a['earthAppearance']['sunDirectionBody']), 1.)
        for site in self.science.sites:
            if site.get('positionAccuracy') == 'approximate':
                snap = self.science.observe(site['lat'], site['lon'], utc)
                self.assertTrue(any('Approximate planned' in w for w in snap['provenance']['warnings']))

    def test_saved_data_corruption_fails_before_rendering(self):
        source = self.science.app/'data/forecast/connecting-ridge/2026-12.json'
        damaged = json.loads(source.read_bytes()); damaged['sunVisible'][0] = 2
        with patch('observer_service.read_json', return_value=damaged):
            with self.assertRaises(Exception): self.science.read('forecast/connecting-ridge/2026-12.json')
        self.science.read.cache_clear()
        with patch.object(self.science, 'digest', return_value='changed'):
            with self.assertRaisesRegex(ValueError, 'changed since audit'): self.science.read('forecast/connecting-ridge.json')

    def test_every_catalog_month_preserves_published_body_fields_at_boundaries(self):
        for site in self.science.sites:
            for label in self.science.window['months']:
                month = self.science.read(f"forecast/{site['id']}/{label}.json")
                start = datetime.fromisoformat(month['start'])
                for k in (0, len(month['sunEl']) - 1):
                    with self.subTest(site=site['id'], month=label, hour=k):
                        snap = self.science.observe(site['lat'], site['lon'], start + timedelta(hours=k), site['id'])
                        for name in ('sun', 'earth'):
                            self.assertEqual(snap['bodies'][name], {
                                'azimuthDeg': month[name+'Az'][k] % 360,
                                'elevationDeg': month[name+'El'][k],
                                'rangeKm': month[name+'RangeKm'][k],
                                'angularDiameterDeg': month[name+'AngularDiameterDeg'][k],
                                'centerVisible': bool(month[name+'Visible'][k])})


    def test_geometric_sun_against_constant_position_spice_observer(self):
        # Independent CSPICE observer-position path, instead of repeating spkpos subtraction.
        from earth_accuracy import FRAME
        site, _ = self.science.site(-39.8, 72.1)
        utc = datetime(2026, 12, 22, tzinfo=timezone.utc)
        from observer_appearance import appearance
        utc_label = utc.strftime('%Y-%m-%dT%H:%M:%SZ')
        result = appearance(site, utc_label)
        basis = local_basis(-39.8, 72.1)
        position = basis[1] * (1737.4 + (site['surfaceElevationM']+2)/1000)
        state, _ = spice.spkcpo('SUN', spice.str2et(utc_label), FRAME, 'OBSERVER', 'NONE', position, 'MOON', FRAME)
        vector = basis @ state[:3]; vector /= np.linalg.norm(vector)
        np.testing.assert_allclose(result['lighting']['sunDirectionLocal'], vector, atol=1e-12)
        # Earth-body illumination and rotation must reproduce the same geometric local vector.
        q = result['earthAppearance']['bodyToLocal']
        local_sun = spice.q2m([q[3], *q[:3]]) @ result['earthAppearance']['sunDirectionBody']
        earth_sun, _ = spice.spkpos('SUN', spice.str2et(utc_label), FRAME, 'NONE', 'EARTH')
        expected = basis @ earth_sun; expected /= np.linalg.norm(expected)
        np.testing.assert_allclose(local_sun, expected, atol=1e-12)

    def test_custom_cache_and_mesh_match_ground_without_catalog_snapping(self):
        utc = datetime(2026, 12, 1, tzinfo=timezone.utc)
        site, saved = self.science.site(-10.123456, 25.123456)
        self.assertIsNone(saved)
        mesh = self.science.terrain.mesh(site)
        self.assertLess(abs(mesh['elevationsM'][257*257//2]-site['surfaceElevationM']), .001)
        rows = ([utc], [90.], [1.], [1000000.], [.5])
        with patch.object(self.science.terrain, 'profile', return_value=(site['surfaceElevationM'], np.zeros(1440))), \
             patch('observer_service.query', return_value='fixture$$SOE') as query, \
             patch('observer_service.validate_response', return_value=rows):
            first = self.science.observe(-10.123456, 25.123456, utc)
            second = self.science.observe(-10.123456, 25.123456, utc)
            self.assertEqual(first, second); self.assertEqual(query.call_count, 2)
            self.assertTrue(first['bodies']['sun']['centerVisible'])

    def test_prepared_window_complete_cached_and_playback_never_fetches(self):
        start = datetime(2026, 12, 22, tzinfo=timezone.utc); stop = start+timedelta(days=30)
        instant = start+timedelta(days=10, hours=13); bounds = (start, stop)
        site, _ = self.science.site(-10.123456, 25.123456)
        times = [start+timedelta(minutes=10*k) for k in range(30*24*6+1)]
        rows = (times, [90.]*len(times), [1.]*len(times), [1000000.]*len(times), [.5]*len(times))
        with patch.object(self.science.terrain, 'profile', return_value=(site['surfaceElevationM'], np.zeros(1440))), \
             patch('observer_service.query', return_value='fixture$$SOE') as query, \
             patch('observer_service.validate_response', return_value=rows):
            response = self.science.prepare_window(-10.123456, 25.123456, instant, bounds)
            self.assertEqual(response['coverage']['sampleCount'], 720)
            self.assertEqual(response['observation']['instantUtc'], '2027-01-01T13:00:00.000Z')
            self.assertEqual(len(response['observations']), 30)
            self.assertEqual(response['observations'][0]['instantUtc'], '2026-12-22T13:00:00.000Z')
            self.assertEqual(response['observations'][-1]['instantUtc'], '2027-01-20T13:00:00.000Z')
            self.assertNotEqual(response['observations'][0]['lighting'], response['observations'][-1]['lighting'])
            for args in query.call_args_list:
                self.assertEqual(args.args[3:], (start.date(), stop.date()))
            self.science.prepare_window(-10.123456, 25.123456, instant, bounds)
            self.assertEqual(query.call_count, 2)
            self.science.prepared_windows.clear()
            self.science.prepare_window(-10.123456, 25.123456, instant, bounds)
            self.assertEqual(query.call_count, 2, 'Raw window cache must survive memory eviction')
        with patch('observer_service.query', side_effect=AssertionError('Playback fetched NASA')):
            a = self.science.observe(-10.123456, 25.123456, start, bounds=bounds)
            b = self.science.observe(-10.123456, 25.123456, stop-timedelta(hours=1), bounds=bounds)
            self.assertNotEqual(a['instantUtc'], b['instantUtc'])
            self.assertEqual(len(a['provenance']['warnings']), len(b['provenance']['warnings']))
            with self.assertRaises(ValueError): self.science.observe(-10.123456, 25.123456, stop, bounds=bounds)
            self.science.prepared_windows.clear()
            with self.assertRaises(ValueError): self.science.observe(-10.123456, 25.123456, instant, bounds=bounds)

    def test_damaged_raw_cache_can_retry_but_invalid_replacement_is_rejected(self):
        start = datetime(2026, 12, 22, tzinfo=timezone.utc); stop = start + timedelta(days=30)
        site, _ = self.science.site(-10.123456, 25.123456)
        times = [start + timedelta(minutes=10*k) for k in range(30*24*6+1)]
        rows = (times, [90.]*len(times), [1.]*len(times), [1000000.]*len(times), [.5]*len(times))
        def validate(raw, *args, **kwargs):
            if raw != 'validated fixture': raise ValueError('Invalid response')
            return rows
        with patch.object(self.science.terrain, 'profile', return_value=(site['surfaceElevationM'], np.zeros(1440))), \
             patch('observer_service.query', return_value='validated fixture') as query, \
             patch('observer_service.validate_response', side_effect=validate):
            self.science.prepare_window(-10.123456, 25.123456, start, (start, stop))
            cached = next(self.science.cache.glob('*.txt.gz'))
            for damaged in (b'not gzip', gzip.compress(b'invalid headers'), gzip.compress(b'validated fixture')[:-5]):
                self.science.prepared_windows.clear(); cached.write_bytes(damaged); query.reset_mock()
                self.science.prepare_window(-10.123456, 25.123456, start, (start, stop))
                self.assertEqual(query.call_count, 1, 'Refetch only the damaged body')
                self.assertEqual(gzip.decompress(cached.read_bytes()), b'validated fixture')
            self.science.prepared_windows.clear(); cached.write_bytes(b'broken')
            query.return_value = 'invalid replacement'
            with self.assertRaises(ValueError):
                self.science.prepare_window(-10.123456, 25.123456, start, (start, stop))
            self.assertFalse(self.science.prepared_windows)
            self.assertEqual(cached.read_bytes(), b'broken', 'Never cache an unvalidated replacement')
            query.return_value = 'validated fixture'
            self.science.prepare_window(-10.123456, 25.123456, start, (start, stop))


    def test_incomplete_window_is_never_published(self):
        start = datetime(2026, 12, 1, tzinfo=timezone.utc)
        with patch.object(self.science, 'custom_series', return_value=({}, {})):
            with self.assertRaisesRegex(ValueError, 'Incomplete'):
                self.science.prepare_window(-10.123456, 25.123456, start, (start, start+timedelta(days=30)))
        self.assertFalse(self.science.prepared_windows)


if __name__ == '__main__': unittest.main()
