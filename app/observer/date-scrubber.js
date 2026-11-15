import { createRangePicker, rangeDayCount } from './range-picker.js';
import { createForecastStrip } from './forecast-strip.js';

const DAY = 86400000;
const format = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** UTC-label selection only. Scientific observations come from the saved-data provider. */
export function createDateWindow(startUtc, endUtc, initialUtc = startUtc, { fromSelection = false, windowStartUtc, rangeDays = 30 } = {}) {
  const start = Date.parse(startUtc), end = Date.parse(endUtc), initial = Date.parse(initialUtc);
  const count = (end - start) / DAY;
  const canonical = initialUtc.replace(/(?:\.000)?Z$/, '.000Z');
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:00(?:\.000)?Z$/.test(initialUtc) || !Number.isInteger(count) || count < 1 || !Number.isFinite(initial) || initial < start || initial >= end || initial % 60000 !== 0 || new Date(initial).toISOString() !== canonical)
    throw new Error('Select a UTC minute within the date range.');
  if (!Number.isInteger(rangeDays) || rangeDays < 1 || rangeDays > 365) throw new Error('Unsupported date range');
  const suppliedStart = windowStartUtc === undefined ? null : Date.parse(windowStartUtc);
  if (suppliedStart !== null && (!Number.isFinite(suppliedStart) || suppliedStart % DAY || suppliedStart < start || initial < suppliedStart || initial >= Math.min(end, suppliedStart + rangeDays * DAY)))
    throw new Error('Selected time must be inside the supplied date window.');
  let day = Math.floor((initial - start) / DAY), length = Math.min(rangeDays, count), windowStart = 0;
  const anchor = suppliedStart === null ? day : (suppliedStart - start) / DAY; let requestedLength = rangeDays;
  fromSelection ||= suppliedStart !== null;
  let hour = (initial - start) % DAY;
  const fit = () => { if (fromSelection) { windowStart = anchor; length = Math.min(requestedLength, count-anchor); day = Math.min(day, anchor+length-1); return; } windowStart = Math.max(0, Math.min(day - Math.floor(length / 3), count - length)); };
  fit();
  return {
    range(days) { if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Unsupported date range'); requestedLength = days; length = Math.min(days, count); fit(); },
    select(offset) { if (!Number.isInteger(offset) || offset < 0 || offset >= length) throw new Error('Date outside visible range'); day = windowStart + offset; },
    seek(utc) {
      const time = Date.parse(utc), first = start + windowStart * DAY;
      if (!Number.isFinite(time) || time % 60000 || time < first || time >= first + length * DAY) throw new Error('Time outside visible range');
      day = Math.floor((time - start) / DAY); hour = (time - start) % DAY;
    },
    get state() { return { rangeDays: requestedLength, length, offset: day - windowStart, instantUtc: new Date(start + day * DAY + hour).toISOString(), startUtc: new Date(start + windowStart * DAY).toISOString(), endUtc: new Date(start + (windowStart + length - 1) * DAY).toISOString() }; }
  };
}

