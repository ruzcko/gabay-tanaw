import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createTravelPlanner,createTravelSource} from '../src/travel.ts';
const read=async(url:URL)=>{const b=await readFile(url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length) as ArrayBuffer;};
const planner=createTravelPlanner(createTravelSource({read})),reports=[];
for(const terrainEnabled of [true,false]) {
  const result=await planner.discover('2027-01-10T00:00:00Z',{terrainEnabled},{maxElapsedMs:45000,
    onProgress:p=>{const count=p.attempted.south+p.attempted.elsewhere;if(count&&count%12===0)console.log({terrainEnabled,...p});}});
  const candidates=[...result.candidates.south,...result.candidates.elsewhere];
  assert.ok(candidates.every(r=>r.status==='pass'&&r.segments.every(s=>s.quality==='estimate'&&s.reason==='published-unavailable')));
  assert.equal(result.shortfall.south,result.target.south-result.found.south);
  assert.equal(result.shortfall.elsewhere,result.target.elsewhere-result.found.elsewhere);
  if(terrainEnabled)assert.equal(result.found.elsewhere,0);
  else assert.ok(result.candidates.elsewhere.every(r=>r.checks.terrain==='unknown'));
  console.log(JSON.stringify({terrainEnabled,found:result.found,shortfall:result.shortfall,attempted:result.attempted,
    stopReason:result.stopReason,elapsedMs:result.elapsedMs,terrainSkipped:result.terrainSkipped}));reports.push(result);
}
const output=new URL('../../../out/travel-candidates/',import.meta.url);await mkdir(output,{recursive:true});
await writeFile(new URL('simulation.json',output),JSON.stringify(reports,null,2)+'\n');
