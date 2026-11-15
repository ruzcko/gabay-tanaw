import { requireCondition } from '../core.js';

/** Invert row-local modulo-65536 deltas; both byte planes contain every original bit. */
export function decodeTerrainDelta(raw            , side=512)             {
  const count=side*side;
  requireCondition(raw.byteLength===count*2,'INVALID_RESPONSE','Invalid encoded terrain length');
  const packed=new Uint8Array(raw),decoded=new ArrayBuffer(count*2),view=new DataView(decoded);
  let previous=0;
  for(let i=0;i<count;i++) {
    if(i%side===0)previous=0;
    previous=(previous+packed[i]+(packed[count+i]<<8))&65535;
    view.setUint16(i*2,previous,true);
  }
  return decoded;
}
