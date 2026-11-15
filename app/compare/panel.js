import { compareSites } from './data.js';
import { travelComparisonResult } from './travel.js';
import { createForecastSource } from '../forecast-source.js';

const node = (tag, className, text = '') => Object.assign(document.createElement(tag), { className, textContent: text });
const sameSite = (a, b) => a && b && Math.abs(a.lat - b.lat) < 1e-5 &&
  Math.abs(((a.lon - b.lon + 540) % 360) - 180) < 1e-5;

// Comparison owns its pinned locations; the host continues to own the selected location and UTC.
export function createComparePanel({ root, selection, window: getWindow, onChange, pickDay }) {
  const slots = root.querySelector('#compare-slots'), status = root.querySelector('#compare-sub');
  let active = false, armed = -1, points = [], windowKey = '', controller, source, generation = 0;
  const results = new Map();
  let trip = null;
  const button = (label, className, click) => {
    const b = node('button', className, label);
    b.type = 'button'; b.addEventListener('click', click); return b;
  };
  function message() {
    const count = points.filter(Boolean).length;
    status.textContent = armed >= 0 ? 'Click a location on the Moon to add it. Esc to cancel.' :
      trip ? `${trip.startUtc.slice(0, 16).replace('T', ' ')} – ${trip.endUtc.slice(0, 16).replace('T', ' ')} UTC · ${count} of 3 sites` :
      `${count} of 3 sites · Select a location on the Moon to compare`;
    root.classList.toggle('picking', armed >= 0);
  }
  function draw() {
    const focused = slots.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
    const positions = new Map([...slots.querySelectorAll('.compare-site')].map(row => [row.dataset.site, row.querySelector('.compare-forecast')?.scrollLeft || 0]));
    message();
    const selectedDate = selection().instantUtc.slice(0, 10);
    slots.replaceChildren(...Array.from({ length: 3 }, (_, i) => {
      const point = points[i];
      if (!point) {
        const add = button('', 'compare-add', () => {
          armed = armed === i ? -1 : i; draw(); onChange();
          slots.querySelector(`[data-slot="${i}"]`)?.focus();
        });
        add.dataset.slot = i;
        add.dataset.focus = `add-${i}`;
        add.setAttribute('aria-pressed', String(armed === i));
        add.setAttribute('aria-label', `Add a site to comparison slot ${i + 1}`);
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(icon.namespaceURI, 'path');
        path.setAttribute('d', 'M12 5v14M5 12h14'); icon.append(path);
        add.append(icon, node('span', '', armed === i ? 'Click on the Moon' : 'Add a site'));
        return add;
      }
      const row = node('article', 'compare-site');
      row.dataset.site = point.id; row.dataset.slot = i;
      const info = node('div', 'compare-info'), title = node('h3', '', point.name);
      const result = results.get(point.id);
      info.append(title);
      if (!trip) info.append(node('p', 'compare-quality', i === 0 ? 'First site · Pinned' : 'Comparison site'));
      if (i > 0 || trip) {
        const remove = button('Remove', 'btn compare-remove', () => {
          points[i] = null; draw(); onChange(); slots.querySelector(`[data-slot="${i}"]`)?.focus();
        });
        remove.dataset.focus = `remove-${i}`;
        remove.setAttribute('aria-label', `Remove ${point.name}`);
        info.append(remove);
      }
      row.append(info);
      if (!result) {
        row.setAttribute('aria-busy', 'true');
        row.append(node('p', 'compare-loading', 'Loading forecast…'));
      } else if (result.error) {
        const error = node('div', 'compare-error');
        error.append(node('p', '', 'Forecast unavailable for this site.'), button('Retry', 'btn', () => {
          results.delete(point.id); refresh();
        }));
        row.append(error);
      } else {
        row.dataset.quality = result.quality;
        info.append(node('p', 'compare-quality', result.quality === 'accurate' ? 'Accurate forecast' : 'Estimate · Coarse terrain'));
        const scroll = node('div', 'compare-forecast');
        scroll.dataset.focus = `forecast-${i}`;
        scroll.tabIndex = 0; scroll.setAttribute('role', 'region');
        scroll.setAttribute('aria-label', `${point.name} daily forecast`);
        scroll.addEventListener('scroll', () => {
          slots.querySelectorAll('.compare-forecast').forEach(other => {
            if (other !== scroll && other.scrollLeft !== scroll.scrollLeft) other.scrollLeft = scroll.scrollLeft;
          });
        });
        const table = node('table', 'compare-table');
        const caption = node('caption', 'sr', `${point.name}: daily sunlight and Earth visibility in hours, UTC`);
        const head = node('thead', ''), dates = node('tr', '');
        dates.append(node('th', '', 'UTC'));
        for (const day of result.series) {
          const cell = node('th', ''); cell.scope = 'col';
          const date = new Date(`${day.date}T00:00:00Z`);
          const label = date.getUTCDate() === 1 || day === result.series[0]
            ? `${date.getUTCDate()} ${date.toLocaleDateString('en', { month: 'short', timeZone: 'UTC' })}` : `${date.getUTCDate()}`;
          const b = button(label, '', () => pickDay(day.date));
          b.dataset.focus = `day-${i}-${day.date}`;
          b.tabIndex = day.date === selectedDate ? 0 : -1;
          b.setAttribute('aria-label', day.date);
          if (day.date === selectedDate) b.setAttribute('aria-current', 'date');
          cell.append(b); dates.append(cell);
        }
        head.append(dates);
        const body = node('tbody', '');
        for (const [label, key, cls] of (trip ? [['Sun h', 'sunHours', 'sun'], ['Earth h', 'earthHours', 'earth']] : [['Sun h', 'sunHours', 'sun'], ['Earth h', 'earthHours', 'earth'], ['Go', 'go', '']])) {
          const tr = node('tr', cls), heading = node('th', '', label); heading.scope = 'row'; tr.append(heading);
          for (const day of result.series) {
            const cell = node('td', '', key === 'go' ? (day.go ? 'Yes' : '—') : day[key] == null ? 'Unknown' : String(Number(day[key].toFixed(trip ? 1 : 0))));
            if (trip) cell.title = `${day.startUtc} – ${day.endUtc} · ${day.durationHours.toFixed(2)} h · ${day.quality}`;
            tr.append(cell);
          }
          body.append(tr);
        }
        table.append(caption, head, body); scroll.append(table); row.append(scroll);
        table.addEventListener('keydown', event => {
          if (!event.target.matches('button') || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
          event.preventDefault();
          const buttons = [...table.querySelectorAll('button')];
          const next = buttons[buttons.indexOf(event.target) + (event.key === 'ArrowLeft' ? -1 : 1)];
          if (next) { next.click(); next.focus(); }
        });
      }
      return row;
    }));
    slots.querySelectorAll('.compare-site').forEach(row => {
      const scroll = row.querySelector('.compare-forecast');
      if (scroll) scroll.scrollLeft = positions.get(row.dataset.site) || 0;
    });
    if (focused) slots.querySelector(`[data-focus="${focused}"]`)?.focus({ preventScroll: true });
  }
  async function refresh() {
    if (!active) return;
    if (trip) {
      for (const point of points.filter(Boolean)) {
        const result = trip.resultFor(point);
        results.set(point.id, result ? travelComparisonResult(result) : { error: 'Choose a matching Travel destination.' });
      }
      draw(); return;
    }
    const window = getWindow(), key = `${window.startUtc}:${window.days}`;
    if (key !== windowKey) { windowKey = key; results.clear(); }
    controller?.abort(); source?.dispose();
    controller = new AbortController(); source = createForecastSource();
    const own = ++generation;
    draw();
    const missing = points.filter(p => p && !results.has(p.id));
    if (!missing.length) return;
    try {
      await compareSites({ sites: missing, ...window, source, signal: controller.signal, onSite(result) {
        if (own !== generation || !active) return;
        results.set(result.id, result); draw();
      } });
    } catch (error) { if (error.name !== 'AbortError') console.error(error); }
  }
  function add(point) {
    if (points.some(p => sameSite(p, point))) {
      status.textContent = 'This location is already in the comparison.'; return false;
    }
    const index = armed >= 0 ? armed : points.findIndex(p => !p);
    if (index < 0) return false;
    points[index] = { ...point }; armed = -1; refresh(); onChange(); return true;
  }
  return {
    get active() { return active; },
    get fromTravel() { return active && !!trip; },
    contains(point) { return points.some(p => sameSite(p, point)); },
    remove(point) {
      const index = points.findIndex(p => sameSite(p, point));
      if (index < 0 || (index === 0 && !trip)) return false;
      points[index] = null; armed = -1; draw(); onChange(); return true;
    },
    get picking() { return armed >= 0; },
    action(point) { return points.some(p => sameSite(p, point)) ? (trip ? 'Remove site' : 'Site added') : points.filter(Boolean).length === 3 ? 'Comparison full' : 'Add site'; },
    open(point = selection().point, travel = null) { trip = travel; active = true; armed = -1; points = [{ ...point }, null, null]; results.clear(); refresh(); },
    close() { active = false; armed = -1; ++generation; controller?.abort(); source?.dispose(); },
    add,
    cancelPick() { armed = -1; draw(); onChange(); },
    sync() {
      if (!active) return;
      const window = getWindow();
      if (!trip && `${window.startUtc}:${window.days}` !== windowKey) refresh();
      else slots.querySelectorAll('.compare-table button').forEach(b => {
        const current = b.getAttribute('aria-label') === selection().instantUtc.slice(0, 10);
        b.tabIndex = current ? 0 : -1;
        if (current) b.setAttribute('aria-current', 'date');
        else b.removeAttribute('aria-current');
      });
    },
  };
}
