const MINUTE = 60000, DAY = 86400000;

/** One shared UTC clock. Computation supplies every scene at a whole minute. */
export function createPlayback(button, { state, select, speedButton, onPause = () => {}, schedule = requestAnimationFrame, unschedule = cancelAnimationFrame }) {
  let playing = false, generation = 0, frame, last, position, end, speed, pending, multiplier = 1;
  function showSpeed() {
    if (!speedButton) return;
    speedButton.textContent = `${multiplier}×`;
    speedButton.setAttribute('aria-label', `Playback speed: ${multiplier}×`);
    speedButton.title = `Playback speed: ${multiplier}×. Click for ${multiplier === 8 ? 1 : multiplier * 2}×.`;
  }
  const cycleSpeed = () => { multiplier = multiplier === 8 ? 1 : multiplier * 2; last = undefined; showSpeed(); };
  showSpeed(); speedButton?.addEventListener('click', cycleSpeed);
  function pause() {
    const wasPlaying = playing;
    playing = false; generation++; unschedule(frame);
    button.setAttribute('aria-label', 'Play'); button.title = 'Play'; button.classList.remove('is-playing');
    if (wasPlaying) onPause();
  }
  function queue(own) {
    frame = schedule(async now => {
      if (!playing || own !== generation) return;
      // A quick pause/resume must not submit a second request while the old one finishes.
      if (pending) {
        await pending.catch(() => {});
        if (!playing || own !== generation) return;
        position = Date.parse(state().instantUtc); last = undefined; queue(own); return;
      }
      // Slow work slows playback instead of skipping a large interval on return.
      const elapsed = last === undefined ? 0 : Math.max(0, Math.min(50, now - last));
      last = now; position = Math.min(end, position + elapsed * speed * multiplier);
      const utc = new Date(Math.floor(position / MINUTE) * MINUTE).toISOString();
      if (utc !== state().instantUtc) {
        let ready;
        let request;
        try { request = Promise.resolve(select(utc)); } catch (error) { request = Promise.reject(error); }
        pending = request;
        try { ready = await request; } catch { ready = false; }
        finally { if (pending === request) pending = null; }
        if (!playing || own !== generation) return;
        if (ready === false) { pause(); return; }
      }
      if (position >= end) { pause(); return; }
      queue(own);
    });
  }
  const toggle = () => {
    if (playing) { pause(); return; }
    const current = state(); if (!current) return;
    const start = Date.parse(current.startUtc);
    end = Date.parse(current.endUtc) + DAY - MINUTE;
    position = Date.parse(current.instantUtc);
    if (position >= end) position = start;
    speed = (end - start) / 30000; last = undefined;
    playing = true; const own = ++generation;
    button.setAttribute('aria-label', 'Pause'); button.title = 'Pause'; button.classList.add('is-playing');
    queue(own);
  };
  button.addEventListener('click', toggle);
  return { pause, get playing() { return playing; }, get speed() { return multiplier; }, dispose() { pause(); button.removeEventListener('click', toggle); speedButton?.removeEventListener('click', cycleSpeed); } };
}
