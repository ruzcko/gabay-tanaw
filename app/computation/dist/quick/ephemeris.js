import { Series, utcToEt } from './coefficients.js';

const DEG = 180/Math.PI, C = 299792.458;
// NAIF moon_de440_250416.tf: ME421-aligned frame -> DE440 principal axes.
const ME_TO_PA = [ .9999998731138765,.00032895919698748533,-.00038152074340615683,
  -.0003289586579141938,.9999999458920105,.0000014757107425872328,
  .00038152120821145725,-.0000013502060036227025,.9999999272198697 ];

function rotation(angles              , out              , derivative              ) {
  const p=angles[0],d=angles[1],w=angles[2],pv=angles[3],dv=angles[4],wv=angles[5];
  const a=Math.cos(p), b=Math.sin(p), c=Math.cos(d), s=Math.sin(d), e=Math.cos(w), f=Math.sin(w);
  out[0]=e*a-f*c*b; out[1]=e*b+f*c*a; out[2]=f*s;
  out[3]=-f*a-e*c*b; out[4]=-f*b+e*c*a; out[5]=e*s;
  out[6]=s*b; out[7]=-s*a; out[8]=c;
  derivative[0]=-f*wv*a-e*b*pv-e*wv*c*b+f*s*dv*b-f*c*a*pv;
  derivative[1]=-f*wv*b+e*a*pv+e*wv*c*a-f*s*dv*a-f*c*b*pv;
  derivative[2]=e*wv*s+f*c*dv;
  derivative[3]=-e*wv*a+f*b*pv+f*wv*c*b+e*s*dv*b-e*c*a*pv;
  derivative[4]=-e*wv*b-f*a*pv-f*wv*c*a-e*s*dv*a-e*c*b*pv;
  derivative[5]=-f*wv*s+e*c*dv;
  derivative[6]=c*dv*b+s*a*pv; derivative[7]=-c*dv*a+s*b*pv; derivative[8]=-s*dv;
}
function paToMe(input              , out              ) {
  for (let r=0;r<3;r++) for(let c=0;c<3;c++)
    out[r*3+c]=ME_TO_PA[r]*input[c]+ME_TO_PA[3+r]*input[3+c]+ME_TO_PA[6+r]*input[6+c];
}

