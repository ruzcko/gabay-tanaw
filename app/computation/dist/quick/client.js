import { throwIfAborted } from '../core.js';
import { horizonKey } from './terrain.js';

/** Browser-only entry point. One job at a time; stale jobs are physically terminated. */
export function createQuickEstimateClient() {
  let worker                 ,serial=0,pendingCancel                     ,disposed=false;
  const horizons=new Map                     ();
  function stop(){worker?.terminate();worker=undefined;}
  function request(selection               ,signal             ,sceneOnly=false)                                       {
      pendingCancel?.();throwIfAborted(signal);
      if(disposed)return Promise.reject(new Error('Quick-estimate client is disposed'));
      worker??=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
      const current=worker,id=++serial,key=horizonKey(selection.lat,selection.lon);
      return new Promise((resolve,reject)=>{
        const cleanup=()=>{signal?.removeEventListener('abort',cancel);pendingCancel=undefined;};
        const cancel=()=>{cleanup();stop();reject(new DOMException('Estimate cancelled','AbortError'));};
        pendingCancel=cancel;signal?.addEventListener('abort',cancel,{once:true});
        current.onmessage=({data})=>{
          if(data.id!==id)return;cleanup();
          if(data.error){reject(new Error(data.error));return;}
          const result=data.result                                ;
          if(!sceneOnly){
            horizons.delete(key);horizons.set(key,structuredClone((result               ).horizon));
            while(horizons.size>8)horizons.delete(horizons.keys().next().value );
          }
          resolve(result);
        };
        current.onerror=event=>{cleanup();stop();reject(new Error(event.message));};
        current.postMessage({id,selection,horizon:horizons.get(key),sceneOnly});
      });
  }
  return {
    estimate(selection               ,signal             ){return request(selection,signal)                        ;},
    snapshot(selection               ,signal             ){return request(selection,signal,true)                             ;},
    dispose(){disposed=true;pendingCancel?.();stop();horizons.clear();}
  };
}
