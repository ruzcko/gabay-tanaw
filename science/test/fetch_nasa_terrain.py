"""Fetch the two original NASA rasters into ignored scratch storage, with resumable ranges.

Source/licence: app/SOURCES.md. No installed dependencies beyond Python's standard library.
These are source acquisition timings, not browser loading benchmarks.
"""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import time
import urllib.request

SOURCES = [
    ('ldem_87s_5mpp.tif','https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/87S/ldem_87s_5mpp.tif',3465285714,
     '417a85715406c346e2ecb2fc3abc93d3717121466e3d4950e1a6b977f207b881'),
    ('LDEM_80S_20MPP_ADJ.TIF','https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF',2696082051,
     '09b7ca80f9e6a146f970225d18af72fc02787669b3ef51b888e347d2b6845649'),
]
CHUNK = 8*1024*1024


def quality_at(out, lat, lon):
    import math
    import rasterio
    from rasterio.windows import Window
    rho=2*1737400*math.tan(math.pi/4+math.radians(lat)/2)
    x,y=rho*math.sin(math.radians(lon)),rho*math.cos(math.radians(lon))
    rows=[]
    for name in ['LDEM_80S_20MPP_ADJ_ERR.TIF','LDEM_80S_20MPP_ADJ_EFFRES.TIF']:
        url='https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/'+name
        with urllib.request.urlopen(urllib.request.Request(url,method='HEAD'),timeout=30) as response:
            identity={k:response.headers.get(k) for k in ['ETag','Last-Modified','Content-Length']}
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.TIF',GDAL_HTTP_TIMEOUT='30'):
            with rasterio.open(url) as src:
                r,c=src.index(x,y);value=float(src.read(1,window=Window(c,r,1,1))[0,0])
                if not math.isfinite(value):raise ValueError('Missing quality-map pixel')
                rows.append(dict(file=name,url=url,sourceIdentity=identity,lat=lat,lon=lon,row=r,column=c,
                                 valueMetres=value,method='Containing pixel, no spatial interpolation; model quality indicator, not field truth'))
    out.mkdir(parents=True,exist_ok=True)
    (out/'nobile-quality.json').write_text(json.dumps(rows,indent=2))
    return rows


def fetch(out, source):
    name,url,size,expected=source; folder=out/(name+'.parts');folder.mkdir(parents=True,exist_ok=True)
    start=time.perf_counter(); count=(size+CHUNK-1)//CHUNK
    resumed=sum(p.stat().st_size for p in folder.iterdir() if p.is_file())
    def part(i):
        a=i*CHUNK;b=min(size,a+CHUNK)-1;p=folder/str(i)
        if p.exists() and p.stat().st_size==b-a+1:return
        for retry in range(4):
            try:
                req=urllib.request.Request(url,headers={'Range':f'bytes={a}-{b}'})
                with urllib.request.urlopen(req,timeout=90) as r:
                    if r.status!=206 or r.headers['Content-Range']!=f'bytes {a}-{b}/{size}':
                        raise ValueError('Unexpected range response')
                    data=r.read()
                if len(data)!=b-a+1:raise ValueError('Incomplete range')
                p.write_bytes(data);return
            except Exception:
                if retry==3:raise
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        for n,_ in enumerate(pool.map(part,range(count)),1):
            if n%10==0:print(name,n,count,flush=True)
    target=out/name
    with target.open('wb') as f:
        for i in range(count):f.write((folder/str(i)).read_bytes())
    with target.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
    if digest!=expected:raise ValueError('NASA source differs from the tested version; review required')
    result=dict(file=name,url=url,bytes=size,sha256=digest,resumedBytes=resumed,seconds=time.perf_counter()-start)
    (out/(name+'.acquisition.json')).write_text(json.dumps(result,indent=2))
    return result


if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--out',type=Path,required=True)
    ap.add_argument('--quality-at',type=float,nargs=2,metavar=('LAT','LON'));args=ap.parse_args()
    root=Path(__file__).resolve().parents[2]
    if (root/'science'/'cache') not in args.out.resolve().parents:ap.error('Output must be inside repository science/cache/')
    if args.quality_at:print(json.dumps(quality_at(args.out,*args.quality_at)))
    else:
        for source in SOURCES:print(json.dumps(fetch(args.out,source)),flush=True)
