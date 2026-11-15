import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayback } from './playback.js';

function fixture(select, initial = '2026-12-01T00:00:00.000Z') {
  const button = new EventTarget(), attributes = new Map(), jobs = new Map();
  button.setAttribute = (key, value) => attributes.set(key, value);
  button.classList = { add() {}, remove() {} };
  const speedButton = new EventTarget(); speedButton.setAttribute = () => {};
  const state = { instantUtc: initial, startUtc: '2026-12-01T00:00:00.000Z', endUtc: '2026-12-03T00:00:00.000Z', length: 3 }; let serial = 0;
  const playback = createPlayback(button, { speedButton, state: () => state, select: offset => select(offset, state),
    schedule: fn => { jobs.set(++serial, fn); return serial; }, unschedule: id => jobs.delete(id) });
  return { playback, state, jobs, attributes, cycleSpeed: () => speedButton.dispatchEvent(new Event('click')), click: () => button.dispatchEvent(new Event('click')),
    tick(time) { const [id, fn] = jobs.entries().next().value; jobs.delete(id); return fn(time); } };
}

test('playback advances within a day and waits for the shared scene without overlapping requests', async () => {
  let finish;
  const f = fixture((utc, state) => new Promise(resolve => { finish = () => { state.instantUtc = utc; resolve(true); }; }));
  f.click(); await f.tick(0); const first = f.tick(16);
  assert.equal(f.jobs.size, 0, 'No overlapping scene requests while waiting');
  finish(); await first; assert.equal(f.state.instantUtc, '2026-12-01T00:02:00.000Z'); assert.equal(f.jobs.size, 1);
  const next = f.tick(10000); finish(); await next;
  assert.ok(Date.parse(f.state.instantUtc) < Date.parse('2026-12-01T00:10:00Z'), 'A stalled frame does not skip days');
  f.playback.dispose();
});

test('pausing an in-flight update cannot restart playback when it completes', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  f.click(); await f.tick(0); const pending = f.tick(16); f.click(); finish(true); await pending;
  assert.equal(f.jobs.size, 0); assert.equal(f.attributes.get('aria-label'), 'Play'); f.playback.dispose();
});

test('play from the final minute restarts at the beginning; a failed scene stops playback', async () => {
  const seen = [];
  const f = fixture((utc, state) => { seen.push(utc); state.instantUtc = utc; return seen.length === 1; }, '2026-12-03T23:59:00.000Z');
  f.click(); await f.tick(0); assert.deepEqual(seen, ['2026-12-01T00:00:00.000Z']);
  await f.tick(16); assert.equal(f.jobs.size, 0); assert.equal(f.attributes.get('aria-label'), 'Play'); f.playback.dispose();
});

test('playback stops exactly at the last supported minute', async () => {
  const f = fixture((utc, state) => { state.instantUtc = utc; return true; }, '2026-12-03T23:58:00.000Z');
  f.click(); await f.tick(0); await f.tick(50);
  assert.equal(f.state.instantUtc, '2026-12-03T23:59:00.000Z'); assert.equal(f.jobs.size, 0); f.playback.dispose();
});

test('speed control cycles 1×, 2×, 4×, 8×, 1× and scales elapsed simulation time', async () => {
  for (const [clicks, multiplier] of [[0, 1], [1, 2], [2, 4], [3, 8], [4, 1]]) {
    const f = fixture((utc, state) => { state.instantUtc = utc; return true; });
    for (let i = 0; i < clicks; i++) f.cycleSpeed();
    assert.equal(f.playback.speed, multiplier);
    f.click(); await f.tick(0); await f.tick(50);
    const expectedMinutes = Math.floor(50 * ((3 * 86400000 - 60000) / 30000) * multiplier / 60000);
    assert.equal(Date.parse(f.state.instantUtc) - Date.parse(f.state.startUtc), expectedMinutes * 60000);
    f.playback.dispose();
  }
});

test('rapid pause/resume waits for the old frame before requesting a new one', async () => {
  let finish, calls = 0;
  const f = fixture(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  f.click(); await f.tick(0); const oldFrame = f.tick(16);
  f.click(); f.click(); const resumedFrame = f.tick(32);
  assert.equal(calls, 1, 'Resume must not cancel the worker with a competing request');
  finish(false); await Promise.all([oldFrame, resumedFrame]);
  assert.equal(f.jobs.size, 1); assert.equal(f.attributes.get('aria-label'), 'Pause');
  await f.tick(48); const nextFrame = f.tick(64);
  assert.equal(calls, 2); f.playback.pause(); finish(false); await nextFrame;
  assert.equal(f.jobs.size, 0); f.playback.dispose();
});

test('changing speed while playing preserves position and keeps playback running', async () => {
  const f = fixture((utc, state) => { state.instantUtc = utc; return true; });
  f.click(); await f.tick(0); await f.tick(50); const before = f.state.instantUtc;
  f.cycleSpeed(); await f.tick(66);
  assert.equal(f.state.instantUtc, before, 'Speed changes do not jump the clock');
  await f.tick(116); assert.ok(f.state.instantUtc > before);
  assert.equal(f.attributes.get('aria-label'), 'Pause'); f.playback.dispose();
});
