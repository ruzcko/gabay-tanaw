import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {gunzip,sha256} from '../src/quick/coefficients.ts';
import {decodeTerrainDelta} from '../src/quick/terrain-codec.ts';
import {Terrain,traceHorizon} from '../src/quick/terrain.ts';

const base=new URL('../../assets/observer/terrain/',import.meta.url);
const read=async(url:URL)=>{const b=await readFile(url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length) as ArrayBuffer;};

test('lossless terrain decoder preserves signed extremes, wraparound and row resets',()=>{
  const values=[-32768,32767,-1,0,32767,-32768,0,-1,0,0,0,0,1,32767,-32768,-1];
  const encoded=new Uint8Array(32);
  values.forEach((value,i)=>{
    const delta=(value-(i%4?values[i-1]:0))&65535;
    encoded[i]=delta&255;encoded[16+i]=delta>>>8;
  });
  assert.deepEqual([...new Int16Array(decodeTerrainDelta(encoded.buffer,4))],values);
  assert.throws(()=>decodeTerrainDelta(new ArrayBuffer(12),4),/encoded terrain length/);
});

test('every packed polar tile decodes byte-for-byte to the original shipped source',async t=>{
  const manifest=JSON.parse(await readFile(new URL('polar20-delta-v1/manifest.json',base),'utf8'));
  const names=Object.keys(manifest.files).sort();
  assert.equal(names.length,225);
  assert.deepEqual((await readdir(new URL('polar20-delta-v1/',base))).sort(),[...names,'manifest.json'].sort());
  let before=0,after=0;
  for(const name of names) {
    const original=await read(new URL(`polar20/${name}`,base)),packed=await read(new URL(`polar20-delta-v1/${name}`,base));
    const decoded=decodeTerrainDelta(await gunzip(packed));
    assert.deepEqual(new Uint8Array(decoded),new Uint8Array(await gunzip(original)),name);
    assert.equal(await sha256(decoded),manifest.files[name].decodedSha256,name);
    assert.equal(packed.byteLength,manifest.files[name].bytes,name);
    before+=original.byteLength;after+=packed.byteLength;
  }
  assert.ok(after<before*.65,'Lossless terrain transport saves at least 35%');
  t.diagnostic(JSON.stringify({allOriginalBytes:before,allPackedBytes:after}));
});

test('optimized horizons exactly match pre-change hashes at poles, coverage edges and longitude seams',async t=>{
  const reference=JSON.parse(await readFile(new URL('../fixtures/terrain-horizon-reference.json',import.meta.url),'utf8'));
  const terrain=new Terrain(read);
  for(const point of reference.points) {
    const before=terrain.bytesLoaded,start=performance.now();
    await terrain.prepare(point.lat,point.lon);
    const loaded=performance.now(),horizon=await traceHorizon(terrain,point.lat,point.lon);
    assert.equal(horizon.surfaceElevation,point.surfaceElevation);
    assert.equal(horizon.sha256,point.sha256,`${point.lat}, ${point.lon}: every Float64 horizon value must match`);
    assert.equal(horizon.calculation.elevations.length,1440);
    assert.equal(horizon.rangeKm,150);
    if(point.lat===-89.44)assert.ok(terrain.bytesLoaded-before<58625972*.65,'Cold polar request saves at least 35%');
    if(point.lat===-89.45)assert.equal(terrain.bytesLoaded-before,0,'Nearby clicks reuse decoded tiles');
    t.diagnostic(JSON.stringify({lat:point.lat,lon:point.lon,terrainBytes:terrain.bytesLoaded-before,
      loadMs:Math.round(loaded-start),horizonMs:Math.round(performance.now()-loaded)}));
  }
});

test('missing, truncated or corrupted lossless terrain fails closed',async()=>{
  const signal=new AbortController();signal.abort();
  await assert.rejects(new Terrain(read).prepare(-89,0,signal.signal),{code:'ABORTED'});
  for(const fault of ['missing','size','checksum','encoding']) {
    const terrain=new Terrain(async url=>{
      const raw=await read(url);
      if(url.pathname.endsWith('/polar20-delta-v1/manifest.json')&&(fault==='encoding'||fault==='checksum')) {
        const manifest=JSON.parse(new TextDecoder().decode(raw));
        if(fault==='encoding')manifest.encoding='unknown';
        else for(const entry of Object.values(manifest.files) as {decodedSha256:string}[])entry.decodedSha256='0'.repeat(64);
        return new TextEncoder().encode(JSON.stringify(manifest)).buffer;
      }
      if(url.pathname.includes('/polar20-delta-v1/')&&url.pathname.endsWith('.gz')) {
        if(fault==='missing')throw new Error('Tile unavailable');
        if(fault==='size')return raw.slice(0,-1);
      }
      return raw;
    });
    await assert.rejects(terrain.prepare(-89,0),/unavailable|size mismatch|checksum mismatch|not the reviewed/);
  }
});

