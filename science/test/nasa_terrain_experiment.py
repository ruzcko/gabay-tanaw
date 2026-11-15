"""Isolated NASA map comparison. Never writes application data or changes horizon.py."""
import argparse
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import json
from pathlib import Path
import sys
import time

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'science'))
import horizon as hz
from build_forecast import build_tables
from sunlight import illumination, sun_directions
from matched_polar_experiment import event_stats


class Raster:
    def __init__(self, path):
        import rasterio
        self.path = path
        with path.open('rb') as f:
            self.sha = hashlib.file_digest(f, 'sha256').hexdigest()
        with rasterio.open(path) as src:
            assert src.res[0] == src.res[1] and not src.transform.b and not src.transform.d
            crs = src.crs.to_dict()
            assert crs['R'] == hz.R and crs['lat_0'] == -90 and crs['lon_0'] == 0
            assert src.scales == (1.,) and src.offsets == (0.,)
            self.left, self.top, self.res = src.bounds.left, src.bounds.top, src.res[0]
            decoded = path.with_suffix('.npy')
            pin = path.with_suffix('.decoded-sha256')
            if decoded.exists() and (not pin.exists() or pin.read_text() != self.sha):
                raise ValueError('Decoded scratch cache lacks matching source identity')
            if not decoded.exists():
                a = np.lib.format.open_memmap(decoded, mode='w+', dtype='<f4', shape=(src.height, src.width))
                for r in range(0, src.height, 256):
                    a[r:r+256] = src.read(1, window=rasterio.windows.Window(0, r, src.width, min(256, src.height-r)))
                a.flush(); del a
                pin.write_text(self.sha)
            self.z = np.load(decoded, mmap_mode='r')
            assert self.z.shape == (src.height, src.width)

    def sample(self, x, y):
        row, col = (self.top-y)/self.res-.5, (x-self.left)/self.res-.5
        inside = (row >= 0) & (col >= 0) & (row <= self.z.shape[0]-1) & (col <= self.z.shape[1]-1)
        out = np.full(np.shape(x), np.nan)
        rr,cc=row[inside],col[inside]
        r0=np.clip(np.floor(rr).astype(int),0,self.z.shape[0]-2)
        c0=np.clip(np.floor(cc).astype(int),0,self.z.shape[1]-2)
        fr,fc=rr-r0,cc-c0;cols=self.z.shape[1];base=r0*cols+c0
        # Read disk-backed pixels once in file order, then restore ray order.
        # No downsampling, interpolation change or discarded ray samples.
        unique,inverse=np.unique(base,return_inverse=True)
        flat=self.z.reshape(-1)
        a,b,c,d=[flat[unique+offset][inverse] for offset in [0,1,cols,cols+1]]
        out[inside]=((a*(1-fc)+b*fc)*(1-fr)+(c*(1-fc)+d*fc)*fr)
        return out


class ExistingPatchesOverMosaic:
    def __init__(self, mosaic, patches):
        self.mosaic, self.patches = mosaic, patches

    def sample(self, x, y):
        out = self.mosaic.sample(x, y)
        todo = np.ones(np.shape(x), bool)
        for z, left, top, res in self.patches:
            row, col = (top-y)/res-.5, (x-left)/res-.5
            inside = todo & (row>=0) & (col>=0) & (row<=z.shape[0]-1) & (col<=z.shape[1]-1)
            v = hz.bilinear(z,row[inside],col[inside]); good = np.isfinite(v)
            idx = tuple(i[good] for i in np.nonzero(inside))
            out[idx] = v[good];todo[idx] = False
        return out


def profile(regional, mosaic, p, near_step=5, far_step=60):
    # Match the established fine-stack sampling policy: 5 m to 23 km, then 60 m.
    distances = np.r_[np.arange(near_step, 23000, near_step), np.arange(23000, 150001, far_step), 150020.]
    def heights(lat, lon, near):
        x, y = hz.to_xy(lat, lon)
        z = regional.sample(x, y)
        if mosaic is not None:
            fine = mosaic.sample(x, y)
            use = np.isfinite(fine)
            z[use] = fine[use]
        if not np.isfinite(z).all():
            raise ValueError('Terrain coverage missing; no smooth fallback')
        return z
    lat, lon = p['lat'], p['lon']
    ground = float(heights(np.array([lat]), np.array([lon]), np.array([True]))[0])
    d = distances[None, :]/hz.R
    p1, l1 = np.radians(lat), np.radians(lon)
    mask = []
    batch = 1440 if far_step==60 else 180
    for start in range(0, 1440, batch):
        az = np.radians(np.arange(start, min(start+batch, 1440))*.25)[:, None]
        p2 = np.arcsin(np.clip(np.sin(p1)*np.cos(d)+np.cos(p1)*np.sin(d)*np.cos(az), -1, 1))
        l2 = l1+np.arctan2(np.sin(az)*np.sin(d)*np.cos(p1), np.cos(d)-np.sin(p1)*np.sin(p2))
        z = heights(np.degrees(p2), np.degrees(l2), np.broadcast_to(distances < 23000, p2.shape))
        target = hz.R+z
        angles = np.degrees(np.arctan2(target*np.cos(d)-(hz.R+ground+2), target*np.sin(d)))
        mask.extend(angles.max(axis=1).tolist())
    return dict(groundM=ground, mask=mask)


