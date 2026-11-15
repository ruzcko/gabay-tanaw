import { createObserverView } from './index.js';
import { createLocalTerrainProvider, localAssetProvider } from './local-providers.js';
import { fixture } from './fixture.js';
import { direction } from './math.js';
const output=document.querySelector('#results'), results=[];
const assert=(condition,message)=>{if(!condition)throw new Error(message);results.push(`PASS ${message}`);output.textContent=results.join('\n');};
const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const waitFor=async(test)=>{const end=performance.now()+20000;while(!test()){if(performance.now()>end)throw new Error('Timed out');await frame();}};
const provider=createLocalTerrainProvider(), errors=[];
let terrainState,assetState,view;
try{
  const snapshot=fixture();snapshot.site={...snapshot.site,id:'LOLA verification',referenceFrame:'LOLA-ME',elevationDatum:'sphere-1737400m'};
  snapshot.site.surfaceElevationM=await provider.sampleGround({site:snapshot.site,signal:new AbortController().signal});
  snapshot.lighting={sunDirectionLocal:direction(90,5)};
  snapshot.earthAppearance={bodyFrame:'earth-fixed-x0-yNorth-zWest',bodyToLocal:[0,0,0,1],sunDirectionBody:[1,0,0]};
  snapshot.sky={catalogFrame:'ICRS-J1991.25',catalogToLocal:[0,0,0,1]};
  view=createObserverView({container:document.querySelector('#view'),terrainProvider:provider,assetProvider:localAssetProvider,onError:error=>errors.push(error.message),onTerrainStatus:state=>terrainState=state,onAssetStatus:state=>assetState=state});
  view.setSnapshot(snapshot);view.lookToward('earth');
  await waitFor(()=>terrainState?.state==='ready'&&assetState?.state==='ready');await frame();
  assert(errors.length===0,'workers, textures and shader assets load without reported errors');
  assert(assetState.stars===907,'compact Hipparcos catalog loaded');
  assert(terrainState.coverage===1&&terrainState.resolutionM>1800,'real LOLA coverage and effective source resolution reported');
  // Asset readiness is CPU readiness; allow lazy shader/texture and shadow setup.
  for(let i=0;i<30;i++){view.setSnapshot(snapshot);await frame();}
  const initial=view.getDiagnostics(), samples=[];
  assert(initial.sky.starsVisible,'catalog stars render');
  snapshot.sky.catalogToLocal=[0,Math.sin(.2),0,Math.cos(.2)];view.setSnapshot(snapshot);await frame();
  const sky=view.getDiagnostics().sky;
  assert(sky.starsRotation.every((v,i)=>Math.abs(v-snapshot.sky.catalogToLocal[i])<1e-9),'stars use exactly the supplied rotation');
  const withoutSky={...snapshot};delete withoutSky.sky;view.setSnapshot(withoutSky);await frame();
  assert(!view.getDiagnostics().sky.starsVisible,'missing sky orientation hides stars without inventing positions');
  view.setSnapshot(snapshot);await frame();
  for(let i=0;i<90;i++){
    snapshot.instantUtc=new Date(Date.UTC(2026,10,14,0,0,i)).toISOString();snapshot.lighting.sunDirectionLocal=direction(90+i*.1,5);
    view.setSnapshot(snapshot);await frame();samples.push(view.getDiagnostics().frameCpuMs);
  }
  const after=view.getDiagnostics();
  assert(initial.geometries===after.geometries&&initial.textures===after.textures,`playback reuses GPU geometry and textures (${initial.geometries}/${initial.textures} to ${after.geometries}/${after.textures})`);
  assert(terrainState.loadMs===initial.terrain.loadMs,'playback does not reload terrain');
  // Drain invalidations queued by the final cached terrain/asset update before measuring idle.
  await frame();await frame();
  const idleCount=view.getDiagnostics().renderCount;await frame();await frame();
  assert(view.getDiagnostics().renderCount===idleCount,'idle view renders on demand');
  view.setOptions({quality:'low',belowHorizonCutaway:true,verticalExaggeration:3});await waitFor(()=>terrainState?.state==='ready');await frame();
  assert(view.getDiagnostics().shadowMapSize===512,'low quality bounds shadow map to 512');
  const opposite={...snapshot.site,longitudeEastDeg:179.99,id:'dateline'};
  opposite.surfaceElevationM=await provider.sampleGround({site:opposite,signal:new AbortController().signal});
  view.setSnapshot({...snapshot,site:opposite});view.setSnapshot(snapshot);
  await waitFor(()=>terrainState?.state==='ready');await frame();
  assert(view.getDiagnostics().siteId==='LOLA verification','rapid site switch keeps newest snapshot');
  const polar={...snapshot.site,latitudeDeg:-89.5,id:'polar'};
  polar.surfaceElevationM=await provider.sampleGround({site:polar,signal:new AbortController().signal});
  view.setSnapshot({...snapshot,site:polar});await waitFor(()=>terrainState?.state==='ready');
  assert(errors.length===0,'polar sampling and rapid cancellation succeed');
  assert(terrainState.resolutionM===20&&terrainState.meshSpacingM===20,'polar terrain uses real 20 m source and near-observer mesh spacing');
  const polarLoad=terrainState.loadMs;
  view.setSnapshot({...snapshot,site:polar,instantUtc:'2026-11-14T01:00:00Z'});await frame();
  assert(terrainState.loadMs===polarLoad,'polar terrain is reused when only snapshot time changes');
  samples.sort((a,b)=>a-b);
  results.push(`MEASURE initial refinement ${initial.terrain.loadMs.toFixed(1)} ms; render CPU median ${samples[45].toFixed(2)} ms, p95 ${samples[85].toFixed(2)} ms; ${after.geometries} geometries, ${after.textures} textures, ${after.drawCalls} draw calls; ${after.geometryBufferBytes} geometry-buffer bytes; ${after.assetMemory.bitmapBytes} decoded image bytes; estimated ${after.assetMemory.estimatedTextureBytesWithMipmaps} texture bytes including mipmaps (excluding shadows). Actual GPU bytes not exposed by WebGL.`);
  view.dispose();provider.dispose();await frame();
  assert(document.querySelectorAll('canvas').length===0,'view and provider dispose cleanly');
  output.textContent=results.join('\n')+'\nAll Stage 2 browser checks passed.';
}catch(error){output.textContent=results.join('\n')+`\nFAIL ${error.stack}\n${errors.join('\n')}`;}
finally{view?.dispose();provider.dispose();}
