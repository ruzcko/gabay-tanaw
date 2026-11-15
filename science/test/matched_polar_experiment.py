"""Independent Python terrain/daily builder for the isolated matched-terrain experiment."""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'science'))
import horizon as hz
from build_forecast import build_tables


def references(raw, out):
    points = []
    for name in ['polar-audit-points', 'polar-heldout-points']:
        points += json.loads((ROOT/f'app/computation/fixtures/{name}.json').read_text())['points']
    dem = hz.load_ldem(raw/'ldem_75s_240m.img')
    rows = []
    for p in points:
        fine = hz.fine_maps_near(raw/'pgda_5mpp', p['lat'], p['lon'])
        row = dict(point=p)
        for mode, maps in [('coarse', []), ('fine', fine)]:
            mask = hz.horizon(dem, p['lat'], p['lon'], height=2, range_km=150, step=.25, fine=maps)
            ground = float(hz.height_at(dem, np.array([p['lat']]), np.array([p['lon']]), maps)[0])
            row[mode] = dict(groundM=ground, mask=mask.tolist())
        rows.append(row)
        print(p['id'], flush=True)
    (out/'reference.json').write_text(json.dumps(rows))


def event_stats(a, b):
    used = set()
    errors = []
    for t in a:
        candidates = [(abs((t-u).total_seconds()), i) for i, u in enumerate(b) if i not in used]
        if candidates:
            gap, i = min(candidates)
            if gap < 86400:
                used.add(i)
                errors.append(gap)
    return dict(matched=len(errors), medianSeconds=float(np.median(errors)) if errors else None,
                maxSeconds=max(errors) if errors else None, extra=len(a)-len(used), missed=len(b)-len(used))


def compare(out):
    reference = json.loads((out/'reference.json').read_text())
    runs = {r['point']['id']: r for r in json.loads((out/'runs.json').read_text())}
    times = [datetime(2026,12,1,tzinfo=timezone.utc)+timedelta(minutes=10*i) for i in range(52561)]
    rows = []
    for r in reference:
        p, f = r['point'], r['fine']
        run = runs[p['id']]
        v = np.fromfile(out/'samples'/f"{p['id']}.bin", dtype='<f8').reshape(-1,8)
        if v.shape != (52561,8) or not np.isfinite(v).all():
            raise ValueError('Incomplete annual samples')
        tables = {body:(times,v[:,i],v[:,i+1],v[:,i+3]*3600,v[:,i+2]) for body,i in [('sun',0),('earth',4)]}
        h = dict(datum='sphere-1737400m',surfaceElevation=f['groundM'],observerHeight=2,step=1,
                 elevations=f['mask'][::4],calculation=dict(step=.25,elevations=f['mask']))
        index, _ = build_tables(dict(**p,name=p['id'],referenceFrame='MOON_ME_DE421'), h, tables, [], 'a'*64)
        row = dict(point=p, variants={})
        for mode in ['native','coarse','fine']:
            q = run[mode]
            if [d['date'] for d in q['days']] != [d['date'] for d in index['days']]:
                raise ValueError('Daily coverage mismatch')
            stats = dict(timings=q.get('timings'),groundM=q['groundM'])
            for body in ['sun','earth']:
                err = [abs(a[body+'Hours']-b[body+'Hours']) for a,b in zip(q['days'],index['days'])]
                stats[body] = dict(mean=float(np.mean(err)),max=max(err),daysOverHalfHour=sum(e>.5 for e in err))
            stats['events'] = {}
            for kind in ['sunrise','sunset','earthrise','earthset']:
                a=[datetime.fromisoformat(t) for d in q['days'] for t in d[kind]]
                b=[datetime.fromisoformat(t) for d in index['days'] for t in d[kind]]
                stats['events'][kind] = event_stats(a,b)
            if mode != 'native':
                stats['matchedPythonGroundErrorM'] = abs(q['groundM']-r[mode]['groundM'])
                stats['matchedPythonMaskMaxErrorDeg'] = float(np.max(np.abs(np.array(q['mask'])-r[mode]['mask'])))
            row['variants'][mode] = stats
        rows.append(row)
    result = dict(method='Fresh Python horizons and daily builder; shared DE440 ephemerides at Python fine-stack ground height. Model consistency, not measured ground truth.',
                  start='2026-12-01T00:00:00Z',end='2027-12-01T00:00:00Z',cadenceMinutes=10,rows=rows)
    (out/'comparison.json').write_text(json.dumps(result,indent=2)+'\n')
    for group in ['all','held-area','held-local']:
        subset=[r for r in rows if group=='all' or r['point']['group']==group]
        print(group,len(subset),{m:{b:float(np.mean([r['variants'][m][b]['mean'] for r in subset])) for b in ['sun','earth']} for m in ['native','coarse','fine']})


def illumination_check(out):
    from sunlight import illumination, sun_directions
    published={'connecting-ridge':88.,'connecting-ridge-extension':78.1,'shackleton-rim':85.5}
    sun=sun_directions()
    rows=[]
    for row in json.loads((out/'illumination-horizons.json').read_text()):
        p=row['point']
        values={mode:100*illumination(row[mode],p['lat'],p['lon'],sun)[0] for mode in ['native','coarse','fine']}
        rows.append(dict(id=p['id'],publishedPercent=published[p['id']],calculatedPercent=values))
    result=dict(method='Existing synthetic long-term visible-disc benchmark evaluated on fresh tiled horizons. Glaser 2018 published percentages; not annual dated centre visibility or surveyed ground truth.',rows=rows)
    (out/'illumination-comparison.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase',choices=['reference','compare','illumination'])
    parser.add_argument('--raw',type=Path)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    if args.phase=='reference':
        if not args.raw: parser.error('reference requires --raw')
        references(args.raw,args.out)
    elif args.phase=='compare': compare(args.out)
    else: illumination_check(args.out)
