import * as THREE from '../vendor/three/three.module.js';
import { createGlobeOrbit } from './globe-orbit.js';
import {createMoonMaterial,createEarthMaterial,createSunMaterial,updateBodyViewer} from './display-materials.js';

/** Display-only schematic in the supplied Moon frame. No ephemeris or simulation clock. */
export function createOverview(viewport) {
  const scene=new THREE.Scene();scene.background=new THREE.Color(0);
  const camera=new THREE.PerspectiveCamera(45,1,0.01,100);
  const moon=new THREE.Mesh(new THREE.SphereGeometry(1,64,32),new THREE.MeshStandardMaterial({color:0x999999,roughness:1}));scene.add(moon);
  const light=new THREE.DirectionalLight(0xffffff,2);scene.add(light,new THREE.AmbientLight(0xffffff,.16));
  const marker=new THREE.Object3D();scene.add(marker);
  const sitePin=document.createElement('span');sitePin.className='overview-site-marker';sitePin.hidden=true;sitePin.setAttribute('aria-hidden','true');viewport.append(sitePin);
  const bodies={},dots={};
  const labels={};
  for(const name of ['site','earth','sun']){const label=document.createElement('span');label.className='overview-label';label.hidden=true;viewport.append(label);labels[name]=label;}
  labels.site.classList.add('overview-site-label');
  for(const [name,radius,color] of [['earth',.23,0x93b8d0],['sun',.24,0xffedba]]){const body=new THREE.Mesh(new THREE.SphereGeometry(radius,48,32),name==='sun'?createSunMaterial():new THREE.MeshBasicMaterial({color}));scene.add(body);bodies[name]=body;}
  for(const name of ['sun','earth']){
    const token=typeof getComputedStyle==='function'?getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim():'';
    const dot=new THREE.Mesh(new THREE.SphereGeometry(.045,16,12),new THREE.MeshBasicMaterial({color:token||(name==='sun'?'#ffc861':'#8cc4ff')}));
    dot.name=`${name}-surface-point`;scene.add(dot);dots[name]=dot;
  }
  let distance=6.7,snapshot,initialized=false;
  const orbit = createGlobeOrbit(); orbit.focus([1,.5,1]);
  const raycaster=new THREE.Raycaster();
  function orient(){orbit.apply(camera,distance);}
  function label(name,position,text,visible){const element=labels[name],point=position.clone().project(camera);element.hidden=!visible||point.z>1||point.z< -1||Math.abs(point.x)>1||Math.abs(point.y)>1;if(!element.hidden){element.textContent=text;let x=(point.x*.5+.5)*viewport.clientWidth,y=(-point.y*.5+.5)*viewport.clientHeight;
    {
      const width=element.offsetWidth,height=element.offsetHeight;
      if(name!=='site')y+=point.y<0?28:-28;
      x=(name!=='site'&&point.x<0)||x+18+width>viewport.clientWidth-8?x-18-width:x+18;
      x=Math.max(8,Math.min(x,viewport.clientWidth-width-8));
      y=Math.max(height/2+8,Math.min(y,viewport.clientHeight-height/2-8));
      element.style.transform='translateY(-50%)';
    }
    element.style.left=`${x}px`;element.style.top=`${y}px`;}}
  function occluded(position){const delta=position.clone().sub(camera.position),length=delta.length();raycaster.set(camera.position,delta.normalize());const hits=raycaster.intersectObject(moon);return !!hits.length && hits[0].distance<length-.001;}
  return {
    scene,camera,
    update(value,map,maps,earthMap){snapshot=value;
      if(!initialized&&snapshot?.overview){orbit.focus(snapshot.overview.siteDirectionMoon);initialized=true;}
      orient();scene.updateMatrixWorld(true);const data=snapshot?.overview;
      if(maps&&data){if(!moon.material.uniforms||moon.material.uniforms.colorMap.value!==maps.color){moon.material.dispose();moon.material=createMoonMaterial(maps);}moon.material.uniforms.sun.value.fromArray(data.sunDirectionMoon);updateBodyViewer(moon,camera);}
      else {if(moon.material.isShaderMaterial){moon.material.dispose();moon.material=new THREE.MeshStandardMaterial({roughness:1});}if(moon.material.map!==map){moon.material.map=map;moon.material.color.set(map?0xffffff:0x999999);moon.material.needsUpdate=true;}}
      marker.visible=!!data;for(const body of [...Object.values(bodies),...Object.values(dots)])body.visible=!!data;
      if(!data){for(const element of Object.values(labels))element.hidden=true;sitePin.hidden=true;light.intensity=0;return;}
      light.intensity=2;light.position.fromArray(data.sunDirectionMoon).multiplyScalar(10);
      const site=new THREE.Vector3(...data.siteDirectionMoon);
      marker.position.copy(site).multiplyScalar(1.01);
      marker.visible=site.dot(camera.position)>1;
      label('site',marker.position,`Current site · ${snapshot.site.name || snapshot.site.id}`,marker.visible);
      sitePin.hidden=labels.site.hidden;
      if(!sitePin.hidden){const point=marker.position.clone().project(camera);sitePin.style.left=`${(point.x*.5+.5)*viewport.clientWidth}px`;sitePin.style.top=`${(-point.y*.5+.5)*viewport.clientHeight}px`;}
      for(const name of ['sun','earth']){
        const direction=new THREE.Vector3(...data[`${name}DirectionMoon`]),body=bodies[name];
        body.position.copy(direction).multiplyScalar(name==='sun'?2.5:1.9);
        dots[name].position.copy(direction).multiplyScalar(1.015);
        dots[name].visible=direction.dot(camera.position)>1;
        label(name,body.position,name==='sun'?'Sun':'Earth',!occluded(body.position));
      }
      updateBodyViewer(bodies.sun,camera);
      const earth=bodies.earth;
      if(earthMap){
        if(!earth.material.uniforms||earth.material.uniforms.map.value!==earthMap){earth.material.dispose();earth.material=createEarthMaterial(earthMap);}
        if(snapshot.earthAppearance){earth.quaternion.fromArray(data.moonToLocal).invert().multiply(new THREE.Quaternion().fromArray(snapshot.earthAppearance.bodyToLocal));earth.material.uniforms.sun.value.fromArray(snapshot.earthAppearance.sunDirectionBody);}
        else {earth.quaternion.identity();earth.material.uniforms.sun.value.fromArray(data.sunDirectionMoon);}
        updateBodyViewer(earth,camera);
      }
      else if(earth.material.isShaderMaterial){earth.material.dispose();earth.material=new THREE.MeshBasicMaterial({color:0x93b8d0});}
    },
    hideLabels(){for(const element of Object.values(labels))element.hidden=true;sitePin.hidden=true;},
    focusSite(value){
      const site=value?.overview?.siteDirectionMoon;
      if(!site)return;
      orbit.focus(site);
      distance=6.7;
      initialized=true;
    },
    resize(width,height){camera.aspect=width/height;camera.fov=2*Math.atan(Math.tan(Math.PI/8)/Math.min(1,camera.aspect))*180/Math.PI;camera.updateProjectionMatrix();},
    orbit(dx,dy){orbit.turn(dx,dy);},
    zoom(delta){distance=THREE.MathUtils.clamp(distance*Math.exp(delta*.035),2.5,18);},
    select(clientX,clientY){if(!snapshot?.overview)return null;orient();scene.updateMatrixWorld(true);const rect=viewport.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1),camera);const hit=raycaster.intersectObject(moon)[0];if(!hit)return null;const p=hit.point.normalize();return {latitudeDeg:Math.asin(THREE.MathUtils.clamp(p.y,-1,1))*180/Math.PI,longitudeEastDeg:Math.atan2(-p.z,p.x)*180/Math.PI,referenceFrame:snapshot.site.referenceFrame};},
    diagnostics(){return {distance,orientation:orbit.quaternion,siteMarkerVisible:marker.visible};},
    dispose(){scene.traverse(object=>{object.geometry?.dispose();object.material?.dispose();});for(const element of Object.values(labels))element.remove();sitePin.remove();}
  };
}
