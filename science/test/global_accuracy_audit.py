"""Offline global random-point audit. Keep all generated products in explicit scratch output."""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import sys
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'science'))
import horizon as hz
from observer_terrain import GlobalTerrain
from build_forecast import build_tables
from earth_accuracy import FRAME, separation
from observer_appearance import load_kernels, local_basis
from matched_polar_experiment import event_stats


def verify_inputs(args):
    pins=json.loads((ROOT/'science/terrain-inputs-30.json').read_text())
    names={'ldem_75s_240m.img','ldem_60s_240m.img','Site01.tif','Site04.tif','Site07.tif','Site11.tif','Site20.tif','Site23.tif','SL3.tif'}
    points=json.loads((ROOT/'app/computation/fixtures/global-audit-points.json').read_text())['points']
    names.update(p['window']+'.npz' for p in points if p.get('window'))
    records=[]
    for pin in pins:
        name=pin['name']
        if name not in names:continue
        if name.endswith('.npz'):path=args.regional/'sldem2015'/name
        elif name.endswith('.tif'):path=args.south/'pgda_5mpp'/name
        elif name=='ldem_60s_240m.img':path=args.regional/name
        else:path=args.south/name
        if hashlib.sha256(path.read_bytes()).hexdigest()!=pin['sha256']:raise ValueError(f'Changed reviewed terrain: {name}')
        records.append(pin)
    if {r['name'] for r in records}!=names:raise ValueError('Missing terrain provenance pin')
    (args.out/'terrain-inputs.json').write_text(json.dumps(records,indent=2)+'\n')
    return records


def reference(args):
    verify_inputs(args)
    points=json.loads((ROOT/'app/computation/fixtures/global-audit-points.json').read_text())['points']
    global_dem=GlobalTerrain(ROOT/'app/assets/observer/terrain')
    south=hz.load_ldem(args.south/'ldem_75s_240m.img')
    regional=hz.load_ldem(args.regional/'ldem_60s_240m.img')
    rows=[]
    for p in points:
        fine=[]
        if p.get('window'):
            path=args.regional/'sldem2015'/f"{p['window']}.npz"
            dem=hz.load_window(path);kind='SLDEM2015';meaning='different-finer-terrain'
        elif p['lat']<=-80:
            path=args.south/'ldem_75s_240m.img';dem=south
            fine=hz.fine_maps_near(args.south/'pgda_5mpp',p['lat'],p['lon'])
            kind='LOLA75S240m+PGDA5m' if fine else 'LOLA75S240m';meaning='different-terrain'
        elif p['lat']<=-65:
            path=args.regional/'ldem_60s_240m.img';dem=regional;kind='LOLA60S240m';meaning='different-finer-terrain'
        else:
            path=ROOT/'app/assets/observer/terrain/manifest.json';dem=global_dem;kind='LDEM16';meaning='same-terrain-consistency-only'
        mask=hz.horizon(dem,p['lat'],p['lon'],height=2,range_km=150,step=.25,fine=fine)
        ground=float(hz.height_at(dem,np.array([p['lat']]),np.array([p['lon']]),fine)[0])
        rows.append(dict(point=p,source=kind,interpretation=meaning,sourceFile=path.name,
                         sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest(),groundM=ground,mask=mask.tolist()))
        (args.out/'progress.txt').write_text(f"Python terrain {len(rows)}/{len(points)}: {p['id']}\n")
    (args.out/'reference.json').write_text(json.dumps(rows))


