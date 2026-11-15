"""Lossless experiment packaging, independent of the browser's sampler."""
import gzip
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prepare_polar_experiment import export_grid


class PolarTileTests(unittest.TestCase):
    def test_float_pixels_nan_and_cross_tile_edges_are_lossless(self):
        pixels = np.arange(258*259, dtype='<f4').reshape(258,259)/32
        pixels[255,256] = np.nan
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            g = export_grid(root, 'fine', pixels, -19000, -4000, 5, 1, 'source')
            rebuilt = np.zeros((512,512), dtype='<f4')
            first = {}
            for key, meta in g['tiles'].items():
                packed = (root/'fine'/f'{key}.bin.gz').read_bytes()
                raw = gzip.decompress(packed)
                self.assertEqual(hashlib.sha256(raw).hexdigest(), meta['sha256'])
                self.assertEqual(len(packed), meta['bytes'])
                r,c = map(int,key.split('-'))
                rebuilt[r*256:(r+1)*256,c*256:(c+1)*256] = np.frombuffer(raw,dtype='<f4').reshape(256,256)
                first[key] = packed
            self.assertEqual(rebuilt[:258,:259].tobytes(), pixels.tobytes())
            again = export_grid(root, 'fine', pixels, -19000, -4000, 5, 1, 'source')
            self.assertEqual(g,again)
            self.assertTrue(all((root/'fine'/f'{key}.bin.gz').read_bytes()==v for key,v in first.items()))

    def test_signed_half_metre_coarse_pixels_are_not_requantized(self):
        pixels = np.array([[-32768,-1],[0,32767]],dtype='<i2')
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            export_grid(root,'coarse',pixels,-240,240,240,.5,'source')
            raw=gzip.decompress((root/'coarse/0-0.bin.gz').read_bytes())
            actual=np.frombuffer(raw,dtype='<i2').reshape(256,256)[:2,:2]
            self.assertEqual(actual.tobytes(),pixels.tobytes())


if __name__=='__main__':
    unittest.main()
