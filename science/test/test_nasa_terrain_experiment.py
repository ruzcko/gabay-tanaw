"""Checks for the isolated NASA terrain experiment, not a new production model."""
import unittest
import numpy as np
from nasa_terrain_experiment import profile, ExistingPatchesOverMosaic, Raster
import horizon as hz


class ConstantRaster:
    def __init__(self, height):
        self.height = height

    def sample(self, x, y):
        return np.full(np.shape(x), self.height)


class NasaTerrainExperimentTests(unittest.TestCase):
    def test_ordered_pixel_reads_preserve_bilinear_values_and_nan_cells(self):
        raster=Raster.__new__(Raster)
        raster.left,raster.top,raster.res=0,100,5
        raster.z=np.arange(400,dtype=np.float32).reshape(20,20);raster.z[3,4]=np.nan
        rng=np.random.default_rng(20261115)
        row,col=rng.uniform(0,19,1000),rng.uniform(0,19,1000)
        actual=raster.sample((col+.5)*5,100-(row+.5)*5)
        expected=hz.bilinear(raster.z,row,col)
        np.testing.assert_allclose(actual,expected,rtol=0,atol=2e-13,equal_nan=True)

    def test_reviewed_patch_precedes_mosaic_without_extrapolation(self):
        z = np.full((4,4), 7.)
        stack = ExistingPatchesOverMosaic(ConstantRaster(10),[(z,0,20,5)])
        np.testing.assert_array_equal(stack.sample(np.array([10.,30.]),np.array([10.,10.])),[7.,10.])
        z[:] = np.nan
        np.testing.assert_array_equal(stack.sample(np.array([10.]),np.array([10.])),[10.])

    def test_constant_terrain_has_expected_observer_height_and_dip(self):
        p = profile(ConstantRaster(100), None, dict(lat=-89.4, lon=222.8))
        expected = -np.degrees(np.arccos((hz.R+100)/(hz.R+102)))
        self.assertEqual(p['groundM'], 100)
        self.assertEqual(len(p['mask']), 1440)
        np.testing.assert_allclose(p['mask'], expected, atol=1e-6, rtol=0)

    def test_missing_mosaic_falls_back_to_regional_but_missing_regional_fails(self):
        p = dict(lat=-85.97, lon=357.67)
        a = profile(ConstantRaster(0), ConstantRaster(np.nan), p)
        b = profile(ConstantRaster(0), None, p)
        self.assertEqual(a, b)
        with self.assertRaisesRegex(ValueError, 'coverage missing'):
            profile(ConstantRaster(np.nan), None, p)


if __name__ == '__main__':
    unittest.main()
