"""Analytic interpolation and regression checks for the non-polar terrain port."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import horizon as hz


class TerrainTests(unittest.TestCase):
    def test_pole_crossing_rays_stay_finite_on_a_sphere(self):
        class Sphere:
            def sample(self, lat, lon):
                if not np.isfinite(lat).all() or not np.isfinite(lon).all():
                    raise ValueError('Nonfinite ray coordinates')
                return np.zeros(np.broadcast_shapes(np.shape(lat), np.shape(lon)))
        # At these six-decimal selections a ray reaches the pole to roundoff.
        distance = np.arange(hz.DS, 150000 + hz.DS / 2, hz.DS) / hz.R
        expected = np.degrees(np.arctan2(hz.R * np.cos(distance) - (hz.R + 2),
                                        hz.R * np.sin(distance))).max()
        for lat in (89.695284, -89.695284):
            with self.subTest(lat=lat), np.errstate(invalid='raise'):
                np.testing.assert_allclose(hz.horizon(Sphere(), lat, 30), expected, atol=1e-12)

    def test_window_plane_interpolation_across_zero_longitude(self):
        # A planar pixel grid has a known bilinear answer at fractional indices.
        win = {"z": np.array([[0., 2., 4.], [10., 12., 14.], [20., 22., 24.]]),
               "lat0": 1., "lon0": 359., "step": 1.}
        actual = hz.window_height(win, np.array([0.5, 0.5]), np.array([359.5, 0.5]))
        np.testing.assert_allclose(actual, [6., 8.])
        with self.assertRaises(ValueError):
            hz.window_height(win, np.array([2.]), np.array([0.]))

    def test_smooth_ground_has_known_spherical_dip(self):
        dip = hz.smooth_horizon(2., 0.25)
        self.assertEqual(len(dip), 1440)
        self.assertAlmostEqual(dip[0], -np.degrees(np.arccos(1737400/1737402)), places=12)

    def test_nonpolar_sites_keep_own_ground_and_quarter_degree_grid(self):
        # Regression: an automatic merge left the previous polar site's ground
        # in non-polar metadata and called those rays at the old default 1 degree.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sites = [{"id": key, "lat": 0., "lon": 0., "referenceFrame": "MOON_ME_DE421",
                      "elevationDatum": "sphere-1737400m"} for key in ("one", "two")]
            (root/"sites.json").write_text(json.dumps(sites))
            for key, ground in [("one", -100.), ("two", 400.)]:
                np.savez(root/f"{key}.npz", z=np.full((3, 3), ground), lat0=1/128,
                         lon0=-1/128, step=1/128)
            argv = ["horizon.py", "unused.img", str(root/"sites.json"), str(root/"out"),
                    "--windows", str(root), "--require-terrain"]
            def rays(*args, step=1., **kwargs):
                return np.full(int(360/step), -0.123456)
            with patch.object(sys, "argv", argv), patch.object(hz, "load_ldem"), patch.object(hz, "horizon", side_effect=rays):
                hz.main()
            for key, ground in [("one", -100.), ("two", 400.)]:
                result = json.loads((root/"out"/f"{key}.json").read_bytes())
                self.assertEqual(result["surfaceElevation"], ground)
                self.assertEqual(len(result["elevations"]), 360)
                self.assertEqual(len(result["calculation"]["elevations"]), 1440)
                self.assertEqual(result["calculation"]["elevations"][0], -0.123456)

    def test_invalid_window_is_not_silently_used(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/"bad.npz"
            for step, value in [(0., 0.), (1/128, np.nan)]:
                np.savez(path, z=np.full((2, 2), value), lat0=0, lon0=0, step=step)
                with self.assertRaises(ValueError):
                    hz.load_window(path)


if __name__ == "__main__":
    unittest.main()