/** Scratch storage belongs to one worker/job. No object is allocated at each sample. */
export class QuickEphemeris {
           basis              ;
           site              ;
           orientation = new Float64Array(9);
                   pa = new Float64Array(9);
                   dpa = new Float64Array(9);
                   dm = new Float64Array(9);
                   angles = new Float64Array(6);
                   emb = new Float64Array(6);
                   moon = new Float64Array(6);
                   sun = new Float64Array(6);
                   earth = new Float64Array(6);
                   observer = new Float64Array(6);
                   target = new Float64Array(6);
                   bary = new Float64Array(6);
                   direction = new Float64Array(3);
                   emitted = new Float64Array(6);
                   emittedOrientation = new Float64Array(9);
          pack                      ;
          yearStart=Infinity;
          yearEnd=-Infinity;
           coefficients             ;
  constructor(coefficients              , latitude        , longitude        , groundM        ) {
    this.coefficients=coefficients;
    const p=latitude/DEG,l=longitude/DEG,cp=Math.cos(p),sp=Math.sin(p),cl=Math.cos(l),sl=Math.sin(l);
    // Ported local-basis helper, aligned with Tanaw's radial ENU contract.
    this.basis = new Float64Array([-sl,cl,0,-sp*cl,-sp*sl,cp,cp*cl,cp*sl,sp]);
    this.site = new Float64Array([cp*cl,cp*sl,sp].map(x=>x*(1737.4+(groundM+2)/1000)));
  }
          select(ms        ) {
    if(ms<this.yearStart||ms>=this.yearEnd) {
      const year=new Date(ms).getUTCFullYear();this.pack=this.coefficients.packAt(ms);
      this.yearStart=Date.UTC(year,0,1);
      this.yearEnd=this.coefficients.packs.has(year)?Date.UTC(year+1,0,1):ms;
    }
  }
  /** Output sun then earth, each [azimuth degrees,elevation degrees,range km,diameter degrees]. */
  sample(ms        , out              ) {
    this.select(ms);
    const et=utcToEt(ms), m=this.orientation, dm=this.dm;
    this.pack.get(31008) .evaluate(et,this.angles); rotation(this.angles,this.pa,this.dpa);
    paToMe(this.pa,m); paToMe(this.dpa,dm);
    this.pack.get(3) .evaluate(et,this.emb); this.pack.get(301) .evaluate(et,this.moon);
    this.pack.get(10) .evaluate(et,this.sun); this.pack.get(399) .evaluate(et,this.earth);
    for(let i=0;i<3;i++) {
      this.observer[i]=this.emb[i]+this.moon[i]+m[i]*this.site[0]+m[3+i]*this.site[1]+m[6+i]*this.site[2];
      this.observer[i+3]=this.emb[i+3]+this.moon[i+3]+dm[i]*this.site[0]+dm[3+i]*this.site[1]+dm[6+i]*this.site[2];
      this.earth[i]+=this.emb[i];
    }
    this.body(10,et,0,out); this.body(399,et,4,out);
  }
          body(code        , et        , offset        , out              ) {
    const p=this.direction,o=this.observer,t=this.target,m=this.orientation;
    let lt=0,range=0;
    for(let k=0;k<4;k++) {
      this.pack.get(code) .evaluate(et-lt,t);
      if(code===399) { this.pack.get(3) .evaluate(et-lt,this.bary); for(let i=0;i<3;i++) t[i]+=this.bary[i]; }
      for(let i=0;i<3;i++) p[i]=t[i]-o[i];
      range=Math.hypot(p[0],p[1],p[2]); const next=range/C;
      if(Math.abs(next-lt)<1e-10)break; lt=next;
    }
    for(let i=0;i<3;i++)p[i]/=range;
    // Finite-source monopole deflection (ERFA eraLd formula; see ERFA-LICENSE.txt).
    // A body's own centre is not deflected by itself. Solar/Earth terms suffice for this estimate.
    this.deflect(code===10 ? this.earth : this.sun, code===10 ? 8.870056e-6 : 2.95325008,
      code===10 ? 6378.1366 : 695700);
    // Special-relativistic aberration; ERFA eraAb, including solar potential term.
    const vx=o[3]/C,vy=o[4]/C,vz=o[5]/C,dot=p[0]*vx+p[1]*vy+p[2]*vz;
    const gamma=Math.sqrt(1-vx*vx-vy*vy-vz*vz),w1=1+dot/(1+gamma);
    const sd=Math.hypot(o[0]-this.sun[0],o[1]-this.sun[1],o[2]-this.sun[2]),w2=2.95325008/sd;
    const x=p[0]*gamma+w1*vx+w2*(vx-dot*p[0]),y=p[1]*gamma+w1*vy+w2*(vy-dot*p[1]),z=p[2]*gamma+w1*vz+w2*(vz-dot*p[2]);
    const len=Math.hypot(x,y,z);
    const mx=(m[0]*x+m[1]*y+m[2]*z)/len,my=(m[3]*x+m[4]*y+m[5]*z)/len,mz=(m[6]*x+m[7]*y+m[8]*z)/len;
    const b=this.basis,e=b[0]*mx+b[1]*my+b[2]*mz,n=b[3]*mx+b[4]*my+b[5]*mz,u=b[6]*mx+b[7]*my+b[8]*mz;
    out[offset]=(Math.atan2(e,n)*DEG+360)%360;out[offset+1]=Math.atan2(u,Math.hypot(e,n))*DEG;
    out[offset+2]=range;out[offset+3]=2*Math.asin((code===10?695700:6378.1366)/range)*DEG;
  }
  /**
   * Sub-solar then sub-Earth latitude/longitude (degrees, longitude east in [0,360)) in the
   * ME frame, as app/data/sun publishes them (Horizons quantities 15 and 14, Moon seen from
   * Earth's centre): the Moon's centre and orientation at emission t−lt; the sub-Earth point
   * toward Earth's centre at reception; the sub-solar point with Sun→Moon light time and the
   * Moon's aberration. Independent of the site; shares sample()'s scratch storage.
   */
  subPoints(ms        , out              , offset        ) {
    this.select(ms);
    const et=utcToEt(ms),e=this.earth,b=this.emb,mo=this.emitted,s=this.target,m=this.emittedOrientation;
    this.pack.get(3) .evaluate(et,b); this.pack.get(399) .evaluate(et,e);
    for(let i=0;i<3;i++) e[i]+=b[i];
    let lt=0,tau=et;
    for(let k=0;k<4;k++) {
      tau=et-lt; this.pack.get(3) .evaluate(tau,b); this.pack.get(301) .evaluate(tau,mo);
      for(let i=0;i<6;i++) mo[i]+=b[i];
      const next=Math.hypot(mo[0]-e[0],mo[1]-e[1],mo[2]-e[2])/C;
      if(Math.abs(next-lt)<1e-10)break; lt=next;
    }
    this.pack.get(31008) .evaluate(tau,this.angles); rotation(this.angles,this.pa,this.dpa); paToMe(this.pa,m);
    let up=0,range=0;
    for(let k=0;k<4;k++) {
      this.pack.get(10) .evaluate(tau-up,s);
      range=Math.hypot(s[0]-mo[0],s[1]-mo[1],s[2]-mo[2]); const next=range/C;
      if(Math.abs(next-up)<1e-10)break; up=next;
    }
    // First-order aberration by the Moon's barycentric velocity; Horizons q15 matches it.
    const x=(s[0]-mo[0])/range+mo[3]/C,y=(s[1]-mo[1])/range+mo[4]/C,z=(s[2]-mo[2])/range+mo[5]/C;
    this.latLon(m[0]*x+m[1]*y+m[2]*z,m[3]*x+m[4]*y+m[5]*z,m[6]*x+m[7]*y+m[8]*z,out,offset);
    const u=e[0]-mo[0],v=e[1]-mo[1],w=e[2]-mo[2];
    this.latLon(m[0]*u+m[1]*v+m[2]*w,m[3]*u+m[4]*v+m[5]*w,m[6]*u+m[7]*v+m[8]*w,out,offset+2);
  }
          latLon(x        , y        , z        , out              , offset        ) {
    out[offset]=Math.atan2(z,Math.hypot(x,y))*DEG; out[offset+1]=(Math.atan2(y,x)*DEG+360)%360;
  }
  /** Simultaneous geometric vectors, kept separate from apparent body placement. */
  geometry(ms        ) {
    const values=new Float64Array(8);this.sample(ms,values);
    const m=this.orientation,b=this.basis;
    const unit=(v         )=>{const n=Math.hypot(...v);return v.map(x=>x/n)                          ;};
    const moon=(body             )=>{
      const v=Array.from({length:3},(_,i)=>body[i]-this.emb[i]-this.moon[i]);
      return Array.from({length:3},(_,r)=>m[r*3]*v[0]+m[r*3+1]*v[1]+m[r*3+2]*v[2]);
    };
    const sunMoon=moon(this.sun),earthMoon=moon(this.earth),sunSite=sunMoon.map((x,i)=>x-this.site[i]);
    const local=Array.from({length:3},(_,r)=>b[r*3]*sunSite[0]+b[r*3+1]*sunSite[1]+b[r*3+2]*sunSite[2]);
    return {values,sunLocal:unit([local[0],local[2],-local[1]]),
      sunMoon:unit([sunMoon[0],sunMoon[2],-sunMoon[1]]),
      earthMoon:unit([earthMoon[0],earthMoon[2],-earthMoon[1]])};
  }
          deflect(body              , schwarzschildKm        , radiusKm        ) {
    const o=this.observer,t=this.target,p=this.direction;
    const ex=o[0]-body[0],ey=o[1]-body[1],ez=o[2]-body[2],em=Math.hypot(ex,ey,ez);
    const qx=t[0]-body[0],qy=t[1]-body[1],qz=t[2]-body[2],qm=Math.hypot(qx,qy,qz);
    const a=ex/em,b=ey/em,c=ez/em,d=qx/qm,e=qy/qm,f=qz/qm;
    const w=schwarzschildKm/em/Math.max(1+a*d+b*e+c*f,.5*(radiusKm/em)**2);
    const cx=b*f-c*e,cy=c*d-a*f,cz=a*e-b*d;
    const x=p[0]+w*(p[1]*cz-p[2]*cy),y=p[1]+w*(p[2]*cx-p[0]*cz),z=p[2]+w*(p[0]*cy-p[1]*cx);
    const norm=Math.hypot(x,y,z);p[0]=x/norm;p[1]=y/norm;p[2]=z/norm;
  }
}
