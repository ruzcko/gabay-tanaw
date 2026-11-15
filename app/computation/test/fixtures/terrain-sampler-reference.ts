/** Original four-lookup sampler, retained to check exact hot-loop optimization parity. */
import type {Terrain} from '../../src/quick/terrain.ts';
export function referenceSample(terrain:Terrain,x:number,y:number,z:number):number {
  const R=1737400,DEG=180/Math.PI,t=terrain as any;
  if(z<=Math.sin(-87.5/DEG)) {
    const scale=2*R/(1-z)/20,px=3791.5+y*scale,py=3791.5-x*scale;
    const c=Math.floor(px),r=Math.floor(py),fc=px-c,fr=py-r;
    if(r>=0&&c>=0&&r<7583&&c<7583)return (t.polarPixel(r,c)*(1-fc)+t.polarPixel(r,c+1)*fc)*(1-fr)+
      (t.polarPixel(r+1,c)*(1-fc)+t.polarPixel(r+1,c+1)*fc)*fr;
  }
  const px=(Math.atan2(y,x)*DEG+180)*16-.5,py=Math.max(0,Math.min(2879,(90-Math.asin(Math.max(-1,Math.min(1,z)))*DEG)*16-.5));
  const c=Math.floor(px),r=Math.floor(py),fc=px-c,fr=py-r;
  return (t.globalPixel(r,c)*(1-fc)+t.globalPixel(r,c+1)*fc)*(1-fr)+
    (t.globalPixel(r+1,c)*(1-fc)+t.globalPixel(r+1,c+1)*fc)*fr;
}
