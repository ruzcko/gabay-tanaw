const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const iso = (year, month, day) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** Draft date and UTC hour together; the host computes once on confirmation. An optional
 * published range [first, last] (ISO dates) marks those days; Today is always the current UTC day. */
export function createDatePicker(input, initialUtc, { published = null } = {}) {
  let hour = initialUtc.slice(11, 13), minute = initialUtc.slice(14,16), draftDate = input.value;
  const events = new AbortController(), listen = (node, event, fn) => node.addEventListener(event, fn, { signal: events.signal });
  const node = (tag, cls, text) => {
    const n = document.createElement(tag); n.className = cls;
    if (text) n.textContent = text;
    return n;
  };
  const button = (cls, label, action) => {
    const b = node('button', cls, label); b.type = 'button'; listen(b, 'click', action); return b;
  };
  const icon = paths => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const wrap = node('div', 'date-field'); input.before(wrap); wrap.append(input);
  const originalTabIndex = input.getAttribute('tabindex');
  input.tabIndex = -1; // main shows the date label and calendar button
  const trigger = button('date-trigger', '', event => { event.preventDefault(); popup.matches(':popover-open') ? close() : open(); });
  const triggerText = document.createTextNode(''); trigger.append(triggerText);
  // Keep the hover layers alive while playback updates the date label.
  const dateLabel = () => { triggerText.data = `${new Date(`${input.value}T00:00:00Z`).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric',timeZone:'UTC'})} \u00b7 ${hour}:${minute} UTC`; };
  dateLabel(); listen(input, 'input', dateLabel); listen(input, 'change', dateLabel);
  trigger.setAttribute('aria-label', 'Choose date and time'); trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false'); wrap.append(trigger);
  const popup = node('div', 'date-popover'); popup.popover = 'auto'; popup.id = `${input.id}-picker`;
  popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', 'Choose date and time (UTC)');
  trigger.setAttribute('aria-controls', popup.id); document.body.append(popup);
  trigger.setAttribute('popovertarget', popup.id);
  const header = node('div', 'date-picker-head');
  const title = node('span', 'date-picker-title', 'Choose date and time');
  const heading = button('date-heading', '', () => { if (view !== 'years') { view = view === 'days' ? 'months' : 'years'; render(); } });
  const dismiss = button('date-close', '', () => close()); dismiss.setAttribute('aria-label', 'Close date picker');
  dismiss.innerHTML = icon('<path d="m6 6 12 12M6 18 18 6"/>'); header.append(title, heading, dismiss);
  const nav = node('div', 'date-month-nav');
  const moveMonth = delta => { const d = new Date(Date.UTC(year, month + delta, 1)); year = d.getUTCFullYear(); month = d.getUTCMonth(); render(); };
  const prev = button('', '', () => moveMonth(-1)), next = button('', '', () => moveMonth(1));
  prev.innerHTML = icon('<path d="m14 6-6 6 6 6"/>'); next.innerHTML = icon('<path d="m10 6 6 6-6 6"/>');
  prev.setAttribute('aria-label', 'Previous month'); next.setAttribute('aria-label', 'Next month');
  nav.append(prev, next);
  const weekdays = node('div', 'date-weekdays'); weekdays.setAttribute('aria-hidden', 'true');
  for (const label of ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']) weekdays.append(node('span', '', label));
  const grid = node('div', 'date-grid'); grid.setAttribute('role', 'group');
  const footer = node('div', 'date-picker-footer');
  const todayValue = () => new Date().toISOString().slice(0, 10);
  const longDate = value => new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  const legend = published && node('p', 'date-picker-legend', `Bright days: published forecast, ${longDate(published[0])} – ${longDate(published[1])}`);
  const today = button('date-today', 'Today', () => selectDay(todayValue()));
  today.title = 'Select today (UTC)';
  footer.append(node('p', 'date-picker-note', `${input.min.slice(0, 4)}–${input.max.slice(0, 4)} · UTC`), today);
  if (published) popup.classList.add('has-published');
  const timeRow = node('div', 'date-time-row');
  const timeEditor = node('div', 'date-time-editor'); timeEditor.hidden = true;
  const timeToggle = button('date-time-value', '', () => {
    timeEditor.hidden = !timeEditor.hidden;
    timeToggle.setAttribute('aria-expanded', String(!timeEditor.hidden));
    if (!timeEditor.hidden) { hourWheel.align(); minuteWheel.align(); hourWheel.node.focus(); }
  });
  timeToggle.setAttribute('aria-label', 'Choose time (UTC)'); timeToggle.setAttribute('aria-expanded', 'false');
  function createWheel(label, count, initial) {
    const wheel = node('div', 'date-time-wheel'); let selected = Number(initial);
    wheel.setAttribute('role', 'listbox'); wheel.setAttribute('aria-label', label); wheel.tabIndex = 0;
    const wrapValue = value => (value % count + count) % count;
    // Three cycles keep a real previous/next row visible at both zero and the last value.
    const options = Array.from({length:count*3}, (_, index) => {
      const value = index % count;
      const option = button('', String(value).padStart(2,'0'), () => choose(value));
      option.id = `${popup.id}-${label.replaceAll(' ','-')}-${index}`;
      option.setAttribute('role','option'); option.tabIndex = -1;
      if (index < count || index >= count*2) option.setAttribute('aria-hidden','true');
      wheel.append(option); return option;
    });
    function update() {
      options.forEach((option, i) => option.setAttribute('aria-selected', String(i % count === selected)));
      wheel.setAttribute('aria-activedescendant', options[count+selected].id);
    }
    function align() { wheel.scrollTop = (count+selected)*44; }
    function choose(value) { selected = wrapValue(value); update(); align(); updateTime(); }
    listen(wheel, 'scroll', () => {
      if (timeEditor.hidden) return;
      const index = Math.round(wheel.scrollTop/44);
      selected = wrapValue(index); update(); updateTime();
      // Recenter an equivalent cycle before the physical scroll boundary is reached.
      if (index < count/2 || index >= count*2.5) align();
    });
    let drag;
    listen(wheel, 'pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault(); wheel.focus({preventScroll:true});
      drag = {id:event.pointerId,y:event.clientY,startY:event.clientY,moved:false,option:event.target.closest('[role="option"]')};
      wheel.classList.add('dragging'); wheel.setPointerCapture(event.pointerId);
    });
    listen(wheel, 'pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const delta = drag.y-event.clientY; drag.y=event.clientY;
      drag.moved ||= Math.abs(event.clientY-drag.startY)>3;
      wheel.scrollTop += delta;
      selected = wrapValue(Math.round(wheel.scrollTop/44)); update(); updateTime();
    });
    const endDrag = event => {
      if (!drag || drag.id !== event.pointerId) return;
      const finished=drag; drag=null;
      wheel.classList.remove('dragging');
      if (wheel.hasPointerCapture(event.pointerId)) wheel.releasePointerCapture(event.pointerId);
      if (!finished.moved && event.type==='pointerup' && finished.option) finished.option.click();
      else choose(selected);
    };
    listen(wheel,'pointerup',endDrag); listen(wheel,'pointercancel',endDrag); listen(wheel,'lostpointercapture',endDrag);
    listen(wheel, 'keydown', event => {
      const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
      if (delta || event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); choose(event.key === 'Home' ? 0 : event.key === 'End' ? count-1 : selected+delta);
      }
      if (event.key === 'Enter') { event.preventDefault(); timeEditor.hidden = true; timeToggle.setAttribute('aria-expanded','false'); timeToggle.focus(); }
    });
    update();
    return {node:wheel, get value(){return String(selected).padStart(2,'0');}, set(value){selected=Number(value);update();}, align};
  }
  const hourWheel = createWheel('UTC hour',24,hour), minuteWheel = createWheel('UTC minute',60,minute);
  function updateTime() { timeToggle.textContent = `${hourWheel.value}:${minuteWheel.value} UTC`; }
  timeEditor.append(hourWheel.node, node('span','date-time-colon',':'), minuteWheel.node);
  timeRow.append(node('span','','Time'),timeToggle,timeEditor);
  const confirm = button('date-confirm', 'Confirm', () => commit(draftDate));
  popup.append(header, nav, weekdays, grid, ...(legend ? [legend] : []), footer, timeRow, confirm);
  let view = 'years', year, month, day, anchorRect;
  const minYear = Number(input.min.slice(0, 4)), maxYear = Number(input.max.slice(0, 4));
  function position() {
    if (!popup.matches(':popover-open')) return;
    const r = anchorRect ?? wrap.getBoundingClientRect(), w = popup.offsetWidth, h = popup.offsetHeight;
    const edge = 2, below = innerHeight - r.bottom;
    popup.style.left = `${Math.max(edge, Math.min(r.left, innerWidth - w - edge))}px`;
    popup.style.top = `${Math.max(edge, Math.min(below >= h + 8 ? r.bottom + 8 : r.top - h - 8, innerHeight - h - edge))}px`;
  }
  function close() { popup.hidePopover(); trigger.focus({ preventScroll: true }); }
  function commit(value) {
    if (value < input.min || value > input.max) return;
    hour = hourWheel.value; minute = minuteWheel.value; input.value = value; dateLabel(); close();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function selectDay(value) {
    draftDate = value; [year, month, day] = value.split('-').map(Number); month--; view = 'days'; render();
  }
  function open() {
    anchorRect = wrap.getBoundingClientRect();
    if (legend) legend.textContent = `Bright days: published forecast, ${longDate(published[0])} – ${longDate(published[1])}`;
    const value = input.value >= input.min && input.value <= input.max ? input.value : input.min;
    [year, month, day] = value.split('-').map(Number); month--;
    draftDate = value; hourWheel.set(hour); minuteWheel.set(minute); updateTime(); timeEditor.hidden = true; timeToggle.setAttribute('aria-expanded','false');
    view = 'days'; popup.showPopover(); render(); trigger.setAttribute('aria-expanded', 'true');
  }
  function render() {
    const currentDay = todayValue();
    today.disabled = currentDay < input.min || currentDay > input.max;
    title.hidden = view !== 'days';
    if (view === 'days') nav.insertBefore(heading, next);
    else header.insertBefore(heading, dismiss);
    heading.textContent = view === 'years' ? 'Choose year' : view === 'months' ? String(year) : `${MONTHS[month]} ${year}`;
    heading.disabled = view === 'years';
    heading.setAttribute('aria-label', view === 'days' ? 'Choose month' : view === 'months' ? 'Choose year' : 'Choose year');
    nav.hidden = weekdays.hidden = view !== 'days';
    prev.disabled = iso(year, month, 1) <= input.min;
    next.disabled = iso(year, month, new Date(Date.UTC(year, month + 1, 0)).getUTCDate()) >= input.max;
    grid.dataset.view = view; grid.setAttribute('aria-label', view === 'years' ? 'Years' : view === 'months' ? 'Months' : 'Days');
    const cells = [], active = [];
    const add = (text, value, selected, choose, label = text, disabled = false) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
      b.dataset.value = value; b.setAttribute('aria-label', label); b.setAttribute('aria-pressed', String(selected));
      if (view === 'days' && value === currentDay) {
        b.setAttribute('aria-current', 'date'); b.title = 'Today (UTC)';
      }
      b.disabled = disabled; b.tabIndex = -1; b.onclick = choose;
      cells.push(b); if (!disabled) active.push(b);
    };
    if (view === 'years') for (let y = minYear; y <= maxYear; y++) {
      add(String(y), y, y === year, () => { year = y; view = 'months'; render(); });
    }
    if (view === 'months') MONTHS.forEach((name, m) => {
      const last = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
      add(name.slice(0, 3), m + 1, m === month, () => { month = m; view = 'days'; render(); }, name,
        iso(year, m, last) < input.min || iso(year, m, 1) > input.max);
    });
    if (view === 'days') {
      const offset = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
      for (let i = 0; i < offset; i++) cells.push(node('span', ''));
      const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      for (let d = 1; d <= count; d++) {
        const value = iso(year, month, d);
        add(String(d), value, value === draftDate, () => selectDay(value),
          `${d} ${MONTHS[month]} ${year}`, value < input.min || value > input.max);
        if (published && value >= published[0] && value <= published[1]) cells.at(-1).classList.add('pub');
      }
    }
    grid.replaceChildren(...cells); grid.scrollTop = 0;
    const selected = active.find(b => b.getAttribute('aria-pressed') === 'true') ??
      (view === 'days' ? active.find(b => Number(b.textContent) === Math.min(day, active.length)) : null) ?? active[0];
    if (selected) {
      selected.tabIndex = 0; selected.focus({ preventScroll: true });
      grid.scrollTop = selected.offsetTop - (grid.clientHeight - selected.offsetHeight) / 2;
    }
    position();
  }
  listen(grid, 'keydown', event => {
    const cells = [...grid.querySelectorAll('button:not(:disabled)')], index = cells.indexOf(document.activeElement);
    const cols = view === 'days' ? 7 : 4;
    const offset = view === 'days' ? grid.querySelectorAll('span').length : 0;
    let target;
    if (event.key === 'ArrowLeft') target = index - 1;
    if (event.key === 'ArrowRight') target = index + 1;
    if (event.key === 'ArrowUp') target = index - cols;
    if (event.key === 'ArrowDown') target = index + cols;
    if (event.key === 'Home') target = event.ctrlKey ? 0 : index - (index + offset) % cols;
    if (event.key === 'End') target = event.ctrlKey ? cells.length - 1 : index + cols - 1 - (index + offset) % cols;
    if (event.key === 'PageUp') target = index - cols * 5;
    if (event.key === 'PageDown') target = index + cols * 5;
    if (index < 0 || target === undefined) return;
    event.preventDefault(); cells[index].tabIndex = -1;
    const b = cells[Math.max(0, Math.min(cells.length - 1, target))]; b.tabIndex = 0; b.focus();
  });
  listen(popup, 'keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  });
  listen(popup, 'beforetoggle', event => trigger.setAttribute('aria-expanded', String(event.newState === 'open')));
  listen(input, 'click', event => { event.preventDefault(); open(); });
  listen(input, 'keydown', event => {
    if ((event.altKey && event.key === 'ArrowDown') || event.key === 'F4' || event.key === ' ') { event.preventDefault(); open(); }
  });
  const reposition = () => { anchorRect = wrap.getBoundingClientRect(); position(); };
  listen(window, 'resize', reposition);
  listen(document, 'scroll', reposition);
  return { get hour() { return hour; }, get minute() { return minute; }, setDate(utc) { hour = utc.slice(11,13); minute = utc.slice(14,16); dateLabel(); }, dispose() {
    events.abort(); popup.remove(); wrap.replaceWith(input);
    if (originalTabIndex === null) input.removeAttribute('tabindex'); else input.setAttribute('tabindex', originalTabIndex);
  } };
}
