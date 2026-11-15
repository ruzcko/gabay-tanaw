/** Browser-safe transport; requests only your own backend, never NASA directly. */

import { ComputationError, parseUtc, throwIfAborted, validateSite } from './core.js';
export function createHttpEphemerisProvider(endpoint = '/api/observation', transport               = globalThis.fetch)                    {
  return { async observe(request) {
    throwIfAborted(request.signal);
    const site = validateSite(request.site), instantUtc = new Date(parseUtc(request.instantUtc)).toISOString();
    try {
      const response = await transport(endpoint, { method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({site,instantUtc}),signal:request.signal });
      const payload = await response.json();
      if (!response.ok) throw new ComputationError('UPSTREAM', payload.error?.message ?? 'Backend request failed', {status:response.status,backendCode:payload.error?.code});
      return payload                    ;
    } catch (error) { throwIfAborted(request.signal); throw error; }
  } };
}
