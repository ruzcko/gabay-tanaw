import test from 'node:test';
import { QUICK_RANGE } from '../computation/dist/quick/coverage.js';
import assert from 'node:assert/strict';
import { createDateWindow } from './date-scrubber.js';

test('handoff preserves Feb 26 / 30 days / Mar 1 through scrubbing and estimate mode', () => {
  for (const [start, end] of [['2026-12-01T00:00:00Z', '2027-12-01T00:00:00Z'], [new Date(QUICK_RANGE.start).toISOString(), new Date(QUICK_RANGE.end).toISOString()]]) {
    const model = createDateWindow(start, end, '2027-03-01T01:08:00Z', { windowStartUtc: '2027-02-26T00:00:00Z', rangeDays: 30 });
    assert.equal(model.state.startUtc, '2027-02-26T00:00:00.000Z');
    assert.equal(model.state.endUtc, '2027-03-27T00:00:00.000Z');
    assert.equal(model.state.offset, 3); assert.equal(model.state.length, 30);
    model.seek('2027-03-02T23:59:00Z'); model.range(52);
    assert.equal(model.state.startUtc, '2027-02-26T00:00:00.000Z');
    assert.equal(model.state.instantUtc, '2027-03-02T23:59:00.000Z');
  }
});

test('long handoffs retain a selection past day 30 and reject out-of-window times', () => {
  const start = '2026-12-01T00:00:00Z', end = '2027-12-01T00:00:00Z';
  const model = createDateWindow(start, end, '2027-11-30T23:59:00Z', { windowStartUtc: start, rangeDays: 365 });
  assert.equal(model.state.offset, 364); assert.equal(model.state.length, 365);
  for (const windowStartUtc of ['invalid', '2026-11-30T00:00:00Z', '2027-01-01T01:00:00Z', '2027-03-01T00:00:00Z'])
    assert.throws(() => createDateWindow(start, end, '2027-02-01T00:00:00Z', { windowStartUtc, rangeDays: 30 }));
});

test('ranges preserve UTC date/hour and clamp at both ends of the saved year', () => {
  const model = createDateWindow('2026-12-01T00:00:00Z', '2027-12-01T00:00:00Z', '2027-02-28T14:00:00Z');
  for (const range of [365, 30, 91]) { model.range(range); assert.equal(model.state.instantUtc, '2027-02-28T14:00:00.000Z'); }
  model.range(365); model.select(0); assert.equal(model.state.instantUtc, '2026-12-01T14:00:00.000Z');
  model.select(364); assert.equal(model.state.instantUtc, '2027-11-30T14:00:00.000Z');
  model.range(30); assert.equal(model.state.offset, 29); assert.equal(model.state.endUtc, '2027-11-30T00:00:00.000Z');
  assert.throws(() => model.select(30));
});

test('date windows reject unsaved times and exclusive year end', () => {
  for (const utc of ['2027-12-01T00:00:00Z', '2026-12-01T00:01:01Z', '2027-02-29T00:00:00Z', 'invalid'])
    assert.throws(() => createDateWindow('2026-12-01T00:00:00Z', '2027-12-01T00:00:00Z', utc));
});

test('minute selection survives range and day changes', () => {
  const model=createDateWindow('2026-12-01T00:00:00Z','2027-12-01T00:00:00Z','2027-02-28T14:37:00Z');
  model.range(365); model.select(0); assert.equal(model.state.instantUtc,'2026-12-01T14:37:00.000Z');
});

test('continuous playback accepts exact minutes across midnight and preserves the paused time', () => {
  const model = createDateWindow('2026-12-01T00:00:00Z', '2027-12-01T00:00:00Z');
  model.seek('2026-12-02T00:37:00.000Z'); assert.equal(model.state.offset, 1);
  model.select(3); assert.equal(model.state.instantUtc, '2026-12-04T00:37:00.000Z');
  assert.throws(() => model.seek('2026-12-31T00:00:00Z'));
  assert.throws(() => model.seek('2026-12-04T00:37:01Z'));
});

test('picker starts the requested range at the chosen minute and retains its anchor while scrubbing',()=>{
  for(const range of [30,91,365]) {
    const model=createDateWindow(new Date(QUICK_RANGE.start).toISOString(),new Date(QUICK_RANGE.end).toISOString(),'2028-02-29T14:37:00Z',{fromSelection:true});
    model.range(range); assert.equal(model.state.offset,0); assert.equal(model.state.length,range);
    assert.equal(model.state.startUtc,'2028-02-29T00:00:00.000Z');
    model.select(range-1);assert.equal(model.state.startUtc,'2028-02-29T00:00:00.000Z');assert.ok(model.state.instantUtc.endsWith('T14:37:00.000Z'));
  }
  const last=createDateWindow(new Date(QUICK_RANGE.start).toISOString(),new Date(QUICK_RANGE.end).toISOString(),'2100-12-31T23:59:00Z',{fromSelection:true});
  last.range(365);assert.equal(last.state.offset,0);assert.equal(last.state.length,1);assert.equal(last.state.rangeDays,365);
});
