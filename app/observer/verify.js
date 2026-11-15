import { createObserverView } from './index.js';
import { fixture } from './fixture.js';
const output = document.querySelector('#results'), lines = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); lines.push(`PASS ${message}`); output.textContent = lines.join('\n'); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
let a, b;
try {
  const first = document.querySelector('#first'), second = document.querySelector('#second');
  const errors = [];
  a = createObserverView({ container: first, onError: error => errors.push(error) });
  b = createObserverView({ container: second });
  const s = fixture(); a.setSnapshot(s); b.setSnapshot(s); a.lookToward('earth', { animate: false }); b.lookToward('sun', { animate: false });
  await frame();
  assert(document.querySelectorAll('canvas').length === 2, 'two independent instances render');
  assert(!first.querySelectorAll('.observer-body')[1].textContent.includes('offscreen'), 'Earth centered in first instance');
  assert(!second.querySelectorAll('.observer-body')[0].textContent.includes('offscreen'), 'Sun centered in second instance');
  const before = first.querySelector('.observer-message').textContent;
  assert(a.setSnapshot({}) === false && errors.length === 1, 'invalid snapshot reports error');
  assert(first.querySelector('.observer-message').textContent === before, 'last valid view is retained');
  for (let i = 0; i < 300; i++) { const next = fixture(); next.bodies.earth.azimuthDeg = 180; a.setSnapshot(next); }
  await frame();
  assert(first.querySelectorAll('.observer-body')[1].textContent.includes('behind you'), 'snapshot burst preserves camera orientation');
  a.setOptions({ tracking: 'earth' }); await frame();
  assert(!first.querySelectorAll('.observer-body')[1].textContent.includes('offscreen'), 'explicit tracking follows Earth');
  for (const elevation of [90, -90, 0]) { s.bodies.earth.elevationDeg = elevation; a.setSnapshot(s); a.lookToward('earth', { animate: false }); await frame(); assert(!first.querySelectorAll('.observer-body')[1].textContent.includes('offscreen'), `look at elevation ${elevation} stays stable`); }
  a.setOptions({ tracking: null });
  const startLook = a.getDiagnostics().cameraLook;
  first.querySelector('[data-body="sun"]').click();
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const starting = a.getDiagnostics().cameraLook;
    assert(starting.transitioning && starting.yaw === startLook.yaw && starting.pitch === startLook.pitch, 'readout click starts a transition without snapping');
    const began = performance.now(); while (performance.now() - began < 200) await frame();
    const midway = a.getDiagnostics().cameraLook;
    assert(midway.transitioning && (midway.yaw !== startLook.yaw || midway.pitch !== startLook.pitch), 'camera advances through intermediate orientations');
    first.querySelector('[data-body="earth"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    const retargeted = a.getDiagnostics().cameraLook;
    assert(retargeted.yaw === midway.yaw && retargeted.pitch === midway.pitch, 'keyboard retarget keeps the displayed orientation');
  } else first.querySelector('[data-body="earth"]').click();
  for (let i = 0; i < 120 && a.getDiagnostics().cameraLook.transitioning; i++) await frame();
  assert(!a.getDiagnostics().cameraLook.transitioning && !first.querySelector('[data-body="earth"]').textContent.includes('offscreen'), 'readout transition finishes centered on Earth');
  a.lookToward('sun');
  first.querySelector('canvas').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  assert(!a.getDiagnostics().cameraLook.transitioning, 'manual camera input interrupts the flight');
  second.style.width = '240px'; b.resize(); await frame();
  assert(second.querySelector('canvas').clientWidth === 240, 'instance resizes independently');
  const canvas = second.querySelector('canvas'), initial = b.getDiagnostics();
  for (let i = 0; i < 40; i++) canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '-' }));
  await frame();
  const wide = b.getDiagnostics();
  assert(wide.observerFovDeg > initial.observerFovDeg, 'observer can zoom out from its default view');
  assert(wide.observerFovDeg <= 90.000001 && wide.observerHorizontalFovDeg <= 150.000001, 'widest view stays within 90 degrees tall and 150 degrees wide');
  assert(wide.siteId === initial.siteId && wide.instantUtc === initial.instantUtc, 'zoom preserves the scientific site and time');
  canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 })); await frame();
  assert(b.getDiagnostics().observerFovDeg < wide.observerFovDeg, 'wheel zoom responds immediately from the widest view');
  a.dispose(); a.dispose(); a.setSnapshot(s); await frame();
  assert(first.children.length === 0 && second.querySelector('canvas'), 'idempotent disposal removes only its own instance');
  b.dispose(); assert(document.querySelectorAll('canvas').length === 0, 'all instance DOM removed');
  output.textContent += '\nAll browser checks passed.';
} catch (error) { output.textContent += `\nFAIL ${error.stack}`; }
finally { a?.dispose(); b?.dispose(); }
