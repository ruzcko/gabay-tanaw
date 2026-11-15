"""Prepare display-only detail from the already pinned forecast terrain inputs.

Usage: python science/prepare_observer_detail.py --raw <forecast raw directory>
No forecast, ground-height contract or scientific horizon is changed.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np
import horizon as hz

ROOT = Path(__file__).resolve().parents[1]
PINS = {p['name']: p for p in json.loads((ROOT / 'science/terrain-inputs-30.json').read_bytes())}


def verified(path):
    raw = path.read_bytes()
    pin = PINS[path.name]
    if len(raw) != pin['bytes'] or hashlib.sha256(raw).hexdigest() != pin['sha256']:
        raise ValueError(f'Pinned terrain input does not match: {path.name}')
    return raw


def prepare(raw_dir):
    sites = json.loads((ROOT / 'app/data/sites.json').read_bytes())
    polar = verified(raw_dir / 'ldem_60s_240m.img')
    windows = [(s, raw_dir / 'sldem2015' / f"{s['id']}.npz") for s in sites]
    windows = [(s, p) for s, p in windows if p.name in PINS]
    windows += [(s,raw_dir / 'ldem_60s_240m.img') for s in sites
                if -75 < s['lat'] < -60 and not any(s['id']==other['id'] for other,_ in windows)]
    for _, path in windows:
        verified(path)
    # Preserve every signed half-metre source sample, padding only the outer tile edges.
    target = ROOT / 'app/assets/observer/terrain/polar240'
    target.mkdir(parents=True, exist_ok=True)
    source = np.frombuffer(polar, dtype='<i2').reshape(7760, 7760)
    files = {}
    for row in range(16):
        for col in range(16):
            tile = source[row*512:(row+1)*512, col*512:(col+1)*512]
            tile = np.pad(tile, ((0,512-tile.shape[0]),(0,512-tile.shape[1])), mode='edge')
            payload = gzip.compress(tile.astype('<i2').tobytes(), compresslevel=9, mtime=0)
            name = f'{row}-{col}.bin.gz'
            (target / name).write_bytes(payload)
            files[name] = {'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}
    manifest = dict(product='LDEM_60S_240M', width=7760, tileSize=512, spacingM=240,
                    centerPixel=3879.5, scaleM=.5, encoding='int16-le', radiusM=1737400,
                    referenceFrame='MOON_ME_DE421', elevationDatum='sphere-1737400m',
                    projection='south-polar-stereographic', coverageLatitudeMax=-60,
                    source='https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_60s_240m.lbl',
                    sourceSha256=PINS['ldem_60s_240m.img']['sha256'],
                    license='NASA public-domain data; credit NASA/GSFC/LOLA', files=files)
    (target / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    # Small catalog patches retain the source's true ~237 m resolution, not invented detail.
    target = ROOT / 'app/assets/observer/terrain/catalog'
    target.mkdir(parents=True, exist_ok=True)
    index = {'sites': {}}
    axis = np.arange(-128,129)*78.125
    x,z = np.meshgrid(axis/hz.R,axis/hz.R)
    for site,path in windows:
        lat,lon = np.radians([site['lat'],site['lon']])
        up = np.array([np.cos(lat)*np.cos(lon),np.cos(lat)*np.sin(lon),np.sin(lat)])
        east = np.array([-np.sin(lon),np.cos(lon),0.])
        p = x[...,None]*east-z[...,None]*np.cross(up,east)+np.sqrt(1-x*x-z*z)[...,None]*up
        is_window = path.suffix == '.npz'
        dem = hz.load_window(path) if is_window else hz.load_ldem(path)
        heights = hz.height_at(dem,np.degrees(np.arcsin(p[...,2])),np.degrees(np.arctan2(p[...,1],p[...,0])))
        # Match the established saved mesh's rounded catalog-center contract.
        heights[128,128] = site['surfaceElevationM']
        name = f"{site['id']}.bin"
        payload = heights.astype('<f4').tobytes()
        (target / name).write_bytes(payload)
        index['sites'][site['id']] = dict(file=name,width=257,height=257,spacingM=78.125,
            sha256=hashlib.sha256(payload).hexdigest(),sourceSha256=PINS[path.name]['sha256'],
            metadata=dict(projection='local-orthographic-east-south',latitudeDeg=site['lat'],
                longitudeEastDeg=site['lon']-360 if site['lon']>180 else site['lon'],radiusM=int(hz.R),
                referenceFrame=site['referenceFrame'],elevationDatum=site['elevationDatum'],noData=None,
                sourceResolutionM=np.pi*hz.R/(180*128) if is_window else 240,
                source='SLDEM2015 LOLA / Kaguya, 128 pixels/degree' if is_window else 'NASA LOLA LDEM_60S_240M (240 m grid)',
                license='NASA PDS public data; credit LOLA / SELENE and Barker et al. 2016' if is_window else 'NASA public-domain data; credit NASA/GSFC/LOLA'))
    (target / 'index.json').write_text(json.dumps(index,indent=2)+'\n')
    print(f'Prepared 256 polar tiles ({sum(f["bytes"] for f in files.values())} bytes) and {len(windows)} catalog meshes.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw',type=Path,required=True)
    prepare(parser.parse_args().raw)
