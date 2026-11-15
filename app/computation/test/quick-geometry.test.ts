import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {QuickEngine} from '../src/quick/engine.ts';
import {validateProduct,productMoonDirections} from '../src/forecast-product.ts';

const read=async(url:URL)=>{const b=await readFile(url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length) as ArrayBuffer;};
const sun=async(label:string)=>JSON.parse(await readFile(new URL(`../../data/sun/${label}.json`,import.meta.url),'utf8'));
const r=Math.PI/180;
// The published display convention: Moon ME (lat, lon) -> x0-yNorth-zWest.
const direction=(lat:number,lon:number)=>[Math.cos(lat*r)*Math.cos(lon*r),Math.sin(lat*r),-Math.cos(lat*r)*Math.sin(lon*r)];
const angle=(a:number[],b:number[])=>Math.atan2(Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]),
  a[0]*b[0]+a[1]*b[1]+a[2]*b[2])/r;
const engine=new QuickEngine(read);
// 366 days: the full published sub-point year plus its end, at the largest window the product allows.
const window={startUtc:'2026-12-01T00:00:00Z',endUtc:'2027-12-02T00:00:00Z'};
const sites={'connecting-ridge':{id:'connecting-ridge',lat:-89.4398,lon:222.83},'apollo-11':{id:'apollo-11',lat:.67416,lon:23.47314}};
const products:Record<string,any>={};
for(const [id,site] of Object.entries(sites))products[id]=await engine.run({...site,...window,instantUtc:'2027-03-15T07:00:00Z'});

test('estimate hourly sub-points match the published Horizons sub-points',async()=>{
  for(const [id,product] of Object.entries(products)) {
    validateProduct(product,{...sites[id as keyof typeof sites],...window},'estimate');
    const g=product.geometry;
    assert.deepEqual(Object.keys(g),['start','stepMinutes','subsolarLat','subsolarLon','subEarthLat','subEarthLon','quality']);
    assert.equal(g.start,'2026-12-01T00:00:00Z');assert.equal(g.stepMinutes,60);assert.equal(g.quality,'estimate');
    assert.equal(g.subsolarLat.length,366*24+1,'Hourly from start through the window end');
    let maxSun=0,maxEarth=0,hours=0;
    for(const label of product.index.months.filter((m:string)=>m<'2027-12')) {
      const month=await sun(label),offset=(Date.parse(month.start)-Date.parse(g.start))/3600000;
      for(let i=0;i<month.subsolarLat.length;i++,hours++) {
        maxSun=Math.max(maxSun,angle(direction(g.subsolarLat[offset+i],g.subsolarLon[offset+i]),direction(month.subsolarLat[i],month.subsolarLon[i])));
        maxEarth=Math.max(maxEarth,angle(direction(g.subEarthLat[offset+i],g.subEarthLon[offset+i]),direction(month.subEarthLat[i],month.subEarthLon[i])));
      }
    }
    for(const utc of ['2026-12-01T00:00:00Z','2027-03-15T07:00:00Z','2027-06-30T23:00:00Z','2027-11-29T12:00:00Z']) {
      const month=await sun(utc.slice(0,7)),i=(Date.parse(utc)-Date.parse(month.start))/3600000,k=(Date.parse(utc)-Date.parse(g.start))/3600000;
      assert.ok(angle(direction(g.subsolarLat[k],g.subsolarLon[k]),direction(month.subsolarLat[i],month.subsolarLon[i]))<=2e-4,`${id} sub-solar ${utc}`);
      assert.ok(angle(direction(g.subEarthLat[k],g.subEarthLon[k]),direction(month.subEarthLat[i],month.subEarthLon[i]))<=2e-4,`${id} sub-Earth ${utc}`);
    }
    assert.equal(hours,365*24);
    // Rounding of both products is 0.0001°; a geometric (uncorrected) track differs by ~0.006°.
    assert.ok(maxSun<=2e-4,`${id} sub-solar ${maxSun}°`);assert.ok(maxEarth<=2e-4,`${id} sub-Earth ${maxEarth}°`);
    console.log('Estimate sub-points vs app/data/sun',{site:id,hours,maxSubsolarDeg:maxSun,maxSubEarthDeg:maxEarth});
  }
  assert.deepEqual(products['apollo-11'].geometry,products['connecting-ridge'].geometry,'Sub-points do not depend on the site');
});

test('estimate Moon directions play hourly and interpolate between hours',()=>{
  const product=products['apollo-11'],g=product.geometry;
  const at=(utc:string)=>{const i=(Date.parse(utc)-Date.parse(g.start))/3600000;
    return {sun:direction(g.subsolarLat[i],g.subsolarLon[i]),earth:direction(g.subEarthLat[i],g.subEarthLon[i])};};
  for(const [left,middle,right] of [['2027-03-15T07:00:00Z','2027-03-15T07:30:00Z','2027-03-15T08:00:00Z'],
    ['2027-12-01T23:00:00Z','2027-12-01T23:30:00Z','2027-12-02T00:00:00Z']]) {
    const a=at(left),b=at(right),m=productMoonDirections(product,middle);
    const exact=productMoonDirections(product,left);
    for(const body of ['sun','earth'] as const)exact[body].forEach((x:number,i:number)=>assert.ok(Math.abs(x-a[body][i])<1e-15,`${body} at the hour`));
    for(const body of ['sun','earth'] as const) {
      const sum=a[body].map((x,i)=>x+b[body][i]),norm=Math.hypot(...sum);
      sum.forEach((x,i)=>assert.ok(Math.abs(x/norm-m[body][i])<1e-12,`${body} half-hour midpoint`));
      const step=angle(a[body],b[body]);assert.ok(step>0,`${body} moves within the hour`);
      assert.ok(Math.abs(angle(a[body],m[body])-step/2)<1e-9&&Math.abs(angle(m[body],b[body])-step/2)<1e-9,`${body} lies halfway`);
    }
  }
  assert.ok(angle(productMoonDirections(product,product.snapshot.instantUtc).sun,product.snapshot.overview.sunDirectionMoon)<.01,
    'Track and snapshot geometry agree at the selected instant');
  const single=structuredClone(product);delete single.geometry;
  assert.deepEqual(productMoonDirections(single,product.snapshot.instantUtc),
    {sun:product.snapshot.overview.sunDirectionMoon,earth:product.snapshot.overview.earthDirectionMoon});
  assert.throws(()=>productMoonDirections(single,'2027-03-15T07:30:00Z'),/another instant/);
  assert.throws(()=>productMoonDirections(product,'2027-12-02T00:30:00Z'),/outside the saved hours/);
});