test('every height bound is the exact maximum of its original 64x64 source pixels',async()=>{
  const bounds=new Int16Array(await read(new URL('polar20-bounds-v1.bin',base)));
  assert.equal(bounds.length,120*120);
  for(let row=0;row<15;row++)for(let col=0;col<15;col++) {
    const pixels=new Int16Array(await gunzip(await read(new URL(`polar20/${row}-${col}.bin.gz`,base))));
    for(let by=0;by<8;by++)for(let bx=0;bx<8;bx++) {
      let max=-32768;
      for(let y=by*64;y<(by+1)*64;y++)for(let x=bx*64;x<(bx+1)*64;x++)max=Math.max(max,pixels[y*512+x]);
      assert.equal(bounds[(row*8+by)*120+col*8+bx],max,`${row},${col}/${by},${bx}`);
    }
  }
});

test('demand-loaded cold horizons retain every reference hash with much smaller polar downloads',async t=>{
  const reference=JSON.parse(await readFile(new URL('../fixtures/terrain-horizon-reference.json',import.meta.url),'utf8'));
  for(const point of reference.points) {
    const requests:string[]=[],terrain=new Terrain(async url=>{requests.push(url.pathname);return read(url);});
    const started=performance.now();
    await terrain.prepare(point.lat,point.lon,undefined,true);
    const horizon=await traceHorizon(terrain,point.lat,point.lon);
    assert.equal(horizon.sha256,point.sha256,`${point.lat},${point.lon}`);
    assert.equal(horizon.surfaceElevation,point.surfaceElevation);
    assert.equal(horizon.rayStepM,point.lat-150000/1737400*180/Math.PI<=-87.5?20:60);
    assert.equal(horizon.rangeKm,150);
    assert.equal(new Set(requests).size,requests.length,'No duplicate fetches within a cold calculation');
    if(point.lat===-89.44)assert.ok(terrain.bytesLoaded<32533451*.2,'At least 80% less terrain than eager lossless transport');
    if(point.lat===.6)assert.ok(!requests.some(path=>path.includes('polar20-bounds')),'No polar metadata for global-only rays');
    t.diagnostic(JSON.stringify({lat:point.lat,lon:point.lon,bytes:terrain.bytesLoaded,ms:Math.round(performance.now()-started)}));
    const bytes=terrain.bytesLoaded;
    await terrain.prepare(point.lat,point.lon,undefined,true);
    assert.equal((await traceHorizon(terrain,point.lat,point.lon)).sha256,point.sha256);
    assert.equal(terrain.bytesLoaded,bytes,'Reusing the same location needs no further tile/bounds bytes');
  }
});

test('bounds reject corruption and demand loading can retry a failed tile without approximating',async()=>{
  for(const fault of ['missing','truncated','corrupted']) {
    const terrain=new Terrain(async url=>{
      const raw=await read(url);
      if(url.pathname.endsWith('polar20-bounds-v1.bin')) {
        if(fault==='missing')throw new Error('Bounds unavailable');
        if(fault==='truncated')return raw.slice(0,-2);
        new Uint8Array(raw)[0]^=1;
      }
      return raw;
    });
    await assert.rejects(terrain.prepare(-89.44,222.83,undefined,true),/unavailable|bounds checksum/);
  }
  let fail=true;
  const terrain=new Terrain(async url=>{
    if(fail&&url.pathname.includes('/polar20-delta-v1/')&&url.pathname.endsWith('.gz'))throw new Error('Tile unavailable');
    return read(url);
  });
  await terrain.prepare(-89.44,222.83,undefined,true);
  await assert.rejects(traceHorizon(terrain,-89.44,222.83),/Tile unavailable/);
  fail=false;
  const horizon=await traceHorizon(terrain,-89.44,222.83);
  assert.equal(horizon.sha256,'e7a8c12472d5923f2eee6128d5760430d6c578db5b615ec5b8c76251b3110483');
  const controller=new AbortController();controller.abort();
  await assert.rejects(traceHorizon(terrain,-89.44,222.83,controller.signal),{code:'ABORTED'});
});

test('bilinear bounds include neighbours across block and tile corners',async()=>{
  const terrain=new Terrain(read);await terrain.prepare(-89.44,222.83);
  await terrain.prepare(-89.44,222.83,undefined,true);
  // Invert the polar projection around 64-pixel blocks and 512-pixel tiles.
  for(const row of [3071.99,3072,3775.99,3776,4095.99,4096])
    for(const col of [3071.99,3072,3775.99,3776,4095.99,4096]) {
      const px=(3791.5-row)*20,py=(col-3791.5)*20,q=(px*px+py*py)/(4*1737400**2);
      const x=px/(1737400*(1+q)),y=py/(1737400*(1+q)),z=(q-1)/(q+1);
      assert.ok(terrain.upperBound(x,y,z)>=terrain.sample(x,y,z),`${row},${col}`);
    }
});

test('demand loading agrees with unpruned rays at additional ridge and crater locations',async t=>{
  const full=new Terrain(read);
  for(const [lat,lon] of [[-88.5,45],[-89,90],[-87.7,265],[-89.7,315],[-88.2,135],[-89.2,10]]) {
    await full.prepare(lat,lon);
    const reference=await traceHorizon({sample:full.sample.bind(full)},lat,lon);
    const terrain=new Terrain(read);await terrain.prepare(lat,lon,undefined,true);
    assert.equal((await traceHorizon(terrain,lat,lon)).sha256,reference.sha256,`${lat},${lon}`);
    t.diagnostic(JSON.stringify({lat,lon,bytes:terrain.bytesLoaded}));
  }
});
