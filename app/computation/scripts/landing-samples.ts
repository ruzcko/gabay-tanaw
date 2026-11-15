import type { LandingPoint } from '../src/landing.ts';

/** Reproducible test locations, stratified uniformly in sin(latitude) and longitude.
 * These are synthetic test coordinates, never mission sites or scientific discoveries.
 */
export function randomLandingSamples(seed=20261115,rows=8,columns=12):LandingPoint[] {
  if(!Number.isInteger(seed)||!Number.isInteger(rows)||!Number.isInteger(columns)||rows<2||columns<4||rows*columns>4096)
    throw new Error('Invalid seed or sample grid');
  let state=seed>>>0;
  const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return (state+.5)/4294967296;};
  const points:LandingPoint[]=[];
  for(let r=0;r<rows;r++)for(let c=0;c<columns;c++)points.push({id:`random-${r}-${c}`,name:`Synthetic random sample ${r+1}/${c+1}`,
    lat:Math.asin(-1+2*(r+random())/rows)*180/Math.PI,lon:360*(c+random())/columns});
  return points;
}
