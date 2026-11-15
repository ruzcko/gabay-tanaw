import * as THREE from '../vendor/three/three.module.js';

/** NASA SVS celestial texture: RA 0 at centre, RA increases left, north at top.
 * Geometry is in catalog XYZ (+X RA0, +Y RA90, +Z north). The host supplies rotation.
 */
export function createMilkyWay(map) {
  const geometry = new THREE.SphereGeometry(1, 64, 32);
  const positions = geometry.attributes.position, uv = geometry.attributes.uv;
  // Mapping is derived from the sphere's continuous U coordinate, preserving its seam.
  // Rotate the usual Y-up sphere into the catalog basis; its centre meridian is +X.
  for (let i = 0; i < positions.count; i++) {
    const u = uv.getX(i), v = uv.getY(i), ra = (.5 - u) * 2 * Math.PI, dec = (v - .5) * Math.PI;
    positions.setXYZ(i, Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
  }
  // The RA mapping reverses the original winding: DoubleSide keeps the interior visible.
  const material = new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide, depthWrite: false,
    color: new THREE.Color().setScalar(.08), toneMapped: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.setScalar(3000000); mesh.frustumCulled = false; mesh.renderOrder = -2; mesh.visible = false;
  return mesh;
}

/** Shared fixed Hipparcos catalog; the host supplies its orientation. */
export function createStars(catalog) {
  const positions=[],brightness=[],magnitudes=[];
  for(const row of catalog.stars) {
    const [,ra,dec,mag]=row;
    if(![ra,dec,mag].every(Number.isFinite))throw new Error('Invalid star');
    const a=ra*Math.PI/180,d=dec*Math.PI/180;
    // ICRS axes: +X RA0, +Y RA90, +Z north; host rotates into local axes.
    positions.push(Math.cos(d)*Math.cos(a),Math.cos(d)*Math.sin(a),Math.sin(d));
    brightness.push(Math.min(1,Math.pow(10,-0.4*(mag+1.5))));
    magnitudes.push(mag);
  }
  const geometry=new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('brightness',new THREE.Float32BufferAttribute(brightness,1));
  geometry.setAttribute('magnitude',new THREE.Float32BufferAttribute(magnitudes,1));
  const starMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{time:{value:0},twinkle:{value:0},gain:{value:1},pixelRatio:{value:1},limit:{value:4.5}},vertexShader:`attribute float brightness; attribute float magnitude; varying float intensity; uniform float time; uniform float twinkle; uniform float gain; uniform float pixelRatio; uniform float limit;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main(){float exposure=1.-smoothstep(limit-.4,limit+.2,magnitude);intensity=min(1.,max(.04,pow(brightness,.35))*gain)*exposure*(1.+twinkle*.04*sin(time+position.x*83.));gl_PointSize=(1.3+2.2*sqrt(brightness))*pixelRatio;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
    #include <logdepthbuf_vertex>
    }`,fragmentShader:`varying float intensity;
    #include <logdepthbuf_pars_fragment>
    void main(){float radius=length(gl_PointCoord-.5);if(radius>.5)discard;
    #include <logdepthbuf_fragment>
    gl_FragColor=vec4(vec3(intensity),1.-smoothstep(.25,.5,radius));}`});
  const stars = new THREE.Points(geometry, starMaterial);
  stars.frustumCulled = false; stars.visible = false;
  return stars;
}
