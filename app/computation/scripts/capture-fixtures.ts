import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { createHorizonsProvider } from '../src/horizons.ts';
import { ELEVATION_DATUM, LUNAR_FRAME } from '../src/core.ts';
import type { LunarSite } from '../src/contracts.ts';
const directory=new URL('../fixtures/',import.meta.url); await mkdir(directory,{recursive:true});
const provider=createHorizonsProvider({userAgent:'TanawComputationEngine/0.1 (https://github.com/ruzcko/gabay-tanaw)'});
const cases=[
  {id:'near-side',lat:0,lon:0,date:'2026-11-14T00:00:00Z'},
  {id:'far-side-north',lat:35,lon:180,date:'2026-03-20T12:00:00Z'},
  {id:'south-polar',lat:-89.9,lon:45,date:'2026-06-21T00:00:00Z'},
  {id:'north-wrap',lat:89.9,lon:-1,date:'2026-12-21T00:00:00Z'},
  {id:'limb-south',lat:-20,lon:90,date:'2026-09-23T00:00:00Z'},
  {id:'sun-horizon',lat:0,lon:36.6,date:'2026-11-14T00:00:00Z'},
  {id:'earth-horizon',lat:-20,lon:85.15,date:'2026-09-23T00:00:00Z'}
];
const manifest=[];
for(const c of cases) {
  if(process.argv[2] && process.argv[2]!==c.id) continue;
  const site:LunarSite={id:c.id,latitudeDeg:c.lat,longitudeEastDeg:c.lon,surfaceElevationM:100,observerHeightM:2,referenceFrame:LUNAR_FRAME,elevationDatum:ELEVATION_DATUM};
  const snapshot=await provider.observe({site,instantUtc:c.date});
  await writeFile(new URL(`${c.id}-snapshot.json`,directory),JSON.stringify(snapshot,null,2)+'\n');
  for(const target of [10,399] as const) {
    const instantsUtc=[c.date,new Date(Date.parse(c.date)+3600000).toISOString()];
    for(const kind of ['observer','geometric'] as const) {
      const query={site,instantsUtc,target,kind};
      const result=await provider.query(query);
      const file=`${c.id}-${target}-${kind}.json`;
      await writeFile(new URL(file,directory),JSON.stringify({query,result},null,2)+'\n');
    }
  }
  console.log(`Captured and validated ${c.id}`);
}
for(const file of (await readdir(directory)).sort()) {
  if(!/-(observer|geometric)\.json$/.test(file)) continue;
  const {query}=JSON.parse(await readFile(new URL(file,directory),'utf8'));
  manifest.push({file,site:query.site.id,target:query.target,kind:query.kind});
}
await writeFile(new URL('manifest.json',directory),JSON.stringify({source:'Direct NASA/JPL Horizons responses',cases:manifest},null,2)+'\n');
if(!process.argv[2] || process.argv[2]==='series') {
  const site:LunarSite={id:'near-side',latitudeDeg:0,longitudeEastDeg:0,surfaceElevationM:100,observerHeightM:2,referenceFrame:LUNAR_FRAME,elevationDatum:ELEVATION_DATUM};
  const request={site,startUtc:'2026-11-14T00:00:00Z',target:10 as const};
  const results=await provider.series(request);
  await writeFile(new URL('near-side-seven-day-series.json',directory),JSON.stringify({request,results},null,2)+'\n');
  console.log('Captured and validated default seven-day series');
}
