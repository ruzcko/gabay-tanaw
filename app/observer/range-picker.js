const DAY = 86400000;
export const RANGE_LIMITS = { day: 365, week: 52, month: 12, year: 1 };

export function rangeDayCount(amount, unit, startUtc) {
  if (!Object.hasOwn(RANGE_LIMITS, unit) || !Number.isInteger(amount) || amount < 1 || amount > RANGE_LIMITS[unit])
    throw new Error('Unsupported date range');
  if (unit === 'day') return amount;
  if (unit === 'week') return amount * 7;
  if (unit === 'year') return 365;
  const start = new Date(startUtc);
  if (!Number.isFinite(start.getTime())) throw new Error('Invalid range start');
  const end = new Date(start);
  end.setUTCDate(1); end.setUTCMonth(end.getUTCMonth() + amount);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return Math.min(365, Math.round((end - start) / DAY));
}

/** A draft range: wheel movement never starts a forecast request before Confirm. */
export function createRangePicker(trigger, { onChange }) {
  const events = new AbortController();
  const listen = (target, event, handler) => target.addEventListener(event, handler, { signal: events.signal });
  const node = (tag, className, text) => {
    const element = document.createElement(tag); element.className = className;
    if (text) element.textContent = text;
    return element;
  };
  let amount = Number(trigger.dataset.amount || 30), unit = trigger.dataset.unit || 'day';
  let draftAmount = amount, draftUnit = unit;
  const label = trigger.querySelector('[data-range-label]');
  const popup = node('div', 'range-popover'); popup.id = `${trigger.id}-picker`; popup.popover = 'auto';
  popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', 'Choose forecast range');
  trigger.setAttribute('aria-controls', popup.id);
  const wheels = node('div', 'range-wheels');
  const note = node('p', 'range-limit');
  const confirm = node('button', 'range-confirm', 'Confirm'); confirm.type = 'button';
  popup.append(wheels, note, confirm); document.body.append(popup);

  function createWheel(name, onSelect) {
    const wheel = node('div', 'range-wheel'); wheel.tabIndex = 0;
    wheel.setAttribute('role', 'listbox'); wheel.setAttribute('aria-label', name);
    let values = [], selected = 0, drag;
    const align = () => { wheel.scrollTop = selected * 44; };
    function paint() {
      [...wheel.children].forEach((option, index) => option.setAttribute('aria-selected', String(index === selected)));
      wheel.setAttribute('aria-activedescendant', wheel.children[selected].id);
    }
    function choose(index, scroll = true) {
      const next = Math.max(0, Math.min(values.length - 1, index)), changed = next !== selected;
      selected = next; paint(); if (scroll) align();
      if (changed) onSelect(values[selected]);
    }
    listen(wheel, 'scroll', () => {
      if (popup.matches(':popover-open')) choose(Math.round(wheel.scrollTop / 44), false);
    });
    listen(wheel, 'click', event => {
      const option = event.target.closest('[role="option"]');
      if (option) choose(Number(option.dataset.index));
    });
    listen(wheel, 'keydown', event => {
      const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      if (delta || event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); choose(event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1 : selected + delta);
      }
      if (event.key === 'Enter') { event.preventDefault(); confirm.focus(); }
    });
    listen(wheel, 'pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault(); wheel.focus({ preventScroll: true });
      drag = { id: event.pointerId, y: event.clientY, start: event.clientY, moved: false, option: event.target.closest('[role="option"]') };
      wheel.setPointerCapture(event.pointerId); wheel.classList.add('dragging');
    });
    listen(wheel, 'pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      drag.moved ||= Math.abs(event.clientY - drag.start) > 3;
      wheel.scrollTop += drag.y - event.clientY; drag.y = event.clientY;
      choose(Math.round(wheel.scrollTop / 44), false);
    });
    function endDrag(event) {
      if (!drag || drag.id !== event.pointerId) return;
      const finished = drag; drag = null; wheel.classList.remove('dragging');
      if (wheel.hasPointerCapture(event.pointerId)) wheel.releasePointerCapture(event.pointerId);
      if (!finished.moved && event.type === 'pointerup' && finished.option) choose(Number(finished.option.dataset.index));
      else align();
    }
    listen(wheel, 'pointerup', endDrag); listen(wheel, 'pointercancel', endDrag); listen(wheel, 'lostpointercapture', endDrag);
    return { node: wheel, align, set(items, value) {
      values = items; selected = Math.max(0, values.indexOf(value));
      wheel.replaceChildren(...values.map((item, index) => {
        const option = node('div', '', String(item)); option.setAttribute('role', 'option');
        option.id = `${popup.id}-${name.replaceAll(' ', '-')}-${index}`; option.dataset.index = index;
        return option;
      }));
      paint(); align();
    } };
  }
  const numberWheel = createWheel('Range number', value => { draftAmount = value; });
  const unitWheel = createWheel('Range unit', value => {
    draftUnit = value; draftAmount = Math.min(draftAmount, RANGE_LIMITS[value]); updateNumbers();
  });
  wheels.append(numberWheel.node, unitWheel.node);
  function updateNumbers() {
    numberWheel.set(Array.from({ length: RANGE_LIMITS[draftUnit] }, (_, i) => i + 1), draftAmount);
    note.textContent = `Up to ${RANGE_LIMITS[draftUnit]} ${draftUnit}${RANGE_LIMITS[draftUnit] === 1 ? '' : 's'}`;
  }
  function updateLabel() {
    label.textContent = `${amount} ${unit}${amount === 1 ? '' : 's'}`;
    trigger.dataset.amount = amount; trigger.dataset.unit = unit;
  }
  function position() {
    if (!popup.matches(':popover-open')) return;
    const rect = trigger.getBoundingClientRect(), gap = 8;
    popup.style.left = `${Math.max(gap, Math.min(rect.left, innerWidth - popup.offsetWidth - gap))}px`;
    popup.style.top = `${Math.max(gap, Math.min(rect.top - popup.offsetHeight - gap, innerHeight - popup.offsetHeight - gap))}px`;
  }
  function close() { popup.hidePopover(); trigger.focus({ preventScroll: true }); }
  listen(trigger, 'click', () => {
    if (popup.matches(':popover-open')) { close(); return; }
    draftAmount = amount; draftUnit = unit;
    popup.showPopover(); updateNumbers(); unitWheel.set(Object.keys(RANGE_LIMITS), draftUnit);
    position(); numberWheel.node.focus({ preventScroll: true });
  });
  listen(confirm, 'click', () => {
    const changed = amount !== draftAmount || unit !== draftUnit;
    amount = draftAmount; unit = draftUnit; updateLabel(); close();
    if (changed) onChange(amount, unit);
  });
  listen(popup, 'keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  });
  listen(popup, 'beforetoggle', event => trigger.setAttribute('aria-expanded', String(event.newState === 'open')));
  listen(window, 'resize', position); listen(document, 'scroll', position);
  updateLabel();
  return {
    get value() { return { amount, unit }; },
    // Host-selected trips update the same control without starting another selection.
    setValue(nextAmount, nextUnit = 'day') {
      if (!Object.hasOwn(RANGE_LIMITS, nextUnit) || !Number.isInteger(nextAmount) || nextAmount < 1 || nextAmount > RANGE_LIMITS[nextUnit]) throw new Error('Unsupported date range');
      amount = nextAmount; unit = nextUnit; updateLabel();
    },
    dispose() { events.abort(); popup.remove(); }
  };
}