def prepare(args):
    old = json.loads((ROOT/'app/computation/matched-polar-results.json').read_text())['accuracy']['rows']
    chosen = [r['point'] for r in old if any(r['variants']['coarse'][b]['mean'] > r['variants']['native'][b]['mean'] for b in ['sun','earth'])]
    catalog = json.loads((ROOT/'app/data/sites.json').read_text())
    chosen += [p for p in catalog if p['id'] in ['connecting-ridge','connecting-ridge-extension','shackleton-rim']]
    reg, fine = Raster(args.out/'raw/LDEM_80S_20MPP_ADJ.TIF'), Raster(args.out/'raw/ldem_87s_5mpp.tif')
    sources = [dict(file=r.path.name,sha256=r.sha,spacingM=r.res,bytes=r.path.stat().st_size) for r in [reg,fine]]
    for pin in json.loads((ROOT/'science/terrain-inputs-30.json').read_text()):
        if pin['name'].endswith('.tif'):
            path=args.fine/pin['name']
            with path.open('rb') as f: digest=hashlib.file_digest(f,'sha256').hexdigest()
            if digest!=pin['sha256']:raise ValueError('Reviewed fine-map hash mismatch')
            sources.append(dict(file=pin['name'],sha256=digest,bytes=path.stat().st_size,spacingM=5))
    (args.out/'sources.json').write_text(json.dumps(sources,indent=2))
    refs = {r['point']['id']:r['fine'] for r in json.loads((args.previous/'reference.json').read_text())}
    rows = []
    for p in chosen:
        row = dict(point=p,variants={})
        patches = hz.fine_maps_near(args.fine, p['lat'], p['lon'])
        stacked = ExistingPatchesOverMosaic(fine, patches)
        for mode, mosaic in [('regional20',None),('mosaic5-regional20',fine),('sites5-mosaic5-regional20',stacked)]:
            t = time.perf_counter(); result = profile(reg,mosaic,p)
            result['horizonSeconds'] = time.perf_counter()-t
            result['warmHorizonSeconds'] = None
            if p['id'] in ['connecting-ridge-offset-1','held-malapert-massif-0','nobile-rim-1-offset-0']:
                t = time.perf_counter(); again = profile(reg,mosaic,p)
                result['warmHorizonSeconds'] = time.perf_counter()-t
                assert result['groundM'] == again['groundM'] and result['mask'] == again['mask']
            row['variants'][mode] = result
            print(p['id'],mode,result['horizonSeconds'],flush=True)
        if p['id'] in ['connecting-ridge','connecting-ridge-extension','shackleton-rim']:
            t = time.perf_counter()
            dense = profile(reg,fine,p,far_step=5)
            row['farRayConvergence'] = dict(seconds=time.perf_counter()-t,
                maxMaskDifferenceDeg=float(np.max(np.abs(np.array(dense['mask'])-row['variants']['mosaic5-regional20']['mask']))),
                denseMask=dense['mask'])
        if p['id'] in refs:
            row['reference'] = refs[p['id']]
        else:
            h = json.loads((ROOT/f"app/data/horizons/{p['id']}.json").read_text())
            row['reference'] = dict(groundM=h['surfaceElevation'],mask=h['calculation']['elevations'])
        rows.append(row)
        (args.out/'horizons.json').write_text(json.dumps(rows))
        print(p['id'], {m:round(v['horizonSeconds'],3) for m,v in row['variants'].items()},flush=True)
    seams = json.loads((args.previous/'seams.json').read_text())
    for probe in seams:
        probe['new']={}
        for key in ['a','b']:
            p=probe[key];x,y=hz.to_xy(np.array([p['lat']]),np.array([p['lon']]))
            patches=hz.fine_maps_near(args.fine,p['lat'],p['lon'])
            v=ExistingPatchesOverMosaic(fine,patches).sample(x,y)
            if not np.isfinite(v[0]):v=reg.sample(x,y)
            if not np.isfinite(v[0]):raise ValueError('Missing seam coverage')
            probe['new'][key]=float(v[0])
    (args.out/'seams.json').write_text(json.dumps(seams,indent=2))


