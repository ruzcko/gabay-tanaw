// Decorative layers never wrap labels or participate in the control's layout.
const controls = '.btn, .now, .date-trigger, .date-heading, .date-close, .date-today, .date-time-value, .date-confirm, .date-month-nav button, .range-confirm';

function enhance(button) {
  if (!button.matches('button, a')) return;
  if (!button.classList.contains('eclipse-control')) {
    // Preserve controls already positioned by the host (including globe actions).
    if (getComputedStyle(button).position === 'static') button.classList.add('eclipse-relative');
    button.classList.add('eclipse-control');
  }
  if (button.querySelector(':scope > .button-eclipse')) return;
  const sweep = document.createElement('span');
  sweep.className = 'button-eclipse';
  sweep.setAttribute('aria-hidden', 'true');
  const dot = document.createElement('span');
  dot.className = 'button-toggle-dot';
  dot.setAttribute('aria-hidden', 'true');
  button.append(sweep, dot);
}

function scan(root) {
  if (!(root instanceof Element)) return;
  if (root.matches(controls)) enhance(root);
  root.querySelectorAll(controls).forEach(enhance);
}

scan(document.body);
// Some action/speed labels are replaced; menus create controls on demand.
// Inspect changed subtrees only, rather than rescanning the page on each frame.
new MutationObserver(records => {
  for (const record of records) {
    if (record.target instanceof Element && record.target.matches(controls)) enhance(record.target);
    for (const node of record.addedNodes) scan(node);
  }
}).observe(document.body, { childList: true, subtree: true });
