"""Date-dependent display inputs, kept separate from Horizons apparent observations.

Uses the pinned kernels and DE421-aligned frame already used by earth_accuracy.py.
Hipparcos ICRS positions retain epoch J1991.25: no proper motion/parallax/aberration.
"""
import hashlib
from pathlib import Path
import numpy as np
import spiceypy as spice
from earth_accuracy import FRAME
from fetch_validation_kernels import FILES

MOON_RENDER = np.array([[1., 0, 0], [0, 0, 1.], [0, -1., 0]])


def load_kernels(folder):
    records = []
    for name, expected in FILES.items():
        path = Path(folder) / Path(name).name
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f'Unverified kernel: {path.name}')
        spice.furnsh(str(path.resolve()))
        records.append({'file': path.name, 'sha256': expected})
    path = Path(__file__).with_name('kernels') / 'pck00011.tpc'
    expected = '3dff7b1dbeceaa01f25467767d3fa25816051c85d162d1edf04acb310ee28bb1'
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise ValueError('Unverified Earth display orientation kernel')
    spice.furnsh(str(path.resolve()))
    records.append({'file': path.name, 'sha256': expected})
    return records


def local_basis(lat, lon):
    a, b = np.radians([lat, lon])
    up = np.array([np.cos(a)*np.cos(b), np.cos(a)*np.sin(b), np.sin(a)])
    east = np.array([-np.sin(b), np.cos(b), 0.])
    return np.stack([east, up, -np.cross(up, east)])


def quaternion(matrix):
    q = spice.m2q(matrix.copy())  # CSPICE scalar first -> renderer x,y,z,w
    return [float(q[1]), float(q[2]), float(q[3]), float(q[0])]


def unit(vector):
    return (vector / np.linalg.norm(vector)).tolist()


def appearance(site, utc):
    et = spice.str2et(utc)
    basis = local_basis(site['latitudeDeg'], site['longitudeEastDeg'])
    observer = basis[1] * (1737.4 + (site['surfaceElevationM'] + site['observerHeightM']) / 1000)
    sun, _ = spice.spkpos('SUN', et, FRAME, 'NONE', 'MOON')
    earth, _ = spice.spkpos('EARTH', et, FRAME, 'NONE', 'MOON')
    earth_to_moon = spice.pxform('IAU_EARTH', FRAME, et)
    return {
        'lighting': {'sunDirectionLocal': unit(basis @ (sun - observer))},
        'earthAppearance': {'bodyFrame': 'earth-fixed-x0-yNorth-zWest',
                            'bodyToLocal': quaternion(basis @ earth_to_moon @ MOON_RENDER.T),
                            'sunDirectionBody': unit(MOON_RENDER @ earth_to_moon.T @ (sun-earth)),
                            'model': 'IAU_EARTH low-accuracy display orientation; geometric illumination; static Blue Marble mosaic'},
        'sky': {'catalogFrame': 'ICRS-J1991.25', 'catalogToLocal': quaternion(basis @ spice.pxform('J2000', FRAME, et)),
                'model': 'DE440 lunar orientation; fixed Hipparcos J1991.25 catalog; no proper motion or aberration'},
        'overview': {'axisConvention': 'x0-yNorth-zWest', 'moonRadiusM': 1737400,
                     'siteDirectionMoon': (MOON_RENDER @ basis[1]).tolist(),
                     'sunDirectionMoon': unit(MOON_RENDER @ sun), 'earthDirectionMoon': unit(MOON_RENDER @ earth),
                     'moonToLocal': quaternion(basis @ MOON_RENDER.T)}
    }
