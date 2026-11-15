export function createLocalTerrainProvider(baseUrl = new URL('../assets/observer/terrain', import.meta.url).href) {
  const jobs = new Map(); let sequence=0,disposed=false;
  const worker=new Worker(new URL('./local-terrain-worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>jobs.get(data.id)?.finish(data);
  worker.onerror=e=>{for(const job of [...jobs.values()])job.finish({error:e.message});};
  function run(request) {
    return new Promise((resolve,reject)=>{
      if(disposed || request.signal.aborted) { reject(request.signal.reason || new DOMException('Disposed','AbortError')); return; }
      const id=++sequence;
      const cleanup=()=>{jobs.delete(id);request.signal.removeEventListener('abort',cancel);};
      const cancel=()=>{worker.postMessage({id,cancel:true});cleanup();reject(new DOMException('Terrain cancelled','AbortError'));};
      jobs.set(id,{cancel,finish(data){cleanup();data.error?reject(new Error(data.error)):resolve(data.result);}});
      request.signal.addEventListener('abort',cancel,{once:true});
      worker.postMessage({id,baseUrl,site:request.site,level:request.level,sampleOnly:request.sampleOnly,detailed:request.detailed,coarse:request.coarse});
    });
  }
  return { loadTile: run, async sampleGround({site,signal}) { const tile=await run({site,signal,level:1,sampleOnly:true}); return tile.elevationsM[0]; }, dispose(){disposed=true;for(const job of [...jobs.values()])job.cancel();worker.terminate();} };
}

/** Provider returns URLs/metadata; the view owns decoded/GPU resources. */
export const localAssetProvider = {
  async getAssets({signal}) {
    const response=await fetch(new URL('../assets/observer/stars.json',import.meta.url),{signal});
    if(!response.ok)throw new Error(`Star catalog ${response.status}`);
    const milkyWay = { url: new URL('../assets/observer/milkyway-4k.webp', import.meta.url).href,
      source: 'NASA SVS 4851 / ESA Gaia DR2; see app/SOURCES.md', license: 'NASA media with attribution' };
    const relief=name=>({url:new URL(`../assets/${name}`,import.meta.url).href,source:'NASA LRO LOLA; see app/SOURCES.md',license:'NASA public data with attribution',shading:'data'});
    return { milkyWay, moonRelief:{normal:relief('moon-normal-4k.webp'),polar:relief('moon-pole-normal-2k.webp')},earth:{url:new URL('../assets/observer/earth-blue-marble.png',import.meta.url).href,source:'NASA SVS 2915 / NASA Earth Observatory',license:'NASA media with attribution',shading:'baked'}, terrain:{url:new URL('../assets/moon-color-4k.webp',import.meta.url).href,source:'NASA SVS 4720 / LRO LROC',license:'NASA media with attribution',shading:'albedo-approximation'}, catalog:await response.json() };
  }
};
