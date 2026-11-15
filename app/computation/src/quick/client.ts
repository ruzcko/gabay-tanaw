import { throwIfAborted } from '../core.ts';
import { horizonKey } from './terrain.ts';
import type { QuickHorizon } from './terrain.ts';
import type { QuickResult, QuickSelection } from './engine.ts';
import type { ObserverSnapshot } from '../../../observer/contract.js';

/** Browser-only entry point. One job at a time; stale jobs are physically terminated. */
export function createQuickEstimateClient() {
  let worker:Worker|undefined,serial=0,pendingCancel:(()=>void)|undefined,disposed=false;
  const horizons=new Map<string,QuickHorizon>();
  function stop(){worker?.terminate();worker=undefined;}
  function request(selection:QuickSelection,signal?:AbortSignal,sceneOnly=false):Promise<QuickResult|ObserverSnapshot> {
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
          const result=data.result as QuickResult|ObserverSnapshot;
          if(!sceneOnly){
            horizons.delete(key);horizons.set(key,structuredClone((result as QuickResult).horizon));
            while(horizons.size>8)horizons.delete(horizons.keys().next().value!);
          }
          resolve(result);
        };
        current.onerror=event=>{cleanup();stop();reject(new Error(event.message));};
        current.postMessage({id,selection,horizon:horizons.get(key),sceneOnly});
      });
  }
  return {
    estimate(selection:QuickSelection,signal?:AbortSignal){return request(selection,signal) as Promise<QuickResult>;},
    snapshot(selection:QuickSelection,signal?:AbortSignal){return request(selection,signal,true) as Promise<ObserverSnapshot>;},
    dispose(){disposed=true;pendingCancel?.();stop();horizons.clear();}
  };
}
