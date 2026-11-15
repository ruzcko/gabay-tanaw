import * as THREE from '../vendor/three/three.module.js';
import { direction } from './math.js';

/** Demo-only coordinate fixture. Production supplies these fields from ComputationProvider. */
export function withOverviewFixture(snapshot) {
  const lat=snapshot.site.latitudeDeg*Math.PI/180,lon=snapshot.site.longitudeEastDeg*Math.PI/180;
  const up=new THREE.Vector3(Math.cos(lat)*Math.cos(lon),Math.sin(lat),-Math.cos(lat)*Math.sin(lon));
  const east=new THREE.Vector3(-Math.sin(lon),0,-Math.cos(lon));
  const south=new THREE.Vector3().crossVectors(east,up);
  const localToMoon=new THREE.Matrix4().makeBasis(east,up,south);
  const body=name=>new THREE.Vector3(...direction(snapshot.bodies[name].azimuthDeg,snapshot.bodies[name].elevationDeg)).transformDirection(localToMoon).toArray();
  return {...snapshot,overview:{axisConvention:'x0-yNorth-zWest',moonRadiusM:1737400,siteDirectionMoon:up.toArray(),sunDirectionMoon:body('sun'),earthDirectionMoon:body('earth'),moonToLocal:new THREE.Quaternion().setFromRotationMatrix(localToMoon.clone().transpose()).toArray()}};
}
