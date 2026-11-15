import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { productSnapshot, validateProduct } from '../src/forecast-product.ts';
import { toObserverViewSnapshot } from '../src/index.ts';
import { validateSnapshot } from '../../observer/math.js';
import { quaternionMatrix } from '../src/sky-orientation.ts';
const read=async(path:string)=>JSON.parse(await readFile(new URL(`../../data/${path}`,import.meta.url),'utf8'));
const fixtures=JSON.parse(await readFile(new URL('../fixtures/published-geometry.json',import.meta.url),'utf8'));
const products=new Map<string,any>();
for(const id of ['apollo-17','shackleton-rim','change-4']) {
  const index=await read(`forecast/${id}.json`),monthly:any={},geometryMonthly:any={};
  for(const month of index.months) {
    monthly[month]=await read(`forecast/${id}/${month}.json`);
    geometryMonthly[month]=await read(`sun/${month}.json`);
  }
  const p={index,horizon:await read(`horizons/${id}.json`),monthly,geometryMonthly};
  validateProduct(p,{id,lat:index.lat,lon:index.lon,startUtc:index.window.start,endUtc:index.window.end},'accurate');
  products.set(id,p);
}
const angular=(a:number[],b:number[])=>Math.atan2(Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]),a.reduce((s,v,i)=>s+v*b[i],0))*180/Math.PI;

test('every catalog site retains coherent lighting through all publication months and day/night states',async()=>{
  const sites=await read('sites.json'),geometryMonthly=products.get('apollo-17').geometryMonthly;
  let count=0,daylight=0,night=0;
  for(const site of sites) {
    const index=await read(`forecast/${site.id}.json`),monthly:any={};
    for(const label of index.months)monthly[label]=await read(`forecast/${site.id}/${label}.json`);
    const p={index,monthly,geometryMonthly};
    for(const label of index.months)for(const day of ['01','15']) {
      const utc=`${label}-${day}T13:37:00Z`,s=productSnapshot(p,utc);
      validateSnapshot(toObserverViewSnapshot(s));
      assert.equal(s.quality,'accurate');assert.equal(s.instantUtc,utc.replace('Z','.000Z'));
      assert.ok(Math.abs(Math.hypot(...s.lighting.sunDirectionLocal)-1)<1e-12);
      assert.equal(s.sky.catalogFrame,'ICRS-J1991.25');
      assert.ok(Math.abs(Math.hypot(...s.sky.catalogToLocal)-1)<1e-12);
      // Separate geometric and apparent models need not be identical, but their
      // gross day/night geometry must agree away from the horizon.
      const el=s.bodies.sun.elevationDeg,u=s.lighting.sunDirectionLocal[1];
      if(el>5){assert.ok(u>0);daylight++;}if(el< -5){assert.ok(u<0);night++;}
      count++;
    }
  }
  assert.ok(daylight>0&&night>0);assert.equal(count,sites.length*24);
  console.log(`Catalog lighting coverage: ${sites.length} sites, ${count} minute snapshots; ${daylight} day, ${night} night`);
});

test('published lighting and overview match 48 direct CSPICE fixtures, including minutes and month seam',()=>{
  let max=0;
  for(const row of fixtures.rows) {
    const p=products.get(row.id),original=JSON.stringify(p),s=productSnapshot(p,row.instantUtc);
    validateSnapshot(toObserverViewSnapshot(s));
    max=Math.max(max,angular(s.lighting.sunDirectionLocal,row.lighting.sunDirectionLocal));
    for(const k of ['siteDirectionMoon','sunDirectionMoon','earthDirectionMoon'])
      assert.ok(angular(s.overview[k],row.overview[k])<1e-6,`${row.id} ${row.instantUtc} ${k}`);
    // Quaternion sign is arbitrary; compare the absolute dot product.
    assert.ok(Math.abs(s.overview.moonToLocal.reduce((v:number,x:number,i:number)=>v+x*row.overview.moonToLocal[i],0))>1-1e-12);
    assert.equal(s.quality,'accurate');assert.equal(s.provenance.geometric.correction,'NONE');
    assert.equal(s.capabilities.geometricSunlightLocal.status,'available');
    assert.equal(s.capabilities.starCatalogToLocal.status,'available');
    assert.equal(JSON.stringify(p),original);
    const bare={...p,geometryMonthly:undefined};
    assert.deepEqual(s.bodies,productSnapshot(bare,row.instantUtc).bodies);
  }
  console.log(`Published lighting: ${fixtures.rows.length} direct SPICE comparisons; max angular error ${max} deg`);
  assert.ok(max<1e-6);
});

