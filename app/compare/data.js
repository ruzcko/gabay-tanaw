// Site comparison data: for each site and a date window, the daily Sun and Earth series and their
// summaries, from the published forecasts where they cover the window, else the quick estimate.
// No DOM and no science of its own: it only reads forecast-source products (index.days events
// and monthly hourly elevations) and adds them up. Every site carries its quality.

/** The example mission's needs, as the bar's Go call uses them (forecast.js NEEDS). */
export const NEEDS = { sunHours: 18, earthHours: 8 };

/** Phase 1 metrics: what each summary value is and which way is better, for charts and sorting. */
export const COMPARE_METRICS = [
  { id: 'bothHours', label: 'Sun and Earth up together', unit: 'h', better: 'high' },
  { id: 'sunPct', label: 'Sunlight', unit: '%', better: 'high' },
  { id: 'earthPct', label: 'Earth in view', unit: '%', better: 'high' },
  { id: 'goDays', label: 'Go days', unit: 'days', better: 'high' },
  { id: 'longestDarkHours', label: 'Longest darkness', unit: 'h', better: 'low' },
  { id: 'longestEarthGapHours', label: 'Longest Earth gap', unit: 'h', better: 'low' },
  { id: 'maxSunElDeg', label: 'Highest Sun', unit: '°', better: 'high' },
  { id: 'maxEarthElDeg', label: 'Highest Earth', unit: '°', better: 'high' },
];

const HOUR = 3600000, DAY = 86400000;
const PUBLISHED = { start: Date.parse('2026-12-01T00:00:00Z'), end: Date.parse('2027-12-01T00:00:00Z') };
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const months = (t0, t1) => {
  const out = [];
  for (let d = new Date(Date.UTC(new Date(t0).getUTCFullYear(), new Date(t0).getUTCMonth(), 1)); d < t1; d.setUTCMonth(d.getUTCMonth() + 1))
    out.push(d.toISOString().slice(0, 7));
  return out;
};

// A body's up intervals across the window, from the first day's state at 00:00 UTC and its rises
// and sets: [[from, to], ...] in ms, clipped to the window.
function upIntervals(days, body, t0, t1) {
  const events = days.flatMap((d) => [
    ...d[`${body}rise`].map((at) => [Date.parse(at), true]),
    ...d[`${body}set`].map((at) => [Date.parse(at), false]),
  ]).filter(([t]) => t > t0 && t < t1).sort((a, b) => a[0] - b[0]);
  const out = [];
  let up = days[0][`${body}UpAt0`], from = t0;
  for (const [t, rises] of events) {
    if (rises === up) continue;
    if (up) out.push([from, t]);
    up = rises; from = t;
  }
  if (up) out.push([from, t1]);
  return out;
}
const overlap = (a, b, t0, t1) => {
  let ms = 0;
  for (const [a0, a1] of a) for (const [b0, b1] of b) ms += Math.max(0, Math.min(a1, b1, t1) - Math.max(a0, b0, t0));
  return ms;
};
// The longest stretch inside the window not covered by the intervals (hours).
function longestGap(intervals, t0, t1) {
  let longest = 0, from = t0;
  for (const [a, b] of intervals) { longest = Math.max(longest, a - from); from = Math.max(from, b); }
  return Math.max(longest, t1 - from) / HOUR;
}

