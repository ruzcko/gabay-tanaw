/** Framework-neutral Fetch Request/Response handler. Mount behind host access controls. */
import type { EphemerisProvider } from './contracts.ts';
import { ComputationError } from './core.ts';
import { createComputationEngine } from './index.ts';
export function createObservationHandler(provider: EphemerisProvider) {
  const engine = createComputationEngine({ephemerisProvider:provider});
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return Response.json({error:{code:'INVALID_INPUT',message:'Use POST'}},{status:405,headers:{Allow:'POST'}});
    try {
      if (!request.headers.get('content-type')?.includes('application/json')) throw new ComputationError('INVALID_INPUT','Expected application/json');
      if (!request.body) throw new ComputationError('INVALID_INPUT','Missing body');
      const reader = request.body.getReader(); let text='',bytes=0; const decoder=new TextDecoder();
      try { while (true) { const {done,value}=await reader.read(); if(done) break; bytes+=value.byteLength;
        if(bytes>8192) { await reader.cancel(); throw new ComputationError('LIMIT_EXCEEDED','Request exceeds 8 KiB'); }
        text+=decoder.decode(value,{stream:true});
      } text+=decoder.decode(); } finally { reader.releaseLock(); }
      let input; try { input=JSON.parse(text); } catch { throw new ComputationError('INVALID_INPUT','Invalid JSON'); }
      if (!input || typeof input !== 'object') throw new ComputationError('INVALID_INPUT','Expected object');
      const result=await engine.observe({site:input.site,instantUtc:input.instantUtc,signal:request.signal});
      return Response.json(result,{headers:{'Cache-Control':'no-store'}});
    } catch(error) {
      const e=error instanceof ComputationError ? error : new ComputationError('UPSTREAM','Observation failed');
      const status = e.code==='LIMIT_EXCEEDED'?413:['INVALID_INPUT','INCOMPATIBLE_FRAME','UNSUPPORTED'].includes(e.code)?400:e.code==='ABORTED'?499:e.code==='TIMEOUT'?504:502;
      return Response.json({error:{code:e.code,message:e.message}},{status});
    }
  };
}
