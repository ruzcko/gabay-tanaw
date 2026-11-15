import sys
import json
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from landing_terrain import slope_from_heights, screen, footprint
from prepare_landing import validate_points
from jsonschema import Draft202012Validator, ValidationError


class LandingTerrainTest(unittest.TestCase):
    def test_plane(self):
        self.assertAlmostEqual(slope_from_heights([50, -50, 0, 0]), 45)
        self.assertEqual(slope_from_heights([12, 12, 12, 12]), 0)

    def test_missing_resolution_is_not_flat(self):
        self.assertIsNone(screen(0, 0, None)['slopeDeg'])
        self.assertIsNone(screen(-87.5, 10, None)['slopeDeg'])

    def test_nonfinite_and_poles_rejected(self):
        with self.assertRaises(ValueError):
            slope_from_heights([float('nan'), 0, 0, 0])
        with self.assertRaises(ValueError):
            screen(-90, 0, None)

    def test_spherical_footprint_at_longitude_seam(self):
        points = footprint(0, 0)
        self.assertAlmostEqual(points[0][0], 0)
        self.assertGreater(points[0][1], 0)
        self.assertGreater(points[1][1], 359)

    def test_preparation_requires_explicit_frames_and_safe_unique_ids(self):
        point = dict(id='test', name='Test', lat=-89, lon=-10,
                     referenceFrame='MOON_ME_DE421', elevationDatum='sphere-1737400m')
        self.assertEqual(validate_points([dict(point)])[0]['lon'], 350)
        for points in ([dict(point, id='../test')], [dict(point), dict(point)],
                       [dict(point, referenceFrame='IAU_MOON')], [dict(point, lat=float('nan'))]):
            with self.assertRaises(ValueError):
                validate_points(points)

    def test_schema_rejects_resolved_slopes_from_coarse_terrain(self):
        root = Path(__file__).resolve().parents[2]
        schema = json.loads((root / 'science/schemas/landing-terrain.schema.json').read_text())
        value = json.loads((root / 'app/data/landing-terrain.json').read_text())
        validator = Draft202012Validator(schema)
        validator.validate(value)
        row = next(row for row in value['rows'] if row['slopeDeg'] is not None)
        row['resolutionM'] = 240
        with self.assertRaises(ValidationError):
            validator.validate(value)
        row['slopeDeg'] = None
        validator.validate(value)
        row['baselineM'] = 200
        with self.assertRaises(ValidationError):
            validator.validate(value)


if __name__ == '__main__':
    unittest.main()