def compare(args):
    import spiceypy as sp
    kernels=load_kernels(args.kernels)
    refs=json.loads((args.out/'reference.json').read_text())
    runs={r['point']['id']:r for r in json.loads((args.out/'runs.json').read_text())}
    times=[datetime(2026,12,1,tzinfo=timezone.utc)+timedelta(minutes=i*10) for i in range(52561)]
    rows=[]
    for ref in refs:
        p=ref['point'];q=runs[p['id']]
        v=np.fromfile(args.out/'samples'/f"{p['id']}.bin",dtype='<f8').reshape(-1,8)
        if v.shape!=(52561,8) or not np.isfinite(v).all():raise ValueError('Invalid annual sample coverage')
        tables={b:(times,v[:,i],v[:,i+1],v[:,i+3]*3600,v[:,i+2]) for b,i in [('sun',0),('earth',4)]}
        h=dict(datum='sphere-1737400m',surfaceElevation=ref['groundM'],observerHeight=2,step=1,
               elevations=ref['mask'][::4],calculation=dict(step=.25,elevations=ref['mask']))
        index,_=build_tables(dict(**p,name=p['id'],referenceFrame='MOON_ME_DE421'),h,tables,[],'a'*64)
        if [d['date'] for d in q['days']] != [d['date'] for d in index['days']]:raise ValueError('Mismatched days')
        row={k:ref[k] for k in ['point','source','interpretation','sourceFile','sourceSha256']}
        row['groundDifferenceM']=q['groundM']-ref['groundM']
        row['horizonMaxDifferenceDeg']=float(np.max(np.abs(np.array(q['mask'])-ref['mask'])))
        for body in ['sun','earth']:
            errors=[abs(a[body+'Hours']-b[body+'Hours']) for a,b in zip(q['days'],index['days'])]
            row[body]=dict(meanHours=float(np.mean(errors)),maxHours=max(errors),daysOverHalfHour=sum(e>.5 for e in errors))
        row['events']={}
        for kind in ['sunrise','sunset','earthrise','earthset']:
            a=[datetime.fromisoformat(t) for d in q['days'] for t in d[kind]]
            b=[datetime.fromisoformat(t) for d in index['days'] for t in d[kind]]
            row['events'][kind]=event_stats(a,b)
        basis=local_basis(p['lat'],p['lon']);observer=basis[1]*(1737.4+(q['groundM']+2)/1000)
        directions={b:[] for b in ['sun','earth']};ranges={b:[] for b in ['sun','earth']}
        for sample in q['checkSamples']:
            et=sp.str2et(sample['utc'])
            for body,i in [('sun',0),('earth',4)]:
                state,_=sp.spkcpo(body.upper(),et,FRAME,'OBSERVER','CN+S',observer,'MOON',FRAME)
                vec=basis@state[:3];az=math.degrees(math.atan2(vec[0],-vec[2]))%360
                el=math.degrees(math.atan2(vec[1],math.hypot(vec[0],vec[2])))
                directions[body].append(separation(az,el,*sample['values'][i:i+2]))
                ranges[body].append(abs(float(np.linalg.norm(vec))-sample['values'][i+2]))
        row['independent']={body:dict(samples=len(directions[body]),meanDirectionDeg=float(np.mean(directions[body])),
                                     maxDirectionDeg=max(directions[body]),maxRangeKm=max(ranges[body])) for body in directions}
        row['longitudeWrapEqual']=q.get('longitudeWrapEqual')
        row['centralFarSideEarthInvisible']=True if q.get('centralFarSide') else None
        rows.append(row)
        (args.out/'progress.txt').write_text(f"Comparison {len(rows)}/{len(refs)}: {p['id']}\n")
    report=dict(window=dict(start='2026-12-01T00:00:00Z',end='2027-12-01T00:00:00Z'),cadenceMinutes=10,
                method='Independent Python terrain and daily builder, shared DE440 ephemerides at reference ground. Separate CSPICE CN+S checks at quick ground+2m; CSPICE check omits gravitational deflection. No measured-ground-truth claim.',
                kernels=kernels,terrainInputs=json.loads((args.out/'terrain-inputs.json').read_text()),rows=rows)
    (args.out/'results.json').write_text(json.dumps(report,indent=2)+'\n')
    print('Completed',len(rows),'points')


if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('phase',choices=['reference','compare','verify-inputs'])
    ap.add_argument('--out',type=Path,required=True)
    ap.add_argument('--south',type=Path)
    ap.add_argument('--regional',type=Path)
    ap.add_argument('--kernels',type=Path)
    args=ap.parse_args();args.out.mkdir(parents=True,exist_ok=True)
    if args.phase in ['reference','verify-inputs']:
        if not args.south or not args.regional:ap.error('reference requires --south and --regional raw folders')
        reference(args) if args.phase=='reference' else verify_inputs(args)
    else:
        if not args.kernels:ap.error('compare requires --kernels')
        compare(args)
