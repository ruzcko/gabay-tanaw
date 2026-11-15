"""Coarse global display/exploration terrain. Reuses the authoritative horizon ray tracer.

Pinned LDEM16 product in DE421 mean-Earth, 1737400 m radial datum. This is ~1.9 km
at the equator, NOT the higher-resolution catalog horizon stack. No survey accuracy claim.
"""
import gzip
import json
from functools import lru_cache
from pathlib import Path

import numpy as np
import horizon as hz


class GlobalTerrain:
    def __init__(self, folder):
        self.folder = Path(folder)
        manifest = json.loads((self.folder / 'manifest.json').read_bytes())
        if (manifest.get('sourceSha256') != '45a2b32d56e81ed30db07fead8abc842b249b6511219d9ca2c53f81bc2dc5d62'
                or manifest.get('referenceFrame') != 'LOLA-ME' or manifest.get('radiusM') != hz.R
                or manifest.get('elevationDatum') != 'sphere-1737400m'):
            raise ValueError('Unreviewed global terrain product')

    @lru_cache(maxsize=128)
    def tile(self, row, col):
        raw = gzip.decompress((self.folder / '16' / f'{row}-{col}.bin.gz').read_bytes())
        if len(raw) != 160 * 160 * 2:
            raise ValueError('Invalid global terrain tile')
        return np.frombuffer(raw, dtype='<u2').reshape(160, 160).astype(float) / 2 - 10000

    def pixels(self, row, col):
        row = np.clip(row, 0, 2879); col = col % 5760
        keys = (row // 160) * 36 + col // 160
        out = np.empty(row.shape)
        for key in np.unique(keys):
            mask = keys == key
            out[mask] = self.tile(int(key // 36), int(key % 36))[row[mask] % 160, col[mask] % 160]
        return out

    def sample(self, lat, lon):
        lat, lon = np.broadcast_arrays(np.asarray(lat, float), np.asarray(lon, float))
        if not np.isfinite(lat).all() or not np.isfinite(lon).all() or (np.abs(lat) > 90).any():
            raise ValueError('Invalid terrain coordinates')
        x = ((lon + 180) % 360) * 16 - .5
        y = np.clip((90 - lat) * 16 - .5, 0, 2879)
        r, c = np.floor(y).astype(int), np.floor(x).astype(int)
        fr, fc = y - r, x - c
        return ((self.pixels(r, c) * (1 - fc) + self.pixels(r, c + 1) * fc) * (1 - fr)
                + (self.pixels(r + 1, c) * (1 - fc) + self.pixels(r + 1, c + 1) * fc) * fr)

    @lru_cache(maxsize=16)
    def profile(self, lat, lon):
        return float(self.sample(lat, lon)), hz.horizon(self, lat, lon, height=2., range_km=150., step=.25)

    def mesh(self, site):
        lat, lon = np.radians([site['latitudeDeg'], site['longitudeEastDeg']])
        up = np.array([np.cos(lat)*np.cos(lon), np.cos(lat)*np.sin(lon), np.sin(lat)])
        east = np.array([-np.sin(lon), np.cos(lon), 0.]); north = np.cross(up, east)
        axis = np.arange(-128, 129) * 78.125
        x, z = np.meshgrid(axis / hz.R, axis / hz.R)
        p = x[..., None]*east - z[..., None]*north + np.sqrt(1-x*x-z*z)[..., None]*up
        heights = self.sample(np.degrees(np.arcsin(p[..., 2])), np.degrees(np.arctan2(p[..., 1], p[..., 0])))
        return {'width': 257, 'height': 257, 'spacingM': 78.125, 'elevationsM': heights.astype(np.float32).ravel().tolist(),
                'metadata': {'projection': 'local-orthographic-east-south', 'latitudeDeg': site['latitudeDeg'],
                             'longitudeEastDeg': site['longitudeEastDeg'], 'radiusM': hz.R, 'referenceFrame': 'MOON_ME_DE421',
                             'elevationDatum': 'sphere-1737400m', 'noData': None, 'sourceResolutionM': 1900,
                             'source': 'NASA LOLA LDEM16 · coarse global exploration terrain', 'license': 'NASA public data with attribution'}}
