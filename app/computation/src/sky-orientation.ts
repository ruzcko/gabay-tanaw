/** Fixed catalog directions; lunar libration comes from the pinned DE440 binary PCK. */
import { requireCondition } from './core.ts';

export const SKY_MODEL='DE440 lunar orientation; fixed Hipparcos J1991.25 catalog; no proper motion, parallax or aberration';
type Quaternion=[number,number,number,number];

export function rotationQuaternion(m:ArrayLike<number>):Quaternion {
  // Select the largest component to avoid cancellation near half turns.
  const candidates=[1+m[0]-m[4]-m[8],1-m[0]+m[4]-m[8],1-m[0]-m[4]+m[8],1+m[0]+m[4]+m[8]];
  const k=candidates.indexOf(Math.max(...candidates)),s=2*Math.sqrt(Math.max(0,candidates[k]));
  const q:Quaternion=k===0?[s/4,(m[1]+m[3])/s,(m[2]+m[6])/s,(m[7]-m[5])/s]:
    k===1?[(m[1]+m[3])/s,s/4,(m[5]+m[7])/s,(m[2]-m[6])/s]:
    k===2?[(m[2]+m[6])/s,(m[5]+m[7])/s,s/4,(m[3]-m[1])/s]:
    [(m[7]-m[5])/s,(m[2]-m[6])/s,(m[3]-m[1])/s,s/4];
  const n=Math.hypot(...q);return q.map(v=>v/n) as Quaternion;
}

export function quaternionMatrix(q:ArrayLike<number>) {
  const [x,y,z,w]=Array.from(q);
  return [1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),
    2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),
    2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)];
}

export function interpolateOrientation(a:number[],b:number[],f:number):Quaternion {
  requireCondition([a,b].every(q=>Array.isArray(q)&&q.length===4&&q.every(Number.isFinite)&&
    Math.abs(Math.hypot(...q)-1)<1e-10),'INVALID_RESPONSE','Invalid sky quaternion');
  let dot=a.reduce((sum,v,i)=>sum+v*b[i],0),sign=dot<0?-1:1;dot=Math.min(1,Math.abs(dot));
  const angle=Math.acos(dot),sin=Math.sin(angle);
  const u=sin<1e-8?1-f:Math.sin((1-f)*angle)/sin,v=sin<1e-8?f:Math.sin(f*angle)/sin;
  const q=a.map((x,i)=>u*x+v*sign*b[i]),n=Math.hypot(...q);
  return q.map(x=>x/n) as Quaternion;
}

/** Input active row-major J2000/ICRF -> scientific Moon ME XYZ; output east/up/south. */
export function localSky(orientation:ArrayLike<number>,lat:number,lon:number) {
  const p=lat*Math.PI/180,l=lon*Math.PI/180,cp=Math.cos(p),sp=Math.sin(p),cl=Math.cos(l),sl=Math.sin(l);
  const basis=[[-sl,cl,0],[cp*cl,cp*sl,sp],[sp*cl,sp*sl,-cp]];
  const matrix=basis.flatMap(row=>[0,1,2].map(c=>row[0]*orientation[c]+row[1]*orientation[3+c]+row[2]*orientation[6+c]));
  return {sky:{catalogFrame:'ICRS-J1991.25',catalogToLocal:rotationQuaternion(matrix)},matrix};
}