/** Daily series and summaries for one site from forecast days and their monthly hourly files. */
export function summarize(days, monthly, t0, t1) {
  const sun = upIntervals(days, 'sun', t0, t1), earth = upIntervals(days, 'earth', t0, t1);
  const elevation = (key, a, b) => {
    let max = -Infinity;
    for (const m of Object.values(monthly)) {
      const start = Date.parse(m.start), step = m.stepMinutes * 60000;
      m[key].forEach((v, i) => { const t = start + i * step; if (t >= a && t < b && v > max) max = v; });
    }
    return Number.isFinite(max) ? round(max, 1) : null;
  };
  const series = days.map((d) => {
    const a = Date.parse(`${d.date}T00:00:00Z`), b = a + DAY;
    return {
      date: d.date, sunHours: d.sunHours, earthHours: d.earthHours,
      bothHours: round(overlap(sun, earth, a, b) / HOUR),
      go: d.sunHours >= NEEDS.sunHours && d.earthHours >= NEEDS.earthHours,
      maxSunElDeg: elevation('sunEl', a, b), maxEarthElDeg: elevation('earthEl', a, b),
    };
  });
  const hours = (t1 - t0) / HOUR, sum = (k) => series.reduce((s, d) => s + d[k], 0);
  const max = (k) => series.reduce((m, d) => (d[k] !== null && (m === null || d[k] > m) ? d[k] : m), null);
  return {
    series,
    summary: {
      sunHours: round(sum('sunHours'), 1), sunPct: round(100 * sum('sunHours') / hours, 1),
      earthHours: round(sum('earthHours'), 1), earthPct: round(100 * sum('earthHours') / hours, 1),
      bothHours: round(sum('bothHours'), 1), bothPct: round(100 * sum('bothHours') / hours, 1),
      goDays: series.filter((d) => d.go).length,
      longestDarkHours: round(longestGap(sun, t0, t1), 1),
      longestEarthGapHours: round(longestGap(earth, t0, t1), 1),
      maxSunElDeg: max('maxSunElDeg'), maxEarthElDeg: max('maxEarthElDeg'),
    },
  };
}

/**
 * Compare sites over [startUtc, startUtc + days). Sites are catalogue entries ({id, name, lat, lon}).
 * `source` is a forecast-source (createForecastSource): published files when the window lies in
 * the published year, else source.load's product (quick estimate). Sites load one at a time;
 * onSite(result) reports each as it finishes. Resolves to {window, sites: [result, ...]} with
 * result = {id, name, lat, lon, quality: 'accurate' | 'estimate', series, summary} or {id, error}.
 */
export async function compareSites({ sites, startUtc, days, source, signal, onSite = () => {} }) {
  const t0 = Date.parse(startUtc), t1 = t0 + days * DAY;
  if (!Number.isFinite(t0) || t0 % DAY || !Number.isInteger(days) || days < 1) throw new Error('Choose a whole UTC day and a number of days');
  const results = [];
  for (const site of sites) {
    if (signal?.aborted) throw new DOMException('Comparison cancelled', 'AbortError');
    let result;
    try {
      let quality, dayList, monthly;
      if (t0 >= PUBLISHED.start && t1 <= PUBLISHED.end && !String(site.id).startsWith('custom-')) {
        const index = await source.published(`forecast/${site.id}.json`, signal);
        monthly = Object.fromEntries(await Promise.all(months(t0, t1).map(async (m) =>
          [m, await source.published(`forecast/${site.id}/${m}.json`, signal)])));
        dayList = index.days; quality = 'accurate';
      } else {
        const product = await source.load({ id: site.id, name: site.name, lat: site.lat, lon: site.lon,
          startUtc: new Date(t0).toISOString(), endUtc: new Date(t1).toISOString() }, () => {});
        dayList = product.data.index.days; monthly = product.data.monthly ?? {}; quality = product.quality;
      }
      const inWindow = dayList.filter((d) => { const t = Date.parse(`${d.date}T00:00:00Z`); return t >= t0 && t < t1; });
      if (inWindow.length !== days) throw new Error(`Expected ${days} days, got ${inWindow.length}`);
      result = { id: site.id, name: site.name, lat: site.lat, lon: site.lon, quality, ...summarize(inWindow, monthly, t0, t1) };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      result = { id: site.id, name: site.name, error: error.message };
    }
    results.push(result);
    onSite(result);
  }
  return { window: { startUtc: new Date(t0).toISOString(), endUtc: new Date(t1).toISOString(), days }, sites: results };
}

/** Sites sorted by one metric, best first; errors and missing values last. */
export function rankBy(comparison, metricId) {
  const metric = COMPARE_METRICS.find((m) => m.id === metricId);
  if (!metric) throw new Error(`Unknown metric ${metricId}`);
  const value = (s) => s.summary?.[metricId];
  return [...comparison.sites].sort((a, b) => {
    const va = value(a), vb = value(b);
    if (va == null || vb == null) return (va == null) - (vb == null);
    return metric.better === 'high' ? vb - va : va - vb;
  });
}
