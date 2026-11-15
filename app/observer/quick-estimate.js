import { QUICK_RANGE, ESTIMATE_UNAVAILABLE } from '../computation/dist/quick/coverage.js';
import { createDatePicker } from './date-picker.js';

/** Date selection and readout only; the host owns one result for every viewer. */
export function createQuickEstimatePanel(container, { initialUtc, onSelect, onCancel = () => {}, published = null, compact = false }) {
  const form = container, date = container.querySelector('input[type="date"]');
  const status = container.querySelector('[role="status"]'), result = container.querySelector('[data-result]');
  const coverage = container.querySelector('[data-coverage]');
  const events = new AbortController();
  date.min = new Date(QUICK_RANGE.start).toISOString().slice(0, 10);
  date.max = new Date(QUICK_RANGE.end - 86400000).toISOString().slice(0, 10);
  date.value = initialUtc.slice(0, 10);
  const picker = createDatePicker(date, initialUtc, { published });
  coverage.textContent = `${QUICK_RANGE.firstYear}–${QUICK_RANGE.lastYear} · UTC · Select a date and UTC time. Estimates use coarse terrain; accurate data replaces them when available.`;
  const busy = value => form.setAttribute('aria-busy', String(value));
  // Keep the last readout in place so pending work never changes the timeline's height.
  let retainedWidth = 0;
  const retainSpace = () => {
    if (compact) return;
    for (const n of [status, result]) n.style.minHeight = `${Math.max(n.getBoundingClientRect().height, parseFloat(n.style.minHeight) || 0)}px`;
    retainedWidth = innerWidth;
  };
  window.addEventListener('resize', () => { if (retainedWidth !== innerWidth) { status.style.minHeight = result.style.minHeight = ''; retainedWidth = innerWidth; } }, { signal: events.signal });
  function selectedUtc() {
    const start = Date.parse(`${date.value}T${picker.hour}:${picker.minute}:00Z`);
    if (!/^\d{4}-\d\d-\d\d$/.test(date.value) || !Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== date.value)
      throw new Error('Choose a valid UTC date.');
    if (start < QUICK_RANGE.start || start >= QUICK_RANGE.end) throw new Error(ESTIMATE_UNAVAILABLE);
    return new Date(start).toISOString();
  }
  function validate() {
    form.classList.remove('published'); // validation errors remain visible after an accurate date
    date.removeAttribute('aria-invalid'); status.textContent = '';
    try { return selectedUtc(); } catch (error) { status.textContent = error.message; date.setAttribute('aria-invalid', 'true'); }
  }
  date.addEventListener('input', () => { retainSpace(); onCancel(); busy(false); validate(); }, { signal: events.signal });
  date.addEventListener('change', () => {
    const utc = validate(); if (utc) onSelect(utc);
  }, { signal: events.signal });
  form.addEventListener('submit', event => {
    event.preventDefault(); const utc = validate(); if (utc) onSelect(utc);
  }, { signal: events.signal });
  return {
    setDate(utc) { date.value = utc.slice(0, 10); picker.setDate(utc); },
    loading(utc, message = 'Updating forecast…') { retainSpace(); date.value = utc.slice(0, 10); picker.setDate(utc); date.removeAttribute('aria-invalid'); busy(true); status.textContent = message; },
    show({ data, quality, reason }, utc) {
      busy(quality === 'estimate' && reason !== 'unavailable'); const day = data.index.days.find(day => day.date === utc.slice(0, 10));
      result.textContent = compact ? `Daily totals · Sun above terrain ${day.sunHours.toFixed(2)} h · Earth in view ${day.earthHours.toFixed(2)} h` : `${quality === 'estimate' ? 'Estimate' : Date.parse(utc) % 3600000 ? 'Accurate forecast (interpolated)' : 'Accurate forecast'} · ${data.index.name || 'Selected location'} · ${day.date} UTC: Sun above terrain ${day.sunHours.toFixed(2)} h; Earth in view ${day.earthHours.toFixed(2)} h.`;
      status.textContent = quality === 'accurate' ? 'Accurate forecast loaded.' : reason === 'unavailable' ? compact ? 'Estimate · coarse terrain · accurate data unavailable' : 'Showing the estimate on coarse terrain; no accurate data for this location or date.' : 'Estimate ready. Checking accurate data…';
      retainSpace();
    },
    error(message) { busy(false); status.textContent = message; },
    dispose() { events.abort(); picker.dispose(); }
  };
}
