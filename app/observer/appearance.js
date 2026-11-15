import * as THREE from '../vendor/three/three.module.js';
import {createEarthMaterial,updateBodyViewer} from './display-materials.js';
import { createMilkyWay, createStars } from './sky-material.js';

// Without a supplied Earth orientation, Earth's north follows the Moon's north (as on the main
// page) and longitude 0 faces the observer. Only the map's rotation is illustrative: the phase
// comes from the snapshot's Sun and Earth directions.
function illustrativeOrientation(latitudeDeg,towardViewer){
  const lat=latitudeDeg*Math.PI/180,north=new THREE.Vector3(0,Math.sin(lat),-Math.cos(lat));
  const x=towardViewer.clone().addScaledVector(north,-towardViewer.dot(north)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,north,x.clone().cross(north)));
}

export function createAppearance({ scene, provider, invalidate, onError, onStatus }) {
  let controller;
  const textures = [], bitmaps = [];
  let disposed = false, loaded=false, loading=false, earth, stars, milkyWay, catalogFrame, terrainTexture, terrainShading,earthTexture,normalTexture,polarTexture;
  function clear(){for(const object of [earth,stars,milkyWay])if(object){scene.remove(object);object.geometry.dispose();object.material.dispose();}for(const t of textures)t.dispose();for(const b of bitmaps)b.close();textures.length=bitmaps.length=0;earth=stars=milkyWay=terrainTexture=earthTexture=normalTexture=polarTexture=null;}
  async function texture(asset,signal,width=2048,data=false) {
    if (!asset?.url || !asset.source || !asset.license) throw new Error('Asset URL and attribution required');
    const response = await fetch(asset.url, { signal });
    if (!response.ok) throw new Error(`Asset request failed: ${response.status}`);
    const blob = await response.blob(); if (blob.size > 16*1024*1024) throw new Error('Texture exceeds 16 MB budget');
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY', resizeWidth: width });
    if (disposed || signal.aborted) { bitmap.close(); throw new DOMException('Disposed','AbortError'); }
    bitmaps.push(bitmap); const map = new THREE.Texture(bitmap); map.colorSpace=data?THREE.NoColorSpace:THREE.SRGBColorSpace;map.wrapS=THREE.RepeatWrapping;map.anisotropy=4; map.needsUpdate=true; textures.push(map); return map;
  }
  async function load() {
    if(disposed || loading || loaded || document.hidden)return;
    loading=true;controller=new AbortController();const signal=controller.signal;
    try {
      const assets = await provider.getAssets({ signal });
      if (disposed || signal.aborted) return;
      const earthMap = await texture(assets.earth,signal);
      earthTexture=earthMap;
      const material = createEarthMaterial(earthMap);
      earth = new THREE.Mesh(new THREE.SphereGeometry(1,48,32),material); earth.visible=false;scene.add(earth);
      terrainTexture=await texture(assets.terrain,signal,4096); terrainShading=assets.terrain.shading;
      if(assets.moonRelief){normalTexture=await texture(assets.moonRelief.normal,signal,2048,true);polarTexture=await texture(assets.moonRelief.polar,signal,2048,true);polarTexture.wrapS=THREE.ClampToEdgeWrapping;}
      const catalog=assets.catalog;
      if (!catalog?.frame || !catalog.source || !catalog.license || !Array.isArray(catalog.stars) || catalog.stars.length>5000) throw new Error('Invalid or oversized star catalog');
      catalogFrame=catalog.frame;
      stars=createStars(catalog); stars.scale.setScalar(2000000);scene.add(stars);
      invalidate();
      // A missing background must not discard the catalog stars or body textures.
      if (assets.milkyWay) {
        try { const map = await texture(assets.milkyWay, signal, 4096); milkyWay = createMilkyWay(map); scene.add(milkyWay); invalidate(); }
        catch (error) { if (!disposed && !signal.aborted) onError(new Error(`Milky Way background unavailable: ${error.message}`)); }
      }
      if (disposed || signal.aborted) return;
      loaded=true;loading=false;onStatus({state:'ready',stars:catalog.stars.length,earthShading:assets.earth.shading});invalidate();
    } catch(error) { if(!disposed && !signal.aborted) {loading=false;onError(error);onStatus({state:'error',message:error.message});} }
  }
  load();
  return {
    terrainMap() { return terrainShading === 'albedo' || terrainShading === 'albedo-approximation' ? terrainTexture : null; },
    moonMaps(){return normalTexture&&polarTexture&&terrainTexture?{color:terrainTexture,normal:normalTexture,polar:polarTexture}:null;},
    earthMap(){return earthTexture;},
    skyDiagnostics(){return { starsVisible: !!stars?.visible, milkyWayVisible: !!milkyWay?.visible,
      starsRotation: stars?.quaternion.toArray(), milkyWayRotation: milkyWay?.quaternion.toArray() };},
    memory(){const bitmapBytes=bitmaps.reduce((sum,b)=>sum+b.width*b.height*4,0);return {bitmapBytes,estimatedTextureBytesWithMipmaps:Math.ceil(bitmapBytes*4/3)};},
    update(snapshot,camera,earthDisc,diameter,twinkle,starBrightness=1,autoStarExposure=true,pixelRatio=1) {
      if(earth) {
        // The disc is already hidden when the forecast's terrain horizon hides Earth.
        earth.visible=earthDisc.visible && (!snapshot.earthAppearance || snapshot.earthAppearance.bodyFrame==='earth-fixed-x0-yNorth-zWest');
        if(earth.visible) {
          earth.position.copy(earthDisc.position);
          const supplied=snapshot.earthAppearance,sun=earth.material.uniforms.sun.value;
          if(supplied){earth.quaternion.fromArray(supplied.bodyToLocal);sun.fromArray(supplied.sunDirectionBody);}
          else {
            earth.quaternion.copy(illustrativeOrientation(snapshot.site.latitudeDeg,camera.position.clone().sub(earth.position).normalize()));
            sun.fromArray(snapshot.lighting?.sunDirectionLocal??[0,0,0]).applyQuaternion(earth.quaternion.clone().invert());
          }
          earth.scale.setScalar(1000000*Math.sin(diameter*Math.PI/360));updateBodyViewer(earth,camera);earthDisc.visible=false;
        }
      }
      if(stars) {stars.visible=snapshot.sky?.catalogFrame===catalogFrame;if(stars.visible){stars.position.copy(camera.position);stars.quaternion.fromArray(snapshot.sky.catalogToLocal);stars.material.uniforms.time.value=performance.now()/1000;stars.material.uniforms.twinkle.value=twinkle?1:0;stars.material.uniforms.gain.value=starBrightness;stars.material.uniforms.pixelRatio.value=pixelRatio;
        // Display exposure only, not an eye/camera sensitivity or lunar-sky model.
        stars.material.uniforms.limit.value=autoStarExposure&&snapshot.bodies.sun.centerVisible===true?1.5:4.5;
      }}
      if (milkyWay) {
        milkyWay.visible = snapshot.sky?.catalogFrame === catalogFrame;
        if (milkyWay.visible) {
          milkyWay.position.copy(camera.position); milkyWay.quaternion.fromArray(snapshot.sky.catalogToLocal);
          milkyWay.material.color.setScalar(.18 * starBrightness * (autoStarExposure && snapshot.bodies.sun.centerVisible ? .15 : 1));
        }
      }
      return !!(stars?.visible && twinkle);
    },
    pause(){if(!loaded){controller?.abort();loading=false;clear();}},
    resume:load,
    dispose(){disposed=true;controller?.abort();clear();}
  };
}
