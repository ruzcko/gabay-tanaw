const DAY = 86400000;
const dateLabel = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: 'UTC' });
const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });
const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Display supplied daily totals, using the Moon viewer's date columns and hour colours. */
export function createForecastStrip(container, onSelect) {
  let days = new Map(), signature = '', revision = 0, rendered = '', selected = -1, buttons = [];
  const events = new AbortController();
  const node = (tag, className, text) => {
    const element = document.createElement(tag); element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  container.addEventListener('click', event => {
    const button = event.target.closest('[data-offset]');
    if (button) onSelect(Number(button.dataset.offset));
  }, { signal: events.signal });
  container.addEventListener('keydown', event => {
    const button = event.target.closest('[data-offset]');
    if (!button) return;
    const offset = Number(button.dataset.offset);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowRight' ? offset + 1 : event.key === 'ArrowLeft' ? offset - 1 : null;
    if (next === null) return;
    event.preventDefault(); const index = Math.max(0, Math.min(buttons.length - 1, next));
    onSelect(index); buttons[index].focus({ preventScroll: true });
  }, { signal: events.signal });
  return {
    setDays(values = [], quality = '') {
      const next = JSON.stringify([quality, values.map(day => [day.date, day.sunHours, day.earthHours])]);
      if (next === signature) return;
      signature = next; revision++; days = new Map(values.map(day => [day.date, day]));
      container.setAttribute('aria-label', `${quality === 'estimate' ? 'Estimated' : 'Forecast'} daily Sun and Earth hours, UTC`);
    },
    render(state) {
      const key = `${state.startUtc}/${state.endUtc}/${revision}`;
      if (key !== rendered) {
        rendered = key; selected = -1;
        const grid = node('div', 'observer-hours-grid'); grid.style.setProperty('--days', state.length);
        const labels = node('div', 'observer-hours-labels'); labels.setAttribute('aria-hidden', 'true');
        labels.append(node('span', '', 'UTC'), node('span', 'sun', 'Sun h'), node('span', 'earth', 'Earth h'));
        grid.append(labels); buttons = [];
        for (let offset = 0; offset < state.length; offset++) {
          const date = new Date(Date.parse(state.startUtc) + offset * DAY), day = days.get(date.toISOString().slice(0, 10));
          const button = node('button', `observer-hours-day${date.getUTCDate() === 1 ? ' month-start' : ''}`);
          button.type = 'button'; button.dataset.offset = offset;
          const heading = node('span', 'observer-hours-date');
          heading.append(node('span', '', offset === 0 || date.getUTCDate() === 1 ? monthLabel.format(date) : weekdays[date.getUTCDay()]), node('b', '', date.getUTCDate()));
          button.append(heading);
          const descriptions = [];
          for (const body of ['sun', 'earth']) {
            const hours = day?.[`${body}Hours`], known = Number.isFinite(hours);
            const cell = node('span', `observer-hours-value ${body}${known && hours < .5 ? ' zero' : ''}`, known ? Math.round(hours) : '–');
            cell.style.setProperty('--f', known ? Math.max(0, Math.min(1, hours / 24)) : 0);
            button.append(cell); descriptions.push(`${body === 'sun' ? 'Sun above terrain' : 'Earth in view'} ${known ? `${hours.toFixed(2)} hours` : 'unavailable'}`);
          }
          button.setAttribute('aria-label', `${dateLabel.format(date)}, ${descriptions.join(', ')}`);
          button.title = button.getAttribute('aria-label'); grid.append(button); buttons.push(button);
        }
        container.replaceChildren(grid);
      }
      if (selected === state.offset) return;
      selected = state.offset;
      buttons.forEach((button, index) => { button.setAttribute('aria-pressed', String(index === selected)); button.tabIndex = index === selected ? 0 : -1; });
      const button = buttons[selected];
      if (button) {
        const left = button.offsetLeft, right = left + button.offsetWidth;
        if (left < container.scrollLeft + 72) container.scrollLeft = left - 72;
        else if (right > container.scrollLeft + container.clientWidth) container.scrollLeft = right - container.clientWidth;
      }
    },
    dispose() { events.abort(); container.replaceChildren(); }
  };
}
