/** UI visibility only; camera movement and the playback clock stay with their owners. */
export function createCinematicMode({ button, root, controls, playbackBar, beforeEnter = () => {}, onChange = () => {}, idleMs = 3500 }) {
  const events = new AbortController();
  let active = false, idle = false, timer, pointerHeld = false, hoveringPlayback = false, keyboard = false, suppressClickUntil = 0;
  const listen = (target, name, handler, options = {}) => target.addEventListener(name, handler, { ...options, signal: events.signal });
  const hint = document.createElement('p'); hint.className = 'cinematic-hint'; hint.hidden = true;
  hint.textContent = 'Move or tap to show controls · Esc to exit'; hint.setAttribute('role', 'status'); root.append(hint);
  function setIdle(value) {
    idle = value; root.classList.toggle('cinematic-idle', value);
    controls.forEach(element => { element.inert = value; });
  }
  function arm() {
    clearTimeout(timer);
    if (!active) return;
    timer = setTimeout(() => {
      const editing = document.querySelector(':popover-open') || (keyboard && controls.some(element => element.contains(document.activeElement)));
      if (pointerHeld || hoveringPlayback || editing) { arm(); return; }
      setIdle(true);
    }, idleMs);
  }
  function reveal() { if (active) { setIdle(false); arm(); } }
  function setActive(value) {
    if (value) beforeEnter();
    // Capture the displayed position, including an interrupted transition.
    const anchor = playbackBar.firstElementChild;
    const from = anchor.getBoundingClientRect();
    playbackBar.style.transition = 'none';
    playbackBar.style.translate = 'none';
    active = value; clearTimeout(timer); setIdle(false);
    root.classList.toggle('cinematic', value); hint.hidden = !value;
    onChange(value);
    button.setAttribute('aria-pressed', String(value));
    button.setAttribute('aria-label', value ? 'Show UI (exit cinematic mode)' : 'Hide UI (cinematic mode)');
    button.title = value ? 'Show UI · Esc' : 'Hide UI · Cinematic mode';
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const to = anchor.getBoundingClientRect();
      playbackBar.style.translate = `${from.left - to.left}px ${from.top - to.top}px`;
      playbackBar.getBoundingClientRect(); // Commit the starting position before transitioning.
    }
    playbackBar.style.transition = '';
    playbackBar.style.translate = '0px 0px';
    if (value) arm();
    else document.querySelectorAll(':popover-open').forEach(element => element.hidePopover());
  }
  listen(button, 'click', () => setActive(!active));
  listen(playbackBar, 'pointerenter', event => {
    if (event.pointerType === 'touch') return;
    hoveringPlayback = true; reveal();
  });
  listen(playbackBar, 'pointerleave', () => { hoveringPlayback = false; arm(); });
  listen(document, 'pointermove', reveal, { capture: true, passive: true });
  listen(document, 'pointerdown', event => {
    keyboard = false;
    if (!active) return;
    pointerHeld = true;
    if (idle) {
      // The first tap wakes controls without also choosing a site or seeking a date.
      suppressClickUntil = performance.now() + 600;
      event.preventDefault(); event.stopImmediatePropagation();
    }
    reveal();
  }, { capture: true });
  listen(document, 'pointerup', () => { pointerHeld = false; arm(); }, { capture: true });
  listen(document, 'pointercancel', () => { pointerHeld = false; arm(); }, { capture: true });
  listen(document, 'click', event => {
    if (active && performance.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); suppressClickUntil = 0; }
  }, { capture: true });
  listen(document, 'wheel', reveal, { capture: true, passive: true });
  listen(document, 'focusin', reveal, { capture: true });
  listen(document, 'keydown', event => {
    if (!active) return;
    if (event.key === 'Escape') { event.preventDefault(); setActive(false); button.focus(); return; }
    keyboard = true; reveal();
  }, { capture: true });
  return { get active() { return active; }, dispose() { clearTimeout(timer); events.abort(); setIdle(false); root.classList.remove('cinematic'); playbackBar.style.removeProperty('translate'); hint.remove(); } };
}
