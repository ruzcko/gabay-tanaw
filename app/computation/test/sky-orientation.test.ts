import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {localSky,rotationQuaternion,quaternionMatrix,interpolateOrientation} from '../src/sky-orientation.ts';
import {Coefficients} from '../src/quick/coefficients.ts';
import {QuickEphemeris} from '../src/quick/ephemeris.ts';
import {quickSnapshot} from '../src/quick/snapshot.ts';
import {QUICK_RANGE} from '../src/quick/coverage.ts';
const fixtures=JSON.parse(await readFile(new URL('../fixtures/quick-reference.json',import.meta.url),'utf8'));

test('sky rotation preserves ICRS axes, half-turns and shortest quaternion path',()=>{
  for(const m of [[1,0,0,0,1,0,0,0,1],[1,0,0,0,-1,0,0,0,-1],[-1,0,0,0,1,0,0,0,-1],[-1,0,0,0,-1,0,0,0,1]])
    assert.deepEqual(quaternionMatrix(rotationQuaternion(m)),m);
  const identity=[0,0,0,1],q=rotationQuaternion([0,-1,0,1,0,0,0,0,1]);
  const positive=interpolateOrientation(identity,q,.5),negative=interpolateOrientation(identity,q.map(x=>-x),.5);
  assert.deepEqual(positive,negative);assert.ok(Math.abs(positive[2]-Math.sin(Math.PI/8))<1e-14);
  assert.throws(()=>interpolateOrientation([0,0,0,2],q,.5),/Invalid sky/);
  const at=localSky([1,0,0,0,1,0,0,0,1],0,0);
  // RA0 is up; RA90 east; celestial north points local north (negative south).
  assert.deepEqual(at.matrix.map(x=>x||0),[0,1,0,1,0,0,0,0,-1]);
});

test('quick snapshot sky matches independent CSPICE matrices throughout coefficient coverage',async()=>{
  const c=new Coefficients(async url=>{const b=await readFile(url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length);});
  let max=0;
  for(const row of fixtures.rows) {
    const ms=Date.parse(row.utc);await c.prepare(ms===QUICK_RANGE.end?ms-86400000:ms,ms);
    const e=new QuickEphemeris(c,row.lat,row.lon,row.groundM);
    // A test mask only: orientation must be independent of terrain and eye height.
    const horizon:any={surfaceElevation:row.groundM,calculation:{elevations:Array(1440).fill(0)}};
    const s=quickSnapshot({lat:row.lat,lon:row.lon},ms,e,horizon),actual=quaternionMatrix(s.sky!.catalogToLocal);
    const p=row.lat*Math.PI/180,l=row.lon*Math.PI/180;
    const basis=[[-Math.sin(l),Math.cos(l),0],[Math.cos(p)*Math.cos(l),Math.cos(p)*Math.sin(l),Math.sin(p)],
      [Math.sin(p)*Math.cos(l),Math.sin(p)*Math.sin(l),-Math.cos(p)]];
    const expected=basis.flatMap(axis=>[0,1,2].map(j=>axis.reduce((sum,x,k)=>sum+x*row.rotation[k*3+j],0)));
    for(let i=0;i<9;i++)max=Math.max(max,Math.abs(actual[i]-expected[i]));
    assert.equal(s.sky!.catalogFrame,'ICRS-J1991.25');assert.ok(Math.abs(Math.hypot(...s.sky!.catalogToLocal)-1)<1e-12);
    assert.deepEqual(quickSnapshot({lat:row.lat,lon:row.lon},ms,e,horizon).sky,s.sky);
  }
  console.log(`Quick sky: ${fixtures.rows.length} reference matrices; max element error ${max}`);
  assert.ok(max<1e-9);
});
