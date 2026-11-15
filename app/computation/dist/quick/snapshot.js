

import { maskAt, TERRAIN_MODEL } from './terrain.js';
import { MODEL } from './coefficients.js';
import { localSky, SKY_MODEL } from '../sky-orientation.js';

/** Scientific scene adapter. All inputs describe one selected instant and modeled site. */
export function quickSnapshot(input                                                ,ms       ,
  ephemeris               ,horizon             )                  {
  const geometry=ephemeris.geometry(ms),v=geometry.values;
  const body=(offset       )=>({azimuthDeg:v[offset],elevationDeg:v[offset+1],rangeKm:v[offset+2],
    angularDiameterDeg:v[offset+3],centerVisible:v[offset+1]>maskAt(horizon.calculation.elevations,v[offset])});
  const p=input.lat*Math.PI/180,l=input.lon*Math.PI/180;
  // Moon display XYZ -> local east/up/south: R_x(latitude-90°) R_y(-(longitude+90°)).
  const a=(p-Math.PI/2)/2,b=-(l+Math.PI/2)/2;
  return {
    quality:'estimate',
    site:{id:input.id??`custom-${input.lat}-${input.lon}`,name:input.name??'Selected location',
      latitudeDeg:input.lat,longitudeEastDeg:input.lon,surfaceElevationM:horizon.surfaceElevation,
      observerHeightM:2,referenceFrame:'MOON_ME_DE421',elevationDatum:'sphere-1737400m',terrainModel:TERRAIN_MODEL},
    instantUtc:new Date(ms).toISOString(),directionKind:'apparent',interpolated:false,
    bodies:{sun:body(0),earth:body(4)},
    sky:localSky(ephemeris.orientation,input.lat,input.lon).sky,
    lighting:{sunDirectionLocal:geometry.sunLocal},
    overview:{axisConvention:'x0-yNorth-zWest',moonRadiusM:1737400,
      siteDirectionMoon:[Math.cos(p)*Math.cos(l),Math.sin(p),-Math.cos(p)*Math.sin(l)],
      sunDirectionMoon:geometry.sunMoon,earthDirectionMoon:geometry.earthMoon,
      moonToLocal:[Math.sin(a)*Math.cos(b),Math.cos(a)*Math.sin(b),Math.sin(a)*Math.sin(b),Math.cos(a)*Math.cos(b)]},
    provenance:{source:'NASA/JPL DE440; pinned lunar orientation and LOLA terrain',model:MODEL,
      warnings:['Quick estimate with coarse terrain; known leap seconds only.',
        SKY_MODEL,'Earth texture orientation and eclipses are unsupported.']}
  };
}
