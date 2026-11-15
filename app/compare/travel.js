// Presentation adapter only. Keep the science module's exact partial-day values and gaps.
export function travelComparisonResult(result) {
  const qualities = new Set(result.days.map(day => day.quality));
  const quality = qualities.has('unknown') ? 'unknown'
    : qualities.size > 1 || qualities.has('mixed') ? 'mixed' : [...qualities][0] || 'unknown';
  return { ...result.point, quality, series: result.days };
}