test('static sky agrees with direct CSPICE at minutes, saved hours and month seam',()=>{
  let max=0;
  for(const row of fixtures.rows) {
    const s=productSnapshot(products.get(row.id),row.instantUtc);
    const actual=quaternionMatrix(s.sky.catalogToLocal),expected=quaternionMatrix(row.sky.catalogToLocal);
    for(let axis=0;axis<3;axis++)max=Math.max(max,angular([actual[axis],actual[3+axis],actual[6+axis]],
      [expected[axis],expected[3+axis],expected[6+axis]]));
  }
  console.log(`Static sky: ${fixtures.rows.length} direct CSPICE comparisons; max axis error ${max} deg`);
  assert.ok(max<.00001,'hourly slerp stays below 0.036 arcsec for these fixtures');
  const p=products.get('apollo-17'),time='2027-03-19T01:08:00Z';
  assert.notDeepEqual(productSnapshot(p,time).sky,productSnapshot(p,'2027-03-19T01:09:00Z').sky);
  assert.deepEqual(productSnapshot(p,time).sky,productSnapshot(p,time).sky);
});

test('legacy geometry without sky remains valid; malformed sky and missing seam endpoints fail closed',()=>{
  const p=structuredClone(products.get('apollo-17'));
  for(const g of Object.values(p.geometryMonthly) as any[])delete g.geometric.sky;
  const select={id:p.index.id,lat:p.index.lat,lon:p.index.lon,startUtc:p.index.window.start,endUtc:p.index.window.end};
  validateProduct(p,select,'accurate');
  const s=productSnapshot(p,'2027-03-19T01:08:00Z');
  assert.equal(s.sky,undefined);assert.equal(s.capabilities.starCatalogToLocal.status,'unsupported');
  p.geometryMonthly['2026-12'].geometric.sky=structuredClone(products.get('apollo-17').geometryMonthly['2026-12'].geometric.sky);
  assert.throws(()=>productSnapshot(p,'2026-12-31T23:59:00Z'),/sky endpoint/);
  p.geometryMonthly['2026-12'].geometric.sky.rotations[0]=[0,0,0,2];
  assert.throws(()=>validateProduct(p,select,'accurate'),/sky rotations/);
});

test('Apollo 17 daylight survives accurate replacement and scrub without borrowing estimate appearance',()=>{
  const p=products.get('apollo-17'),s=productSnapshot(p,'2027-03-19T01:08:00Z');
  assert.ok(s.bodies.sun.elevationDeg>65);assert.equal(s.bodies.sun.centerVisible,true);
  assert.ok(s.lighting.sunDirectionLocal[1]>.91);
  const later=productSnapshot(p,'2027-03-19T02:08:00Z');
  assert.notDeepEqual(later.lighting,s.lighting);
  assert.deepEqual(productSnapshot(p,'2027-03-19T01:08:00Z').lighting,s.lighting);
  assert.equal(s.provenance.geometric.interpolation,'cubic-Hermite');
  const pin=p.geometryMonthly['2027-03'].geometric.kernels[0].sha256;
  s.provenance.geometric.kernels[0].sha256='changed';
  assert.equal(p.geometryMonthly['2027-03'].geometric.kernels[0].sha256,pin);
  assert.equal(productSnapshot(p,'2027-03-19T01:00:00Z').provenance.geometric.interpolation,'saved-state');
});

test('legacy missing geometry stays unsupported; malformed or mixed geometry fails closed',()=>{
  const p=structuredClone(products.get('apollo-17'));
  const select={id:p.index.id,lat:p.index.lat,lon:p.index.lon,startUtc:p.index.window.start,endUtc:p.index.window.end};
  const old={...p,geometryMonthly:undefined};
  assert.equal(productSnapshot(old,'2027-03-19T01:08:00Z').lighting,undefined);
  p.geometryMonthly['2027-03'].geometric.correction='LT';
  assert.throws(()=>validateProduct(p,select,'accurate'),/geometric states/);
  p.geometryMonthly['2027-03'].geometric.correction='NONE';
  p.geometryMonthly['2027-01'].geometric.kernels[0].sha256='a'.repeat(64);
  assert.throws(()=>productSnapshot(p,'2026-12-31T23:59:00Z'),/Mixed geometric/);
  assert.throws(()=>productSnapshot(p,'2027-11-30T23:01:00Z'),/endpoint/);
});

test('unchanged host loader delivers static Apollo 17 lighting when every service request is unavailable',async()=>{
  const {createForecastSource}=await import(new URL('../../forecast-source.js',import.meta.url).href);
  const source=createForecastSource({quick:async()=>{throw new Error('No estimate needed');},
    fetcher:async(url:any)=>String(url).startsWith('/api/')?new Response('',{status:404}):
      new Response(await readFile(new URL(url),'utf8'))});
  const p=products.get('apollo-17');
  const result=await source.load({id:'apollo-17',lat:p.index.lat,lon:p.index.lon,
    startUtc:'2027-03-19T00:00:00Z',endUtc:'2027-03-20T00:00:00Z',instantUtc:'2027-03-19T01:08:00Z'},()=>{});
  assert.equal(result.quality,'accurate');
  const s=productSnapshot(result.data,result.selection.instantUtc);
  assert.ok(s.lighting.sunDirectionLocal[1]>.91);
  validateSnapshot(toObserverViewSnapshot(s));source.dispose();
});
