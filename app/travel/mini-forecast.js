// Display only: daily hours and quality come from the Travel science result.
const make = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const hours = value => value == null ? 'Unknown' : `${Number(value.toFixed(1))} h`;
const dateLabel = value => new Date(value).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function miniForecast(result) {
  const figure = make('figure', 'travel-mini');
  const caption = make('figcaption', 'travel-mini-caption', `${dateLabel(result.startUtc)} – ${dateLabel(result.endUtc)}`);
  caption.append(make('span', '', 'Hours · UTC'));
  figure.append(caption);
  if (!result.days?.length) { figure.append(make('p', 'travel-note', 'Daily forecast unavailable')); return figure; }
  const scroll = make('div', 'travel-mini-scroll');
  scroll.tabIndex = 0; scroll.setAttribute('aria-label', 'Daily sunlight and Earth visibility during your stay');
  const table = make('table', 'travel-mini-table');
  const head = document.createElement('thead'), dates = document.createElement('tr');
  dates.append(make('th', '', 'UTC'));
  for (const day of result.days) {
    const date = make('th', '', String(Number(day.date.slice(8)))); date.scope = 'col';
    date.setAttribute('aria-label', dateLabel(day.startUtc)); dates.append(date);
  }
  head.append(dates); table.append(head);
  const body = document.createElement('tbody');
  for (const [key, label, cls] of [['sunHours', 'Sun', 'travel-sun'], ['earthHours', 'Earth', 'travel-earth']]) {
    const row = document.createElement('tr'), labelCell = make('th', cls, label); labelCell.scope = 'row'; row.append(labelCell);
    for (const day of result.days) {
      const value = day[key], cell = make('td', `travel-mini-value ${cls}${value == null ? ' is-unknown' : ''}`);
      cell.style.setProperty('--hours', `${value == null ? 0 : Math.max(0, Math.min(100, value / 24 * 100))}%`);
      const quality = { accurate: 'Published forecast', estimate: 'Estimate', mixed: 'Mixed forecast and estimate', unknown: 'Unknown' }[day.quality] || 'Unknown';
      const detail = `${dateLabel(day.startUtc)} · ${day.startUtc.slice(11,16)}–${day.endUtc.slice(11,16) === '00:00' ? '24:00' : day.endUtc.slice(11,16)} UTC: ${label === 'Sun' ? 'Sunlight' : 'Earth visibility'} ${hours(value)} of ${hours(day.durationHours)} · ${quality}`;
      cell.title = detail; cell.setAttribute('aria-label', detail);
      cell.append(make('span', '', value == null ? '?' : String(Number(value.toFixed(1)))));
      row.append(cell);
    }
    body.append(row);
  }
  table.append(body); scroll.append(table); figure.append(scroll);
  return figure;
}
