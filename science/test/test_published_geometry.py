"""Published geometry uses pinned geometric states and never edits apparent data."""
import json
import os
from pathlib import Path
import sys
import unittest
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from publish_geometry import geometric_track
from observer_appearance import load_kernels, appearance, local_basis

ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(os.environ.get('TANAW_TEST_KERNELS'), 'Set TANAW_TEST_KERNELS')
class PublishedGeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pins = load_kernels(os.environ['TANAW_TEST_KERNELS'])

    def test_saved_apollo_geometry_reproduces_publisher_and_service(self):
        month = json.loads((ROOT/'app/data/sun/2027-03.json').read_text())
        track = geometric_track('2027-03-19T01:00:00Z', 2, self.pins)
        i = 18*24+1
        for body in ('sun', 'earth'):
            np.testing.assert_array_equal(track[body], month['geometric'][body][i:i+2])
        np.testing.assert_array_equal(track['sky']['rotations'], month['geometric']['sky']['rotations'][i:i+2])
        f = json.loads((ROOT/'app/data/forecast/apollo-17.json').read_text())
        site = dict(latitudeDeg=f['lat'], longitudeEastDeg=f['lon'],
                    surfaceElevationM=f['science']['surfaceElevationM'], observerHeightM=2)
        basis = local_basis(f['lat'], f['lon'])
        ray = np.array(track['sun'][0][:3])-basis[1]*(1737.4+(site['surfaceElevationM']+2)/1000)
        local = basis @ ray
        expected = appearance(site, '2027-03-19T01:00:00Z')['lighting']['sunDirectionLocal']
        np.testing.assert_allclose(local/np.linalg.norm(local), expected, atol=1e-14)

    def test_leap_second_interval_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'leap-second'):
            geometric_track('2016-12-31T23:00:00Z', 2, self.pins)
