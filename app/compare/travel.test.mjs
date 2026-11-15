import { test } from 'node:test';
import assert from 'node:assert/strict';
import { travelComparisonResult } from './travel.js';

test('Travel comparison keeps exact coordinates, partial days, mixed sources and unknowns', () => {
  const result = { point: { lat: -85.987654321, lon: 0.123456789 }, days: [
    { date: '2027-02-26', durationHours: 22.2166666667, sunHours: 18.312345, earthHours: 0, quality: 'accurate' },
    { date: '2027-02-27', durationHours: 24, sunHours: 24, earthHours: 13.212345, quality: 'estimate' }
  ] };
  const comparison = travelComparisonResult(result);
  assert.equal(comparison.series, result.days);
  assert.equal(comparison.lat, result.point.lat);
  assert.equal(comparison.lon, result.point.lon);
  assert.equal(comparison.quality, 'mixed');
  result.days.push({ date: '2027-02-28', sunHours: null, earthHours: 0, quality: 'unknown' });
  assert.equal(travelComparisonResult(result).quality, 'unknown');
  assert.equal(comparison.series[2].sunHours, null);
  assert.equal(comparison.series[2].earthHours, 0);
});
