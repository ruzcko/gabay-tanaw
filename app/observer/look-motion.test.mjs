import test from 'node:test';
import assert from 'node:assert/strict';
import { interpolateLook } from './look-motion.js';

test('camera turns through north instead of taking a full rotation', () => {
  assert.deepEqual(interpolateLook({ yaw: 350, pitch: 10 }, { yaw: 10, pitch: 30 }, .5), { yaw: 360, pitch: 20 });
  assert.deepEqual(interpolateLook({ yaw: 10, pitch: 30 }, { yaw: 350, pitch: 10 }, .5), { yaw: 0, pitch: 20 });
});

test('retargeting starts from the displayed view and reaches zenith or nadir without overshooting', () => {
  const from = { yaw: 270, pitch: 0 }, to = { yaw: 90, pitch: 90 };
  const midway = interpolateLook(from, to, .4);
  const next = { yaw: 300, pitch: -90 };
  assert.deepEqual(interpolateLook(midway, next, 0), midway);
  for (const t of [.1, .5, .9]) {
    const pose = interpolateLook(midway, next, t);
    assert.ok(pose.pitch >= -90 && pose.pitch <= midway.pitch);
  }
  const end = interpolateLook(midway, next, 2);
  assert.ok(Math.abs(((end.yaw - next.yaw) % 360 + 360) % 360) < 1e-9);
  assert.equal(end.pitch, -90);
});