export function createDateScrubber(container, { startUtc, endUtc, initialUtc, rangeDays = 30, windowStartUtc, fromSelection = false, preferRangeDays = false, onChange }) {
  const model = createDateWindow(startUtc, endUtc, initialUtc, {fromSelection, windowStartUtc, rangeDays});
  model.range(rangeDays);
  const events = new AbortController();
  const slider = container.querySelector('input[type="range"]'), output = container.querySelector('output');
  const buttons = [...container.querySelectorAll('[data-days]')];
  let custom = false, loading = false, coverage = null, continuous = false;
  const rangeTrigger = container.querySelector('#observer-range');
  const stripElement = container.parentElement?.querySelector('[data-forecast-strip]');
  const strip = stripElement && createForecastStrip(stripElement, offset => { model.select(offset); render(); onChange(model.state.instantUtc); });
  let timeline, dateLabels, renderedWindow;
  if (rangeTrigger) {
    timeline = document.createElement('div'); timeline.className = 'observer-timeline';
    dateLabels = document.createElement('div'); dateLabels.className = 'timeline-dates'; dateLabels.setAttribute('aria-hidden', 'true');
    dateLabels.hidden = !!strip;
    slider.before(timeline); timeline.append(slider, dateLabels);
  }
  const picker = rangeTrigger && createRangePicker(rangeTrigger, { onChange(amount, unit) {
    model.range(rangeDayCount(amount, unit, model.state.instantUtc)); render(); onChange(model.state.instantUtc);
  } });
  if (picker) {
    if (preferRangeDays || windowStartUtc) picker.setValue(rangeDays);
    model.range(rangeDayCount(picker.value.amount, picker.value.unit, initialUtc));
  }
  function render() {
    const state = model.state, date = format.format(new Date(state.instantUtc)).replaceAll(',', '');
    strip?.render(state);
    slider.step = continuous ? 'any' : '1'; slider.max = String(state.length - 1);
    slider.value = String(continuous ? (Date.parse(state.instantUtc) - Date.parse(state.startUtc)) / (state.length * DAY - 60000) * (state.length - 1) : state.offset);
    slider.setAttribute('aria-valuetext', `${date}, ${state.instantUtc.slice(11, 16)} UTC`);
    output.textContent = date;
    output.title = `${state.instantUtc.slice(11, 16)} UTC · ${format.format(new Date(state.startUtc))} to ${format.format(new Date(state.endUtc))}`;
    const windowKey = `${state.startUtc}/${state.endUtc}`;
    if (dateLabels && renderedWindow !== windowKey) {
      renderedWindow = windowKey;
      const offsets = [...new Set([0, Math.round((state.length - 1) / 4), Math.round((state.length - 1) / 2), Math.round((state.length - 1) * 3 / 4), state.length - 1])];
      dateLabels.replaceChildren(...offsets.map(offset => {
        const tick = document.createElement('span'), date = new Date(Date.parse(state.startUtc) + offset * DAY);
        tick.textContent = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', ...(state.startUtc.slice(0, 4) !== state.endUtc.slice(0, 4) ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(date);
        tick.style.left = `${state.length === 1 ? 0 : offset / (state.length - 1) * 100}%`;
        if (offset !== 0 && offset !== state.length - 1 && offset !== Math.round((state.length - 1) / 2)) tick.className = 'timeline-minor';
        return tick;
      }));
    }
    if (custom && coverage) {
      const start = Date.parse(state.startUtc), hour = Date.parse(state.instantUtc) % DAY;
      const stops = [];
      const readyAt = day => coverage.has(new Date(start + day * DAY + hour).toISOString());
      let segment = 0, ready = readyAt(0);
      for (let day = 1; day <= state.length; day++) {
        const next = day < state.length && readyAt(day);
        if (day === state.length || next !== ready) {
          stops.push(`${ready ? 'var(--text)' : 'var(--line)'} ${segment / state.length * 100}% ${day / state.length * 100}%`);
          segment = day; ready = next;
        }
      }
      slider.style.setProperty('--go-track', `linear-gradient(to right, ${stops.join(',')})`);
      slider.setAttribute('aria-valuetext', `${date}, ${state.instantUtc.slice(11, 16)} UTC · ${coverage.has(state.instantUtc) ? 'ready' : 'not loaded yet'}`);
    } else slider.style.removeProperty('--go-track');
    if (rangeTrigger) {
      rangeTrigger.classList.toggle('is-loading', loading);
      rangeTrigger.setAttribute('aria-busy', String(loading));
      rangeTrigger.title = loading ? 'Loading forecast dates; available dates can already be scrubbed.' : '';
    }
    buttons.forEach(button => {
      const selected = Number(button.dataset.days) === state.rangeDays;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-loading', loading && selected);
      button.setAttribute('aria-busy', String(loading && selected));
      button.disabled = false;
      button.title = loading && selected ? 'Loading forecast dates; available dates can already be scrubbed.' : '';
    });
  }
  const manual = () => { continuous = false; slider.step = '1'; slider.value = String(model.state.offset); };
  slider.addEventListener('pointerdown', manual, { signal: events.signal });
  slider.addEventListener('keydown', event => { if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key)) manual(); }, { signal: events.signal });
  slider.addEventListener('input', () => { model.select(Math.min(model.state.length - 1, Math.round(Number(slider.value)))); render(); onChange(model.state.instantUtc); }, { signal: events.signal });
  buttons.forEach(button => button.addEventListener('click', () => {
    if (button.disabled || Number(button.dataset.days) === model.state.rangeDays) return;
    model.range(Number(button.dataset.days)); render(); onChange(model.state.instantUtc);
  }, { signal: events.signal }));
  render();
  return {
    dispose() { events.abort(); picker?.dispose(); strip?.dispose(); if (timeline) timeline.replaceWith(slider); },
    select(offset, options) { model.select(offset); render(); return onChange(model.state.instantUtc, options); },
    seek(utc, options) { continuous = true; model.seek(utc); render(); if (options?.notify !== false) return onChange(model.state.instantUtc, options); },
    setForecastDays(days, quality) { strip?.setDays(days, quality); strip?.render(model.state); },
    get instantUtc() { return model.state.instantUtc; },
    get state() { return model.state; },
    setLoading(value) { loading = value; stripElement?.setAttribute('aria-busy', String(value)); render(); },
    setCoverage(value) { coverage = value; render(); },
    setCustomLocation(value) { custom = value; if (!custom) coverage = null; render(); }
  };
}
