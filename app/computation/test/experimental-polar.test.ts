import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {ExperimentalPolar} from '../scripts/experimental-polar.ts';

function fixture(){
  const tiles:Record<string,any>={},payload=new Map<string,ArrayBuffer>();
  // An analytic sloping raster exercises registration and interpolation across four tile corners.
  for(let r=0;r<15;r++)for(let c=0;c<15;c++){
    const a=new Int16Array(256*256);for(let i=0;i<256;i++)for(let j=0;j<256;j++)a[i*256+j]=(r*256+i)*2+c*256+j;
    const packed=gzipSync(a),key=`${r}-${c}`;tiles[key]={bytes:packed.length,sha256:createHash('sha256').update(a).digest('hex')};
    payload.set(key,packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.length) as ArrayBuffer);
  }
  const manifest={format:'Tanaw-polar-experiment-v1',frame:'MOON_ME_DE421',datum:'sphere-1737400m',radiusM:1737400,tileSize:256,
    grids:[{id:'lola240',width:3812,height:3812,left:-457440,top:457440,spacingM:240,scale:.5,dtype:'<i2',
      sourceSha256:'d031efe2611b17dfbf3c158f5e15dc04cd5719349dcbf6384bb21fd97697c490',tiles}]};
  const read=async(u:URL)=>u.pathname.endsWith('/manifest.json')?new TextEncoder().encode(JSON.stringify(manifest)).buffer:
    payload.get(u.pathname.split('/').at(-1)!.replace('.bin.gz',''))!;
  return {manifest,read};
}
const f=fixture();
const row=2047.75,col=2047.25,x=-457440+(col+.5)*240,y=457440-(row+.5)*240;
const lat=(2*Math.atan(Math.hypot(x,y)/(2*1737400))-Math.PI/2)*180/Math.PI,lon=Math.atan2(x,y)*180/Math.PI;
const sample=(t:ExperimentalPolar)=>{const p=lat*Math.PI/180,l=lon*Math.PI/180;return t.sample(Math.cos(p)*Math.cos(l),Math.cos(p)*Math.sin(l),Math.sin(p));};

test('experimental tiles preserve pixel-centre registration across tile corners and reuse cached bytes',async()=>{
  const t=new ExperimentalPolar(new URL('https://test.invalid/'),false,f.read);await t.prepare(lat,lon);
  assert.ok(Math.abs(sample(t)-(row*2+col)*.5)<1e-8);
  const bytes=t.bytesLoaded;await t.prepare(lat,lon);assert.equal(t.bytesLoaded,bytes);
  await assert.rejects(t.prepare(-79,0),/Experimental coverage/);
  await assert.rejects(t.prepare(-90,0),/Experimental coverage/);
});

test('experimental terrain rejects frame changes and corrupt tile digests',async()=>{
  const badFrame=structuredClone(f.manifest);badFrame.frame='IAU_MOON';
  const read=async(u:URL)=>u.pathname.endsWith('manifest.json')?new TextEncoder().encode(JSON.stringify(badFrame)).buffer:f.read(u);
  await assert.rejects(new ExperimentalPolar(new URL('https://test.invalid/'),false,read).prepare(lat,lon),/manifest/);
  const badHash=structuredClone(f.manifest);for(const t of Object.values(badHash.grids[0].tiles))t.sha256='0'.repeat(64);
  const damaged=async(u:URL)=>u.pathname.endsWith('manifest.json')?new TextEncoder().encode(JSON.stringify(badHash)).buffer:f.read(u);
  await assert.rejects(new ExperimentalPolar(new URL('https://test.invalid/'),false,damaged).prepare(lat,lon),/Corrupt/);
});

test('fine interpolation uses pixel-centre footprints and nonfinite cells fall back to coarse terrain',async()=>{
  for(const missing of [false,true]){
    const values=new Float32Array(256*256);values[0]=10;values[1]=20;values[256]=30;values[257]=missing?NaN:40;
    const packed=gzipSync(values),bytes=packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.length) as ArrayBuffer;
    const manifest=structuredClone(f.manifest);
    manifest.grids.push({id:'synthetic-fine',width:2,height:2,left:x-5,top:y+5,spacingM:5,scale:1,dtype:'<f4',sourceSha256:'synthetic',
      tiles:{'0-0':{bytes:packed.length,sha256:createHash('sha256').update(values).digest('hex')}}});
    const read=async(u:URL)=>u.pathname.endsWith('manifest.json')?new TextEncoder().encode(JSON.stringify(manifest)).buffer:
      u.pathname.includes('/synthetic-fine/')?bytes:f.read(u);
    const t=new ExperimentalPolar(new URL('https://test.invalid/'),true,read);await t.prepare(lat,lon);
    assert.ok(Math.abs(sample(t)-(missing?(row*2+col)*.5:25))<1e-7);
  }
});
