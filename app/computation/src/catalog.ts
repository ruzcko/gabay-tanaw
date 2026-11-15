/** Cartographic reference to a catalogue point on the shared 1737.4 km sphere.
 * Distance is to the listed coordinate, not a crater rim or feature boundary. */
export function nearestLunarFeature(point:{lat:number;lon:number},catalog:readonly {name?:string;lat:number;lon:number}[]) {
  const valid=(p:typeof point)=>Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&Number.isFinite(p.lon);
  if(!valid(point))return null;
  const rad=Math.PI/180;
  const candidates=catalog.filter(p=>p.name&&valid(p)).map(feature=>{
    const a=feature.lat*rad,b=point.lat*rad,dl=(point.lon-feature.lon)*rad;
    const h=Math.sin((b-a)/2)**2+Math.cos(a)*Math.cos(b)*Math.sin(dl/2)**2;
    const angle=2*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))));
    const bearing=(Math.atan2(Math.sin(dl)*Math.cos(b),Math.cos(a)*Math.sin(b)-Math.sin(a)*Math.cos(b)*Math.cos(dl))/rad+360)%360;
    const direction=angle<1e-10||Math.PI-angle<1e-10||Math.abs(feature.lat)===90?null:
      ['N','NE','E','SE','S','SW','W','NW'][Math.round(bearing/45)%8];
    return {name:feature.name!,distanceKm:1737.4*angle,direction};
  });
  return candidates.sort((a,b)=>a.distanceKm-b.distanceKm)[0]??null;
}