def compare(args):
    refs = json.loads((args.out/'horizons.json').read_text())
    runs = {r['point']['id']:r for r in json.loads((args.out/'runs.json').read_text())}
    previous = {r['point']['id']:r for r in json.loads((args.previous/'runs.json').read_text())}
    times = [datetime(2026,12,1,tzinfo=timezone.utc)+timedelta(minutes=10*i) for i in range(52561)]
    sun = sun_directions(); rows = []
    published = {'connecting-ridge':88.,'connecting-ridge-extension':78.1,'shackleton-rim':85.5}
    for ref in refs:
        p=ref['point']; run=runs[p['id']]; row=dict(point=p,variants={})
        reference=run['reference']['days']
        if p['id'] in previous:
            assert all(a[b+'Hours']==c[b+'Hours'] for a,c in zip(reference,previous[p['id']]['fine']['days']) for b in ['sun','earth'])
        if 'farRayConvergence' in ref:
            convergence = ref['farRayConvergence']
            row['farRayConvergence'] = {k:v for k,v in convergence.items() if k!='denseMask'}
            row['farRayConvergence']['denseDiscPercent'] = 100*illumination(convergence['denseMask'],p['lat'],p['lon'],sun)[0]
        for mode in ['regional20','mosaic5-regional20','sites5-mosaic5-regional20']:
            q=run[mode]; h=ref['variants'][mode]
            v=np.fromfile(args.out/'samples'/f"{p['id']}-{mode}.bin",dtype='<f8').reshape(-1,8)
            assert v.shape==(52561,8) and np.isfinite(v).all()
            tables={b:(times,v[:,i],v[:,i+1],v[:,i+3]*3600,v[:,i+2]) for b,i in [('sun',0),('earth',4)]}
            horizon=dict(datum='sphere-1737400m',surfaceElevation=h['groundM'],observerHeight=2,step=1,
                         elevations=h['mask'][::4],calculation=dict(step=.25,elevations=h['mask']))
            index,_=build_tables(dict(**p,name=p.get('name',p['id']),referenceFrame='MOON_ME_DE421') if 'referenceFrame' not in p else p,horizon,tables,[],'a'*64)
            assert len(index['days'])==365
            assert [d['date'] for d in index['days']] == [d['date'] for d in q['days']]
            parity=max(abs(a[b+'Hours']-c[b+'Hours']) for a,c in zip(index['days'],q['days']) for b in ['sun','earth'])
            assert parity==0, (p['id'],mode,parity)
            stats={k:h[k] for k in ['groundM','horizonSeconds','warmHorizonSeconds']}
            stats.update(q['timings']);stats['pythonDailyMaxDifferenceHours']=parity
            stats['pythonEvents']={k:event_stats([datetime.fromisoformat(t) for d in q['days'] for t in d[k]],
                                               [datetime.fromisoformat(t) for d in index['days'] for t in d[k]]) for k in ['sunrise','sunset','earthrise','earthset']}
            assert all(v['extra']==0 and v['missed']==0 and (v['maxSeconds'] or 0)<=1 for v in stats['pythonEvents'].values())
            stats['groundChangeM']=h['groundM']-ref['reference']['groundM']
            stats['maskMaxChangeDeg']=float(np.max(np.abs(np.array(h['mask'])-ref['reference']['mask'])))
            for body in ['sun','earth']:
                err=[abs(a[body+'Hours']-b[body+'Hours']) for a,b in zip(q['days'],reference)]
                stats[body]=dict(mean=float(np.mean(err)),max=max(err))
            stats['events']={k:event_stats([datetime.fromisoformat(t) for d in q['days'] for t in d[k]],
                                          [datetime.fromisoformat(t) for d in reference for t in d[k]]) for k in ['sunrise','sunset','earthrise','earthset']}
            if p['id'] in published:
                stats['discPercent']=100*illumination(h['mask'],p['lat'],p['lon'],sun)[0]
                stats['publishedDiscPercent']=published[p['id']]
            payload=json.dumps(horizon,separators=(',',':')).encode()
            (args.out/f"{p['id']}-{mode}-horizon.json.gz").write_bytes(gzip.compress(payload,mtime=0))
            stats['profileGzipBytes']=len(gzip.compress(payload,mtime=0))
            row['variants'][mode]=stats
        if p['id'] in previous:
            row['earlierErrors']={}
            for mode in ['native','coarse']:
                row['earlierErrors'][mode]={b:float(np.mean([abs(a[b+'Hours']-c[b+'Hours']) for a,c in zip(previous[p['id']][mode]['days'],reference)])) for b in ['sun','earth']}
        rows.append(row)
    (args.out/'results.json').write_text(json.dumps(dict(method='New maps versus previous fine-stack model; shared DE440 at each map ground+2m. Not surveyed ground truth.',
        sources=json.loads((args.out/'sources.json').read_text()),seams=json.loads((args.out/'seams.json').read_text()),rows=rows),indent=2))
    print('Compared',len(rows),'annual windows')


if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('phase',choices=['prepare','compare']);ap.add_argument('--out',type=Path,required=True)
    ap.add_argument('--previous',type=Path,required=True);ap.add_argument('--fine',type=Path);args=ap.parse_args()
    if args.phase=='prepare' and not args.fine:ap.error('prepare requires the reviewed --fine patch folder')
    if (ROOT/'app') in args.out.resolve().parents:ap.error('Use ignored scratch output outside app')
    prepare(args) if args.phase=='prepare' else compare(args)
