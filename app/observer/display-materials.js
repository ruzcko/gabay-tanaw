import * as THREE from '../vendor/three/three.module.js';

// Display shaders only: no displacement, terrain samples or scientific inputs are changed.
const vertexShader=`varying vec3 body;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main(){body=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
  #include <logdepthbuf_vertex>
  }`;
export function createMoonMaterial(maps) {
  return new THREE.ShaderMaterial({uniforms:{colorMap:{value:maps.color},globalNormal:{value:maps.normal},polarNormal:{value:maps.polar},sun:{value:new THREE.Vector3(1,0,0)},viewer:{value:new THREE.Vector3(0,0,1)}},vertexShader,fragmentShader:`
    uniform sampler2D colorMap,globalNormal,polarNormal;uniform vec3 sun,viewer;varying vec3 body;
    #include <logdepthbuf_pars_fragment>
    vec4 wrapped(sampler2D map,vec2 uv){vec2 shifted=vec2(fract(uv.x+.5),uv.y);vec2 a=dFdx(uv),b=dFdy(uv),c=dFdx(shifted),d=dFdy(shifted);bool seam=abs(a.x)+abs(b.x)>abs(c.x)+abs(d.x);return textureGrad(map,uv,seam?c:a,seam?d:b);}
    vec3 restrained(vec3 n,vec3 radial,float strength){float outward=max(dot(n,radial),.05);return normalize(radial*outward+(n-radial*outward)*strength);}
    void main(){
    #include <logdepthbuf_fragment>
    vec3 p=normalize(body);float lat=asin(clamp(p.y,-1.,1.)),lon=atan(-p.z,p.x);
    vec2 uv=vec2(lon/6.28318530718+.5,lat/3.14159265359+.5);
    vec3 color=wrapped(colorMap,uv).rgb;
    vec3 n=restrained(normalize(wrapped(globalNormal,uv).xyz*2.-1.),p,.25);
    float r=2.*tan(3.14159265359/4.+lat/2.);
    vec2 puv=.5+vec2(r*sin(lon),r*cos(lon))/(2.*.26329);
    if(lat<radians(-74.)){vec3 pole=restrained(normalize(texture2D(polarNormal,puv).xyz*2.-1.),p,.333333);n=normalize(mix(n,pole,1.-smoothstep(radians(-77.),radians(-75.),lat)));}
    // Polar imagery is lower-resolution fill; blend gently into a neutral regolith tone.
    color=mix(color,vec3(.48,.46,.44),.65*(1.-smoothstep(radians(-86.),radians(-81.),lat)));
    float mu0=max(dot(n,sun),0.),mu=max(dot(n,viewer),0.);
    float light=1.25*mix(mu0,mu0/(mu0+mu+.0001),.55)*smoothstep(-.01,.03,dot(p,sun));
    gl_FragColor=vec4(color*(light+.035),1.);
    #include <colorspace_fragment>
    }`});
}
export function createEarthMaterial(map) {
  return new THREE.ShaderMaterial({uniforms:{map:{value:map},sun:{value:new THREE.Vector3(1,0,0)},viewer:{value:new THREE.Vector3(0,0,1)}},vertexShader,fragmentShader:`
    uniform sampler2D map;uniform vec3 sun,viewer;varying vec3 body;
    #include <logdepthbuf_pars_fragment>
    void main(){
    #include <logdepthbuf_fragment>
    vec3 n=normalize(body);vec2 uv=vec2(atan(-n.z,n.x)/6.28318530718+.5,asin(clamp(n.y,-1.,1.))/3.14159265359+.5);
    vec3 color=texture2D(map,uv).rgb;float lit=max(dot(n,sun),0.);
    // Match the main page's Blue Marble + Lambert sunlight and faint ambient fill.
    // No supplied lighting: show the map neutrally instead of inventing a phase.
    gl_FragColor=vec4(color*(length(sun)<.5?1.:lit+.04/3.14159265359),1.);
    #include <colorspace_fragment>
    }`});
}
export function updateBodyViewer(mesh,camera){mesh.material.uniforms?.viewer?.value.copy(camera.position).sub(mesh.position).applyQuaternion(mesh.quaternion.clone().invert()).normalize();}

/** The main Moon page's unlit Sun disc, using its semantic color. */
export function createSunMaterial() {
  const color = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement).getPropertyValue('--sun').trim() : '';
  return new THREE.MeshBasicMaterial({ color: color || '#ffc861' });
}

/** Same 2.5-radius, 35%-alpha radial falloff as the main page's Sun glow. */
export function createSunGlow() {
  const discMaterial = createSunMaterial(), color = discMaterial.color.clone(); discMaterial.dispose();
  const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
    uniforms: { color: { value: color } }, vertexShader,
    fragmentShader: `varying vec3 body; uniform vec3 color;
      #include <logdepthbuf_pars_fragment>
      void main(){
        #include <logdepthbuf_fragment>
        float alpha=.35*(1.-clamp((length(body.xy)-1.)/1.5,0.,1.));
        gl_FragColor=vec4(color,alpha);
        #include <colorspace_fragment>
      }` });
  return new THREE.Mesh(new THREE.PlaneGeometry(5,5), material);
}

export function addRegolithDetail(material) {
  material.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 regolithPosition;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nregolithPosition=position;');
    shader.fragmentShader=`varying vec3 regolithPosition;
      float dustHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float dustNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(dustHash(i),dustHash(i+vec2(1,0)),f.x),mix(dustHash(i+vec2(0,1)),dustHash(i+vec2(1,1)),f.x),f.y);}
      `+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec2 detail=regolithPosition.xz*3.;
      float footprint=max(length(dFdx(detail)),length(dFdy(detail)));
      float fade=(1.-smoothstep(.35,1.3,footprint))*(1.-smoothstep(20.,100.,length(vViewPosition)));
      float dust=(dustNoise(detail)*.7+dustNoise(detail*2.17+vec2(31.3,17.9))*.3-.5);
      float broadFootprint=max(length(dFdx(regolithPosition.xz*.4)),length(dFdy(regolithPosition.xz*.4)));
      float broadFade=(1.-smoothstep(.4,1.4,broadFootprint))*(1.-smoothstep(80.,300.,length(vViewPosition)));
      diffuseColor.rgb*=1.+dust*.16*fade+(dustNoise(regolithPosition.xz*.4)-.5)*.09*broadFade;`);
    // Millimetre-scale cosmetic bump only; never displaces the measured mesh or casts shadows.
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      float dustHeight=dust*.006*fade;
      vec3 dx=dFdx(-vViewPosition),dy=dFdy(-vViewPosition);
      vec3 rx=cross(dy,normal),ry=cross(normal,dx);
      float determinant=dot(dx,rx);
      if(abs(determinant)>1.e-12)normal=normalize(abs(determinant)*normal-sign(determinant)*(dFdx(dustHeight)*rx+dFdy(dustHeight)*ry));`);
  };
  material.customProgramCacheKey=()=> 'regolith-display-detail-v2';
  return material;
}
