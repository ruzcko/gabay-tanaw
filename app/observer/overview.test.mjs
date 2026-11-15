import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.js';
import {withOverviewFixture} from './overview-fixture.js';
import {validateSnapshot} from './math.js';
import * as THREE from '../vendor/three/three.module.js';
import {createOverview} from './overview.js';
import {createGlobeOrbit} from './globe-orbit.js';
import {compassAngle} from './globe-compass.js';
test('overview fixture shares site and instant and supplies normalized Moon-frame data',()=>{
  const s=fixture(),o=withOverviewFixture(s);assert.equal(o.site,s.site);assert.equal(o.instantUtc,s.instantUtc);assert.doesNotThrow(()=>validateSnapshot(o));assert.deepEqual(o.overview.siteDirectionMoon,[1,0,-0]);
});
test('incomplete, nonunit or unspecified Moon frames reject atomically',()=>{
  for(const edit of [o=>o.siteDirectionMoon=[2,0,0],o=>o.axisConvention='unknown',o=>o.moonRadiusM=0,o=>o.moonToLocal=[0,0,0,0]]){const s=withOverviewFixture(fixture());edit(s.overview);assert.throws(()=>validateSnapshot(s),/overview/);}
});

test('compass follows orbit roll and stays finite through the poles',()=>{
  const camera=new THREE.PerspectiveCamera(),orbit=createGlobeOrbit();
  orbit.focus([1,0,0]);orbit.apply(camera,5);
  assert.ok(Math.abs(compassAngle(camera)-Math.PI/2)<1e-8);
  camera.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2));
  assert.ok(Math.abs(compassAngle(camera))<1e-8);
  for(const pole of [[0,1,0],[0,-1,0]]){orbit.focus(pole);orbit.apply(camera,5);assert.ok(Number.isFinite(compassAngle(camera)));}
});

test('overview default framing contains every body on desktop and portrait; Earth uses its texture without dated rotation',()=>{
  const original=globalThis.document;
  const element=()=>({style:{},classList:{add(){}},setAttribute(){},append(){},remove(){},offsetWidth:120,offsetHeight:32});
  globalThis.document={createElement:element};
  const viewport={...element(),clientWidth:1000,clientHeight:400};
  const view=createOverview(viewport),map=new THREE.Texture();
  try {
    const snapshot=withOverviewFixture(fixture());
    for(const [width,height] of [[1000,400],[390,500]]) {
      viewport.clientWidth=width;viewport.clientHeight=height;view.resize(width,height);
      for(const axis of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
        snapshot.overview.sunDirectionMoon=axis;snapshot.overview.earthDirectionMoon=axis;
        view.update(snapshot,null,null,map);view.scene.updateMatrixWorld(true);
        const meshes=view.scene.children.filter(o=>o.isMesh);
        for(const mesh of meshes) {
          const positions=mesh.geometry.attributes.position;
          for(let i=0;i<positions.count;i++) {
            const p=new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld).project(view.camera);
            assert.ok(Math.abs(p.x)<1&&Math.abs(p.y)<1&&Math.abs(p.z)<1,'Body must not be cut by the viewport');
          }
        }
        const earth=meshes.find(m=>m.material.uniforms?.map);
        assert.equal(earth.material.uniforms.map.value,map);
        assert.ok(Math.abs(earth.position.length()-1.9)<1e-10);
        for(const name of ['sun','earth']){
          const dot=view.scene.getObjectByName(`${name}-surface-point`);
          assert.ok(dot.position.distanceTo(new THREE.Vector3(...axis).multiplyScalar(1.015))<1e-10);
          assert.equal(dot.visible,new THREE.Vector3(...axis).dot(view.camera.position)>1);
        }
      }
    }
    view.update({...snapshot,overview:null},null,null,map);
    for(const name of ['sun','earth'])assert.equal(view.scene.getObjectByName(`${name}-surface-point`).visible,false);
    view.hideLabels();
  } finally {view.dispose();map.dispose();globalThis.document=original;}
});
