import * as THREE from '../vendor/three/three.module.js';
import { direction, validateSnapshot } from './math.js';
import { createTerrainLayer } from './terrain.js';
import { createAppearance } from './appearance.js';
import { createOverview } from './overview.js';
import { createSunMaterial, createSunGlow } from './display-materials.js';
import { observerZoom, observerVerticalFov, observerMaxDiagonal, faceSkyDisc } from './projection.js';
import { interpolateLook } from './look-motion.js';
export { createSnapshotLoader } from './math.js';

/** Framework-neutral observer/overview renderer. The host supplies all astronomy. */
export function createObserverView({ container, terrainProvider, assetProvider, onSiteSelect, onTerrainStatus = () => {}, onAssetStatus = () => {}, onError = () => {}, onStatusChange = () => {} }) {
  if (!(container instanceof HTMLElement)) throw new TypeError('A container element is required');
  const root = document.createElement('div'); root.className = 'observer-view';
  const viewport = document.createElement('div'); viewport.className = 'observer-viewport';
  const readout = document.createElement('div'); readout.className = 'observer-readout';
  const status = document.createElement('p'); status.className = 'observer-message'; status.setAttribute('role', 'status');
  status.textContent = 'Waiting for a site and UTC snapshot';
  const context = document.createElement('div'); context.className = 'observer-context';
  context.append(readout, status); root.append(viewport, context); container.append(root);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true }); }
  catch (error) { root.remove(); onError(error); throw error; }
  const canvas = renderer.domElement;
  canvas.tabIndex = 0; canvas.setAttribute('aria-label', 'Observer sky. Drag or use arrow keys to look; plus and minus zoom.');
  viewport.append(canvas);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 4000000);
  let observerFov = observerZoom.initial;
  function updateObserverProjection() {
    observerFov = Math.min(observerFov, observerMaxDiagonal(camera.aspect));
    camera.fov = observerVerticalFov(observerFov, camera.aspect);
    camera.updateProjectionMatrix();
  }
  const sunlight = new THREE.DirectionalLight(0xffffff, 0);
  sunlight.castShadow = true;
  sunlight.shadow.camera.left = sunlight.shadow.camera.bottom = -2200;
  sunlight.shadow.camera.right = sunlight.shadow.camera.top = 2200;
  sunlight.shadow.camera.near = 1; sunlight.shadow.camera.far = 12000;
  sunlight.shadow.normalBias = 0.5; sunlight.shadow.bias = -0.00002;
  scene.add(sunlight, sunlight.target, new THREE.AmbientLight(0xffffff, 0.08));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  camera.rotation.order = 'YXZ';
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000000, 4000000), new THREE.MeshBasicMaterial({ color: 0x343332, side: THREE.DoubleSide }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const horizon = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 256 }, (_, i) => new THREE.Vector3(Math.sin(i * Math.PI / 128) * 900000, 0, -Math.cos(i * Math.PI / 128) * 900000))), new THREE.LineBasicMaterial({ color: 0xa9a59c, depthTest: false }));
  horizon.renderOrder = 2; scene.add(horizon);
  const bodies = {};
  const sunGlow = createSunGlow();
  sunGlow.renderOrder = -1;
  for (const [name, color] of [['sun', 0xffedba], ['earth', 0x93b8d0]]) {
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 64), name === 'sun' ? createSunMaterial() : new THREE.MeshBasicMaterial({ color }));
    if (name === 'sun') { mesh.material.transparent = true; mesh.add(sunGlow); }
    mesh.visible = false; scene.add(mesh);
    const label = document.createElement('div'); label.className = 'observer-body'; label.dataset.body = name;
    label.setAttribute('role', 'button'); label.setAttribute('aria-disabled', 'true'); label.tabIndex = -1;
    label.title = `Look toward ${name === 'sun' ? 'Sun' : 'Earth'}`;
    const arrow = document.createElement('span'); arrow.className = 'observer-arrow'; arrow.setAttribute('aria-hidden', 'true');
    arrow.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5m-7 7 7-7 7 7"/></svg>';
    const text = document.createElement('span');
    const title = document.createTextNode(`${name === 'sun' ? 'Sun' : 'Earth'} · `);
    const values = document.createElement('span'); values.className = 'observer-value';
    const detail = document.createTextNode('');
    text.append(title, values, detail); label.append(arrow, text); readout.append(label);
    bodies[name] = { mesh, label, arrow, values, detail };
  }
  let snapshot, disposed = false, frame = 0, yaw = 0, pitch = 0, drag, mode='observer', overview, lookFlight;
  let options = { sunPointer: true, earthPointer: true, horizonLine: true, belowHorizonCutaway: false, bodySize: 'physical', quality: 'auto', tracking: null, verticalExaggeration: 1, decorativeTwinkling: false, starBrightness: 1, autoStarExposure: true };
  let terrainInfo = { state: 'unavailable' }, lastFrameMs = 0, renderCount=0, observerRenderCount=0, overviewRenderCount=0, slowFrames=0, autoReduced=false;
  const terrain = terrainProvider ? createTerrainLayer({ scene, provider: terrainProvider, invalidate, onError, onStatus: info => { terrainInfo = info; onTerrainStatus(info); } }) : null;
  const appearance = assetProvider ? createAppearance({ scene, provider: assetProvider, invalidate, onError, onStatus: onAssetStatus }) : null;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const listeners = new AbortController();
  const clamp = THREE.MathUtils.clamp;
  function invalidate() { if (!disposed && !frame && !document.hidden) frame = requestAnimationFrame(render); }
  function orient() { camera.rotation.set(pitch * Math.PI / 180, -yaw * Math.PI / 180, 0); camera.updateMatrixWorld(); }
  function render() {
    const started = performance.now();
    frame = 0; if (disposed || document.hidden) return;
    if(mode==='overview'){
      overview.update(snapshot,appearance?.terrainMap()||null,appearance?.moonMaps(),appearance?.earthMap());
      renderer.render(overview.scene,overview.camera);renderCount++;overviewRenderCount++;lastFrameMs=performance.now()-started;return;
    }
    if (lookFlight) {
      const progress = reducedMotion.matches ? 1 : Math.min(1, (started - lookFlight.started) / 650);
      const body = snapshot?.bodies[lookFlight.target];
      const target = body ? { yaw: body.azimuthDeg, pitch: body.elevationDeg } : { yaw: lookFlight.from.yaw, pitch: 0 };
      ({ yaw, pitch } = interpolateLook(lookFlight.from, target, progress));
      if (progress === 1) lookFlight = null;
      else invalidate();
    }
    orient();
    if (snapshot) {
      ground.visible = !options.belowHorizonCutaway && !terrain?.group.children.length;
      if (terrain) terrain.group.visible = !options.belowHorizonCutaway;
      const lightDirection = snapshot.lighting?.sunDirectionLocal;
      sunlight.intensity = lightDirection ? 3 : 0;
      if (lightDirection) sunlight.position.set(...lightDirection).multiplyScalar(5000);
      camera.position.y = Math.max(0.01, snapshot.site.observerHeightM);
      horizon.position.y = camera.position.y;
      camera.updateMatrixWorld();
      for (const name of ['sun', 'earth']) {
        const b = snapshot.bodies[name], item = bodies[name];
        // The forecast's terrain horizon decides: a body it hides isn't drawn above the nearby ground.
        const hidden = b.centerVisible === false;
        item.mesh.visible = !hidden;
        const vector = new THREE.Vector3(...direction(b.azimuthDeg, b.elevationDeg));
        item.mesh.position.copy(camera.position).addScaledVector(vector, 1000000);
        const diameter = options.bodySize === 'enhanced' ? Math.max(4, b.angularDiameterDeg) : b.angularDiameterDeg;
        faceSkyDisc(item.mesh, camera, diameter);
        const local = vector.clone().applyQuaternion(camera.quaternion.clone().invert());
        const point = item.mesh.position.clone().project(camera);
        const onscreen = local.z < 0 && Math.abs(point.x) < 1 && Math.abs(point.y) < 1;
        item.label.hidden = !options[`${name}Pointer`];
        let angle = Math.atan2(local.x, local.y || (local.z > 0 ? -1e-8 : 1e-8));
        if (onscreen) {
          const viewRect = canvas.getBoundingClientRect(), arrowRect = item.arrow.getBoundingClientRect();
          const targetX = viewRect.left + (point.x + 1) * viewRect.width / 2;
          const targetY = viewRect.top + (1 - point.y) * viewRect.height / 2;
          angle = Math.atan2(targetX - arrowRect.left - arrowRect.width / 2, arrowRect.top + arrowRect.height / 2 - targetY);
        }
        item.arrow.style.transform = `rotate(${angle}rad)`;
        item.values.textContent = `${b.azimuthDeg.toFixed(1)}° az · ${b.elevationDeg.toFixed(1)}° el`;
        item.detail.textContent = `${hidden ? ' · hidden by terrain' : b.elevationDeg < 0 ? ' · below horizon' : ''}${onscreen ? '' : ' · offscreen'}${local.z > 0 ? ' · behind you' : ''}`;
        item.values.parentElement.title = item.values.parentElement.textContent;
      }
      terrain?.setMap(appearance?.terrainMap() || null);
      const diameter = options.bodySize === 'enhanced' ? Math.max(4,snapshot.bodies.earth.angularDiameterDeg) : snapshot.bodies.earth.angularDiameterDeg;
      if (appearance?.update(snapshot,camera,bodies.earth.mesh,diameter,options.decorativeTwinkling && !reducedMotion.matches,options.starBrightness,options.autoStarExposure,renderer.getPixelRatio())) invalidate();
    }
    renderer.render(scene, camera);
    renderCount++;observerRenderCount++; lastFrameMs = performance.now() - started;
    slowFrames=lastFrameMs>24?slowFrames+1:0;
    if(options.quality==='auto' && slowFrames>=3 && !autoReduced){autoReduced=true;resize();}
  }
  function resize() {
    if (disposed) return;
    const { width, height } = viewport.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, options.quality === 'low' ? 1 : 2));
    const weak = options.quality === 'low' || (options.quality === 'auto' && ((navigator.hardwareConcurrency || 4) <= 4 || autoReduced));
    const shadowSize = weak ? 512 : 1024;
    if (sunlight.shadow.mapSize.x !== shadowSize) { sunlight.shadow.map?.dispose(); sunlight.shadow.map = null; sunlight.shadow.mapSize.set(shadowSize, shadowSize); }
    renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    camera.aspect = Math.max(1, width) / Math.max(1, height); updateObserverProjection(); invalidate();
    overview?.resize(Math.max(1,width),Math.max(1,height));
  }
  function lookToward(target, { animate = true } = {}) {
    if (disposed) return;
    let next;
    if (target === 'horizon') next = { yaw, pitch: 0 };
    else if (snapshot && ['sun', 'earth'].includes(target)) next = { yaw: snapshot.bodies[target].azimuthDeg, pitch: snapshot.bodies[target].elevationDeg };
    else throw new TypeError('Expected horizon, sun or earth with a snapshot');
    if (animate && !reducedMotion.matches) lookFlight = { from: { yaw, pitch }, target, started: performance.now() };
    else { lookFlight = null; ({ yaw, pitch } = next); }
    invalidate();
  }
  // Opening view: face Earth if the forecast shows it, else the Sun, framed low so the horizon and
  // ground fill the lower part of the view and the body sits above them (or no higher than the
  // upper quarter when it is high). With neither in view, look level toward the body nearest
  // above the horizon, else toward Earth.
  function frameOpening() {
    if (disposed || !snapshot) return;
    lookFlight = null;
    const { sun, earth } = snapshot.bodies, shown = [earth, sun].find(body => body.centerVisible === true);
    if (shown) {
      const halfHeight = Math.tan(camera.fov * Math.PI / 360), deg = 180 / Math.PI;
      yaw = shown.azimuthDeg;
      pitch = clamp(Math.max(Math.atan(0.3 * halfHeight) * deg, shown.elevationDeg - Math.atan(0.5 * halfHeight) * deg), -90, 90);
    } else {
      const above = [earth, sun].filter(body => body.elevationDeg >= 0).sort((a, b) => a.elevationDeg - b.elevationDeg)[0];
      yaw = (above || earth).azimuthDeg; pitch = 0;
    }
    invalidate();
  }
  function move(dx, dy) { if(mode==='overview'){overview.orbit(dx,dy);invalidate();return;}lookFlight = null;options.tracking = null; yaw = (yaw + dx + 360) % 360; pitch = clamp(pitch + dy, -90, 90); invalidate(); }
  function zoom(delta) { if(mode==='overview'){overview.zoom(delta);invalidate();return;}observerFov = clamp(observerFov + delta, observerZoom.min, observerMaxDiagonal(camera.aspect)); updateObserverProjection(); invalidate(); }
  const listen = (target, name, fn, extra = {}) => target.addEventListener(name, fn, { ...extra, signal: listeners.signal });
  for (const [name, item] of Object.entries(bodies)) {
    const focusBody = () => { if (snapshot && mode === 'observer') lookToward(name); };
    listen(item.label, 'click', focusBody);
    listen(item.label, 'keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusBody(); }
    });
  }
  listen(reducedMotion,'change',invalidate);
  listen(canvas, 'pointerdown', e => { if (e.button !== 0) return; lookFlight = null; drag = { id: e.pointerId, x: e.clientX, y: e.clientY, startX:e.clientX,startY:e.clientY,moved:false }; canvas.setPointerCapture(e.pointerId); });
  listen(canvas, 'pointermove', e => { if (!drag || drag.id !== e.pointerId) return; move((drag.x - e.clientX) * camera.fov / Math.max(1, canvas.clientHeight), (e.clientY - drag.y) * camera.fov / Math.max(1, canvas.clientHeight)); drag.x = e.clientX; drag.y = e.clientY; });
  listen(canvas,'pointermove',e=>{if(drag&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>5)drag.moved=true;});
  listen(canvas,'pointerup',e=>{if(drag?.id===e.pointerId&&!drag.moved&&mode==='overview'&&onSiteSelect){const selected=overview.select(e.clientX,e.clientY);if(selected)onSiteSelect(selected);}drag=null;});
  for (const event of ['pointercancel', 'lostpointercapture']) listen(canvas, event, () => { drag = null; });
  listen(canvas, 'wheel', e => { e.preventDefault(); zoom(Math.sign(e.deltaY) * 3); }, { passive: false });
  listen(canvas, 'keydown', e => {
    const keys = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] };
    if (keys[e.key]) { e.preventDefault(); move(...keys[e.key]); }
    if (['+', '=', '-'].includes(e.key)) { e.preventDefault(); zoom(e.key === '-' ? 3 : -3); }
  });
  listen(document, 'visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; drag = null; terrain?.pause(); appearance?.pause(); } else { if (snapshot&&mode==='observer') terrain?.update(snapshot.site, options.verticalExaggeration); appearance?.resume(); invalidate(); } });
  listen(canvas, 'webglcontextlost', e => { e.preventDefault(); status.textContent = 'Graphics context lost; waiting for recovery'; onStatusChange('error'); });
  listen(canvas, 'webglcontextrestored', () => { status.textContent = snapshot ? 'Graphics restored' : 'Waiting for snapshot'; invalidate(); });
  const observer = new ResizeObserver(resize); observer.observe(viewport); resize(); onStatusChange('waiting');
  const api = {
    setSnapshot(value) {
      if (disposed) return;
      try { const next = validateSnapshot(value); if (snapshot?.site.id !== next.site.id) lookFlight = null; snapshot = next; }
      catch (error) { onError(error); onStatusChange('error'); return false; }
      if (!document.hidden&&mode==='observer') terrain?.update(snapshot.site, options.verticalExaggeration);
      status.textContent = `${snapshot.quality === 'estimate' ? 'Estimate · ' : ''}${snapshot.instantUtc.slice(0,16).replace('T',' ')} UTC · ${options.bodySize === 'enhanced' ? 'Sun and Earth enlarged' : 'Sun and Earth to scale'}${appearance && !snapshot.earthAppearance ? ' · Earth rotation is illustrative' : ''}${terrain ? (options.verticalExaggeration !== 1 ? ` · Heights ×${options.verticalExaggeration}` : '') : ' · Flat ground until terrain loads'}`;
      if(mode==='overview')status.textContent=`${snapshot.quality === 'estimate' ? 'Estimate · ' : ''}${snapshot.instantUtc.slice(0,16).replace('T',' ')} UTC · ${snapshot.overview?'Schematic sizes and distances — not to scale'+(!snapshot.earthAppearance?' · Earth rotation is illustrative':''):'Waiting for Moon-frame overview data from computation module'}`;
      for (const item of Object.values(bodies)) { item.label.setAttribute('aria-disabled', 'false'); item.label.tabIndex = 0; }
      if (options.tracking && !lookFlight) lookToward(options.tracking, { animate: false });
      onStatusChange('ready'); invalidate(); return true;
    },
    setMode(nextMode, { focusSite = false } = {}) {
      if(disposed)return;if(!['observer','overview'].includes(nextMode))throw new TypeError('Expected observer or overview');
      if(mode===nextMode){if(mode==='overview'&&focusSite){overview?.focusSite(snapshot);invalidate();}return;}mode=nextMode;drag=null;lookFlight=null;
      if(mode==='overview'){overview??=createOverview(viewport);if(focusSite)overview.focusSite(snapshot);terrain?.pause();}
      else overview?.hideLabels();
      readout.hidden=mode==='overview';
      canvas.setAttribute('aria-label',mode==='overview'?'Lunar overview. Drag or use arrow keys to orbit; plus and minus zoom. Click Moon to request a site.':'Observer sky. Drag or use arrow keys to look; plus and minus zoom.');
      if(snapshot)api.setSnapshot(snapshot);else status.textContent='Waiting for a site and UTC snapshot';resize();
    },
    lookToward,
    frameOpening,
    setOptions(next) {
      if (disposed) return;
      for (const [key, value] of Object.entries(next)) {
        if (!(key in options)) throw new TypeError(`Unsupported option: ${key}`);
        if (key === 'verticalExaggeration' && (!Number.isFinite(value) || value < 1 || value > 10)) throw new TypeError('Exaggeration must be 1–10');
        if (['sunPointer', 'earthPointer', 'horizonLine', 'belowHorizonCutaway', 'decorativeTwinkling', 'autoStarExposure'].includes(key) && typeof value !== 'boolean') throw new TypeError(`Invalid ${key}`);
        if (key === 'starBrightness' && (!Number.isFinite(value) || value < 0 || value > 2)) throw new TypeError('Star brightness must be 0–2');
        if (key === 'bodySize' && !['physical', 'enhanced'].includes(value)) throw new TypeError('Invalid bodySize');
        if (key === 'quality' && !['auto', 'low', 'high'].includes(value)) throw new TypeError('Invalid quality');
        if (key === 'tracking' && ![null, 'sun', 'earth'].includes(value)) throw new TypeError('Invalid tracking');
      }
      options = { ...options, ...next }; horizon.visible = options.horizonLine;
      if (snapshot) api.setSnapshot(snapshot); resize();
    },
    resize,
    getDiagnostics() {
      let geometryBufferBytes=0;for(const activeScene of [scene,overview?.scene])activeScene?.traverse(object=>{if(object.geometry){for(const attribute of Object.values(object.geometry.attributes))geometryBufferBytes+=attribute.array.byteLength;geometryBufferBytes+=object.geometry.index?.array.byteLength||0;}});
      return { mode, cameraLook: { yaw, pitch, transitioning: !!lookFlight }, observerFovDeg:camera.fov, observerHorizontalFovDeg:2*Math.atan(Math.tan(camera.fov*Math.PI/360)*camera.aspect)*180/Math.PI, observerRenderCount,overviewRenderCount, overview:overview?.diagnostics()||null, siteId:snapshot?.site.id,instantUtc:snapshot?.instantUtc, frameCpuMs: lastFrameMs, renderCount, geometryBufferBytes, sky:appearance?.skyDiagnostics() || null, assetMemory:appearance?.memory() || null, terrain: { ...terrainInfo }, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, drawCalls: renderer.info.render.calls, shadowMapSize: sunlight.shadow.mapSize.x };
    },
    dispose() {
      if (disposed) return; disposed = true; cancelAnimationFrame(frame); listeners.abort(); observer.disconnect();
      overview?.dispose();terrain?.dispose(); appearance?.dispose(); sunlight.shadow.dispose();
      scene.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
      renderer.dispose(); renderer.forceContextLoss(); root.remove(); snapshot = null; onStatusChange('disposed');
    }
  };
  return api;
}
