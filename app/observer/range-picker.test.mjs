import test from 'node:test';
import assert from 'node:assert/strict';
import { rangeDayCount, RANGE_LIMITS } from './range-picker.js';
import { createDateWindow } from './date-scrubber.js';

test('all allowed wheel ranges fit the one-year window and preserve the selected minute', () => {
  const utc = '2026-12-01T14:37:00Z';
  const model = createDateWindow('2026-12-01T00:00:00Z', '2027-12-01T00:00:00Z', utc);
  for (const [unit, max] of Object.entries(RANGE_LIMITS)) {
    for (let amount = 1; amount <= max; amount++) {
      const days = rangeDayCount(amount, unit, utc); model.range(days);
      assert.ok(days >= 1 && days <= 365); assert.equal(model.state.length, days);
      assert.equal(model.state.instantUtc, '2026-12-01T14:37:00.000Z');
    }
    for (const amount of [0, max + 1, 1.5, NaN]) assert.throws(() => rangeDayCount(amount, unit, utc));
  }
  assert.equal(rangeDayCount(52, 'week', utc), 364);
  assert.throws(() => rangeDayCount(1, 'invalid', utc));
});

test('calendar month ranges clamp month ends and never exceed 365 days', () => {
  assert.equal(rangeDayCount(1, 'month', '2027-01-31T14:37:00Z'), 28);
  assert.equal(rangeDayCount(1, 'month', '2028-01-31T14:37:00Z'), 29);
  assert.equal(rangeDayCount(3, 'month', '2026-12-01T00:00:00Z'), 90);
  assert.equal(rangeDayCount(12, 'month', '2028-01-01T00:00:00Z'), 365);
});
