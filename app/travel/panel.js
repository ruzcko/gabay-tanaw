import { TRAVEL_DEFAULTS, DAY, travelRequest, resultSource, observerLink, createTravelJobs, sortTravelResults, travelPointKey as pointKey } from './model.js';
import { surfaceThumbnail, releaseTravelThumbnails } from './thumbnail.js';
import { nearestLunarFeature } from '../computation/dist/travel.js';
import { miniForecast } from './mini-forecast.js';

const emit = detail => document.dispatchEvent(new CustomEvent('tanaw:travel', { detail }));
const coordText = p => `${Math.abs(p.lat).toFixed(4)}° ${p.lat < 0 ? 'S' : 'N'} · ${((p.lon + 360) % 360).toFixed(4)}° E`;
const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const button = (text, action) => { const b = node('button', 'btn', text); b.type = 'button'; b.addEventListener('click', action); return b; };

/** Owned by forecast.js. This view never chooses a second scene date or computes science. */
export function createTravelPanel(host) {
  const hud = document.querySelector('.hud');
  const root = node('section', 'travel'); root.id = 'travel'; root.hidden = true;
  root.setAttribute('aria-labelledby', 'travel-title');
  root.innerHTML = `
    <div class="travel-main">
      <div class="travel-head"><h2 id="travel-title" tabindex="-1">Travel</h2><button type="button" class="btn travel-expand" data-expand aria-expanded="false" aria-label="Expand Travel" title="Expand Travel"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg></button><button type="button" class="btn" data-close>Close</button></div>
      <form class="travel-form">
        <div class="travel-date-heading"><span>Dates · UTC</span><p data-trip></p></div>
        <div class="travel-pair"><label><span data-start-label>Arrival</span><input name="arrival" aria-label="Arrival · UTC" type="datetime-local" min="1969-01-01T00:00" max="2100-12-31T23:59" required></label><label><span data-end-label>Departure</span><input name="departure" aria-label="Departure · UTC" type="datetime-local" min="1969-01-01T00:00" max="2101-01-01T00:00" required></label></div>
        <div class="travel-search-row">
          <button class="btn travel-filter-toggle" type="button" aria-expanded="false" aria-controls="travel-filters" data-filters><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 6h7m4 0h5M4 12h3m4 0h9M4 18h11m4 0h1M11 3v6M7 9v6M15 15v6"/></svg>Filters</button>
          <button class="btn" type="button" data-cancel hidden>Cancel</button><button class="btn primary" type="submit" data-search>Search</button>
        </div>
      </form>
      <div class="travel-map-controls"><label>Highlight<select data-layer aria-label="Highlight"><option value="combined">All my requirements</option><option value="sunlight">Sunlight</option><option value="earth">Earth visibility</option><option value="terrain">Terrain</option><option value="unknown">Missing information</option></select></label><button class="btn" type="button" data-whole>Whole Moon</button></div>
      <p class="travel-status" role="status" aria-live="polite" data-status>Choose your dates, then search the whole Moon.</p>
      <p class="travel-error" role="alert" data-error hidden></p>
      <p class="travel-note" data-candidate-summary hidden></p>
      <div class="travel-results" tabindex="0" aria-label="Travel search results"></div>
      <button class="btn travel-load-more" type="button" data-load-more hidden>Load more</button>
      <details class="travel-limits"><summary>About these results</summary><p class="travel-note" data-map-summary></p><p>Map areas represent a checked point at their centre, not surveyed landing zones. Every listed destination is checked independently. Missing terrain stays unknown and cannot pass an enabled terrain filter.</p><p>Published forecasts are preferred from 1 Dec 2026 to 1 Dec 2027 exclusive. When published coverage is missing, quick-compute estimates are available and labelled Estimate. Other supported dates also use estimates. Mixed stays retain both sources.</p><p>Search checks new locations around the south pole and across the Moon. Load more explores additional locations; filters are never relaxed automatically. Disabling Terrain explicitly searches visibility-only destinations.</p><p>Thumbnails render the existing lunar surface model using arrival-time Sun directions. The model includes display fill light; images do not certify local shadow conditions.</p><p>Screening presets are configurable, not universal NASA landing requirements. No boulder, descent, energy or radio-link certification. Exact pole coordinates are unsupported; map coverage includes both polar caps.</p><button type="button" class="btn" data-scan-map hidden>Scan whole Moon</button><p class="travel-note">The optional 288-area map scan can take several minutes.</p></details>
    </div>
    <section class="travel-filters" id="travel-filters" aria-labelledby="travel-filters-title" hidden>
      <div class="travel-head"><h3 id="travel-filters-title">Filters</h3><button class="btn" type="button" data-filter-close aria-label="Close Travel filters">Close</button></div>
      <label class="travel-stay">Stay length <span><input aria-label="Stay · days" data-criteria="durationDays" type="number" min="0.01" max="30" step="any"> days</span></label>
      <label class="travel-known"><input type="checkbox" data-known checked>Known sites first</label>
      <div class="travel-sort" role="group" aria-labelledby="travel-sort-label">
        <span id="travel-sort-label">Sort by</span>
        <div class="travel-sort-controls">
          <select data-sort-direction aria-label="Sort direction" title="Ascending: low to high or A–Z. Descending: high to low or Z–A."><option value="asc">Asc ↑</option><option value="desc" selected>Desc ↓</option></select>
          <select data-sort-field aria-label="Sort field"><option value="sunlight">Sunlight</option><option value="earth">Earth visibility</option><option value="terrain">Terrain slope</option><option value="name">Name</option><option value="coordinates">Long–lat</option></select>
        </div>
      </div>
      <p class="travel-note travel-minimum-note">Minimum hours across your stay</p>
      <fieldset data-visibility="sunlight"><legend><label><input type="checkbox" data-criteria="sunlightEnabled">Sunlight</label></legend>
        <label class="travel-hours-label">At least <span><input type="number" data-hours="sunlight" aria-label="Minimum sunlight hours" min="0" step="any" required> h</span></label>
        <input type="range" data-hours-slider="sunlight" aria-label="Minimum sunlight hours slider" min="0" step="0.1">
        <div class="travel-range-labels"><span>0 h</span><span data-hours-total></span></div>
      </fieldset>
      <fieldset data-visibility="earth"><legend><label><input type="checkbox" data-criteria="earthEnabled">Earth visibility</label></legend>
        <label class="travel-hours-label">At least <span><input type="number" data-hours="earth" aria-label="Minimum Earth visibility hours" min="0" step="any" required> h</span></label>
        <input type="range" data-hours-slider="earth" aria-label="Minimum Earth visibility hours slider" min="0" step="0.1">
        <div class="travel-range-labels"><span>0 h</span><span data-hours-total></span></div>
      </fieldset>
      <fieldset><legend><label><input type="checkbox" data-criteria="terrainEnabled">Terrain</label></legend><label class="travel-hours-label">Slope below <span><input aria-label="Slope below · degrees" data-criteria="maxSlopeDeg" type="number" min="0.01" max="45" step="any"> °</span></label><p class="travel-note">Measured over 100 m. Missing terrain stays unknown.</p></fieldset>
      <details class="travel-advanced"><summary>More options</summary><label>Longest darkness · hours<input data-criteria="maxDarkHours" type="number" min="0" step="any"></label><label>Longest Earth outage · hours<input data-criteria="maxEarthOutageHours" type="number" min="0" step="any"></label><p class="travel-note">The sliders set total hours across your stay. Here you can limit any single interruption.</p></details>
      <button class="btn" type="button" data-reset>Reset defaults</button><p class="travel-note">Changes update your search automatically.</p>
    </section>`;
  hud.append(root);
  const $ = s => root.querySelector(s), form = $('.travel-form');
  const input = name => form.elements.namedItem(name);
  const jobs = createTravelJobs();
  let refreshTimer = null, autoRefresh = false, resultSequence = 0, moreUsed = false;
  let openingAnimation, closingAnimation, filterAnimation, sortAnimation;
  // One Travel selection/result, held by the host-owned controller. Fields are drafts until Search.
  const state = { open: false, criteria: { ...TRAVEL_DEFAULTS }, request: null, results: [], features: [], sampled: [], selected: '', busy: false, expected: '', layer: 'combined', knownFirst: true, sortField: 'sunlight', sortDirection: 'desc', cursor: null, pageReady: false };
  const trigger = button('Travel', () => setOpen(!state.open));
  trigger.id = 'travel-btn'; trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-controls', root.id);
  document.getElementById('fc-btn').before(trigger);

  function snapshotKey(selection) { return `${pointKey(selection.point)}@${Date.parse(selection.instantUtc)}`; }
  function fillSelection(selection) {
    state.expected = snapshotKey(selection);
    input('arrival').value = selection.instantUtc.slice(0, 16);
    setDeparture();
  }
  function setDeparture() {
    const at = Date.parse(input('arrival').value + 'Z');
    input('departure').value = Number.isFinite(at) ? new Date(at + state.criteria.durationDays * DAY).toISOString().slice(0, 16) : '';
    tripText();
  }
  function tripText() {
    const days = (Date.parse(input('departure').value + 'Z') - Date.parse(input('arrival').value + 'Z')) / DAY;
    $('[data-trip]').textContent = Number.isFinite(days) && days > 0 ? `${Number(days.toFixed(3))} ${days === 1 ? 'day' : 'days'} · ${Number((days * 24).toFixed(1))} h` : 'Choose a valid stay';
    const count = ['terrainEnabled', 'sunlightEnabled', 'earthEnabled'].filter(k => state.criteria[k]).length;
    $('[data-filters]').setAttribute('aria-label', `Filters ${count} enabled`);
    $('[data-filters]').title = `${count} filters enabled`;
  }
  function writeCriteria() {
    root.querySelectorAll('[data-criteria]').forEach(field => {
      const key = field.dataset.criteria, value = state.criteria[key];
      if (field.type === 'checkbox') field.checked = value;
      else field.value = key.endsWith('Fraction') ? value * 100 : value;
    }); writeHours(); tripText();
  }
  function writeHours(except) {
    const total = state.criteria.durationDays * 24;
    for (const [kind, key] of [['sunlight', 'minSunFraction'], ['earth', 'minEarthFraction']]) {
      const hours = Number((state.criteria[key] * total).toFixed(2));
      for (const field of root.querySelectorAll(`[data-hours="${kind}"], [data-hours-slider="${kind}"]`)) {
        field.max = total; field.disabled = !state.criteria[`${kind}Enabled`];
        if (field !== except) field.value = hours;
        if (field.type === 'range') { field.style.setProperty('--fill', `${state.criteria[key] * 100}%`); field.setAttribute('aria-valuetext', `At least ${hours} of ${Number(total.toFixed(2))} hours`); }
      }
    }
    root.querySelectorAll('[data-hours-total]').forEach(n => { n.textContent = `${Number(total.toFixed(2))} h`; });
  }
  function setBusy(busy) {
    state.busy = busy; $('.travel-results').setAttribute('aria-busy', String(busy));
    root.classList.toggle('is-loading', busy);
    $('[data-cancel]').hidden = !busy; $('[data-search]').textContent = busy ? 'Restart search' : 'Search';
    $('[data-scan-map]').disabled = busy;
    $('[data-load-more]').disabled = busy;
    $('[data-load-more]').textContent = busy ? 'Finding more destinations…' : 'Load more';
  }
  function publish() {
    const list = [...state.results, ...state.sampled].filter(r => r.status === 'pass');
    emit({ open: state.open, placement: null, features: state.features, layer: state.layer, markers: list.map(r => ({ point: r.point, status: r.status })), selected: state.selected });
  }
  function invalidate(message = 'Selection changed. Search to update the results.') {
    host.resetComparison();
    clearTimeout(refreshTimer); refreshTimer = null;
    jobs.invalidate(); setBusy(false); state.request = null; state.results = []; state.sampled = []; state.features = []; moreUsed = false;
    state.cursor = null; state.pageReady = false; $('[data-load-more]').hidden = true;
    releaseTravelThumbnails(root); $('.travel-results').replaceChildren(); $('[data-map-summary]').textContent = ''; $('[data-error]').hidden = true; $('[data-error]').textContent = '';
    $('[data-candidate-summary]').hidden = true; $('[data-candidate-summary]').textContent = ''; $('[data-scan-map]').hidden = true;
    $('[data-status]').textContent = message; publish();
  }
  function filtersChanged() {
    invalidate(autoRefresh ? 'Updating your results…' : 'Choose Search to find places for your trip.');
    if (!autoRefresh) return;
    setBusy(true);
    refreshTimer = setTimeout(() => { refreshTimer = null; setBusy(false); if (state.open) search(); }, 450);
  }
  function setFilters(on) {
    const filters = $('.travel-filters'); filterAnimation?.cancel(); filters.inert = !on;
    root.classList.toggle('filters-open', on);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) filters.hidden = !on;
    else {
      filters.hidden = false;
      filterAnimation = filters.animate(on ? [{ opacity: 0, transform: 'translateX(8px)' }, { opacity: 1, transform: 'translateX(0)' }] : [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(8px)' }], { duration: on ? 180 : 140, easing: on ? 'ease-out' : 'ease-in', fill: 'forwards' });
      filterAnimation.onfinish = () => { if (!on) filters.hidden = true; host.frame(); };
    }
    hud.classList.toggle('travel-filters-open', on);
    $('[data-filters]').setAttribute('aria-expanded', String(on)); host.frame();
    if (on) $('.travel-filters input').focus(); else $('[data-filters]').focus();
  }
  function setOpen(on) {
    if (on === state.open) return;
    state.open = on; openingAnimation?.cancel(); closingAnimation?.cancel();
    if (!on) host.resetComparison();
    hud.classList.toggle('travel-open', on);
    root.inert = !on;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (on) {
      root.hidden = false;
      if (!reduce) openingAnimation = root.animate([{ opacity: 0, transform: 'translateX(16px)' }, { opacity: 1, transform: 'translateX(0)' }], { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)' });
    } else if (reduce) root.hidden = true;
    else {
      closingAnimation = root.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(12px)' }], { duration: 170, easing: 'ease-in', fill: 'forwards' });
      closingAnimation.onfinish = () => { if (!state.open) root.hidden = true; };
    }
    trigger.setAttribute('aria-expanded', String(on));
    if (on) {
      host.open(); invalidate('Choose your dates, then search.'); fillSelection(host.selection()); writeCriteria();
      jobs.warmup({ startUtc: new Date(input('arrival').value + 'Z').toISOString(), endUtc: new Date(input('departure').value + 'Z').toISOString() });
      $('#travel-title').focus();
    }
    else { autoRefresh = false; clearTimeout(refreshTimer); refreshTimer = null; jobs.cancel(); setBusy(false); $('.travel-filters').hidden = true; root.classList.remove('filters-open'); hud.classList.remove('travel-filters-open'); $('[data-filters]').setAttribute('aria-expanded', 'false'); trigger.focus(); }
    publish(); host.frame();
  }
  async function choose(result, { preserveTime = false } = {}) {
    state.selected = pointKey(result.point);
    state.expected = `${state.selected}@${Date.parse(result.startUtc)}`;
    if (!preserveTime) { input('arrival').value = result.startUtc.slice(0, 16); input('departure').value = result.endUtc.slice(0, 16); }
    tripText();
    publish(); renderResults();
    await host.select(result, { preserveTime });
  }
  function updateCompareAction(row, result) {
    const action = host.compareAction(result.point), control = row.querySelector('.travel-compare');
    control.textContent = action;
    const full = action === 'Comparison full';
    control.hidden = full;
    let capacity = row.querySelector('.compare-capacity');
    if (!capacity) {
      capacity = node('div', 'compare-capacity'); capacity.setAttribute('role', 'status');
      capacity.append(node('span', '', 'Comparison full'), node('small', '', 'Remove a site from the comparison to add this location.'));
      control.after(capacity);
    }
    capacity.hidden = !full;
    control.setAttribute('aria-pressed', String(action === 'Remove site'));
  }
  function resultRow(result, index) {
    const article = node('article', 'travel-result'); article.dataset.point = pointKey(result.point);
    article.dataset.arrival = result.startUtc;
    article.classList.toggle('selected', state.selected === pointKey(result.point) && Date.parse(input('arrival').value + 'Z') === Date.parse(result.startUtc));
    const head = button('', () => choose(result)); head.className = 'travel-result-pick';
    const thumb = node('span', 'travel-thumbnail');
    thumb.append(surfaceThumbnail(result));
    const text = node('span', 'travel-result-title');
    text.append(node('strong', '', result.point.name || 'Sampled location'), node('span', 'travel-note', coordText(result.point)));
    const nearest = nearestLunarFeature(result.point, host.catalog());
    if (nearest) {
      const distance = nearest.distanceKm < 10 ? nearest.distanceKm.toFixed(1) : Math.round(nearest.distanceKm).toLocaleString('en');
      const reference = node('span', 'travel-note travel-nearest', nearest.distanceKm < .001 ? `At ${nearest.name} · catalogue site` : `${distance} km${nearest.direction ? ` ${nearest.direction} of` : ' from'} ${nearest.name}`);
      reference.title = 'Nearest lunar feature in our catalogue, measured to its listed coordinate.';
      text.append(reference);
    }
    const source = resultSource(result);
    if (source.startsWith('Estimate') || source.startsWith('Mixed')) text.append(node('span', 'travel-quality', source.startsWith('Mixed') ? 'Mixed forecast & estimate' : 'Estimate'));
    if (!result.criteria.terrainEnabled) text.append(node('span', 'travel-note', 'Visibility only · terrain not required'));
    head.append(thumb, text); article.append(head);
    const metrics = node('div', 'travel-metrics');
    for (const [key, label, cls] of [['sunlight', 'Sunlight', 'travel-sun'], ['earth', 'Earth in view', 'travel-earth']]) {
      const metric = result[key];
      metrics.append(node('p', cls, metric ? `${label} ${metric.hours.toFixed(1)} / ${(result.criteria.durationDays * 24).toFixed(1)} h · ${result.checks[key]}` : `${label} unknown`));
    }
    metrics.append(node('p', '', `Terrain ${result.checks.terrain}${result.terrain.slopeDeg !== null ? ` · ${result.terrain.slopeDeg.toFixed(1)}° slope` : ''}${!result.criteria.terrainEnabled ? ' · not required' : ''}`));
    const info = node('div', 'travel-info');
    const infoButton = button('i', () => { const show = infoButton.getAttribute('aria-expanded') !== 'true'; infoButton.setAttribute('aria-expanded', String(show)); info.classList.toggle('is-open', show); });
    infoButton.classList.add('travel-info-button'); infoButton.setAttribute('aria-label', `Trip information for ${result.point.name || coordText(result.point)}`); infoButton.setAttribute('aria-expanded', 'false');
    const tooltip = node('div', 'travel-tooltip'); tooltip.id = `travel-info-${++resultSequence}`; tooltip.setAttribute('role', 'tooltip'); infoButton.setAttribute('aria-describedby', tooltip.id);
    tooltip.append(metrics, node('p', 'travel-note', resultSource(result)));
    if (result.segments.some(s => s.reason === 'published-unavailable')) tooltip.append(node('p', 'travel-note', 'Quick estimate used where published coverage is unavailable.'));
    info.append(infoButton, tooltip); article.append(info);
    tooltip.append(node('p', 'travel-note', `Terrain: ${result.terrain.resolutionM} m pixels · ${result.terrain.baselineM} m baseline. Matches your enabled requirements.`));
    const placeInfo = () => {
      tooltip.hidden = false;
      const box = $('.travel-main').getBoundingClientRect(), anchor = infoButton.getBoundingClientRect();
      tooltip.classList.toggle('above', anchor.bottom + tooltip.offsetHeight > box.bottom - 8 && anchor.top - tooltip.offsetHeight > box.top);
    };
    info.addEventListener('pointerenter', placeInfo); info.addEventListener('focusin', placeInfo);
    info.addEventListener('pointerleave', () => { tooltip.hidden = false; });
    info.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); info.classList.remove('is-open'); infoButton.setAttribute('aria-expanded', 'false'); tooltip.hidden = true; infoButton.focus({ preventScroll: true }); } });
    const actions = node('div', 'travel-actions');
    const compare = button('Compare', () => { const entering = !host.comparing(); host.compare(result); if (entering) choose(result); }); compare.classList.add('travel-compare');
    const observer = node('a', 'btn icon'); observer.href = observerLink(result, host.catalog());
    observer.setAttribute('aria-label', '360° Observer view'); observer.dataset.tip = '360° Observer view';
    observer.append(document.querySelector('#observer-top svg').cloneNode(true));
    const book = button('Book', () => {}); book.disabled = true; book.title = 'Booking is not available';
    actions.append(compare, observer, book);
    const preview = node('div', 'travel-result-preview'); preview.append(miniForecast(result), actions);
    article.append(preview); return article;
  }
  function renderResults(animate = false) {
    sortAnimation?.cancel();
    const all = [...state.results, ...state.sampled];
    const passing = sortTravelResults(all.filter(r => r.status === 'pass'), { field: state.sortField, direction: state.sortDirection, knownFirst: state.knownFirst, knownIds: new Set(host.catalog().map(p => p.id)) });
    const box = $('.travel-results'), scrollTop = $('.travel-main').scrollTop, focused = document.activeElement;
    const existing = new Map([...box.querySelectorAll('.travel-result')].map(row => [`${row.dataset.point}@${row.dataset.arrival}`, row]));
    const rows = passing.map((result, i) => {
      const key = `${pointKey(result.point)}@${result.startUtc}`, row = existing.get(key) || resultRow(result, i);
      existing.delete(key);
      row.classList.toggle('selected', state.selected === pointKey(result.point) && Date.parse(input('arrival').value + 'Z') === Date.parse(result.startUtc));
      updateCompareAction(row, result);
      return row;
    });
    for (const row of existing.values()) releaseTravelThumbnails(row);
    box.replaceChildren();
    if (!all.length) return;
    box.append(node('h3', '', passing.length ? `${passing.length} places match` : 'No matching trips'));
    if (!passing.length) box.append(node('p', 'travel-note', 'Try other dates or adjust your filters. Only confirmed matches appear here.'));
    const label = { sunlight: 'Sunlight hours', earth: 'Earth visibility hours', terrain: 'Terrain slope', name: 'Name', coordinates: 'Longitude, then latitude' }[state.sortField];
    const order = state.sortField === 'name' ? (state.sortDirection === 'asc' ? 'A–Z' : 'Z–A') : (state.sortDirection === 'asc' ? 'low to high' : 'high to low');
    box.append(node('p', 'travel-note', `${state.knownFirst ? 'Known sites first · ' : ''}${label}: ${order}.${state.sortField === 'terrain' ? ' Unknowns last.' : ''}`));
    box.append(...rows);
    if (focused?.isConnected) focused.focus({ preventScroll: true });
    $('.travel-main').scrollTop = scrollTop;
    if (animate && passing.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches)
      sortAnimation = box.animate([{ opacity: .65 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
    publish();
  }
  function showMapSummary() {
    const features = state.features;
    const pass = features.filter(f => f.properties.status === 'pass').length, unknown = features.filter(f => f.properties.status === 'unknown').length;
    const global = features.some(f => String(f.id).startsWith('global-'));
    $('[data-map-summary]').textContent = features.length ? `${features.length}${global ? '/288 bins' : ' checked destination areas'} · ${pass} match · ${unknown} unresolved. Areas represent centre samples, not surveyed terrain.` : '';
  }
  function showCandidates(progress, complete = false) {
    const note = $('[data-candidate-summary]');
    note.hidden = !complete;
    note.textContent = complete ? (moreUsed ? 'Additional destinations checked with the same filters.' : 'Explore more locations with Load more. Your filters stay the same.') : '';
    if (complete && progress.terrainSkipped?.unknown) note.textContent += ' Some locations lack terrain detail required by your filter.';
  }
  function receive(message) {
    if (message.message) $('[data-status]').textContent = message.message;
    if (message.type === 'error') { jobs.cancel(); setBusy(false); $('[data-load-more]').hidden = !state.pageReady || moreUsed; $('[data-error]').textContent = message.message; $('[data-error]').hidden = false; $('[data-status]').textContent = 'Search incomplete. Your existing matches remain available.'; return; }
    if (message.results) state.results = message.results;
    if (message.features) { state.features = message.features; showMapSummary(); if (!['catalog', 'candidate', 'complete'].includes(message.type)) publish(); }
    if (message.sampled) state.sampled = message.sampled;
    if (message.progress) showCandidates(message.progress);
    if (message.discovery) { state.cursor = message.discovery.cursor; showCandidates(message.discovery, true); }
    if (['catalog', 'candidate', 'complete'].includes(message.type)) renderResults();
    if (message.type === 'complete') {
      setBusy(false); state.pageReady = true;
      $('[data-load-more]').hidden = !state.pageReady || moreUsed; $('[data-scan-map]').hidden = !state.pageReady;
      $('[data-status]').textContent = 'Search complete. Select a diamond or a destination to explore.';
    }
  }
  $('[data-load-more]').addEventListener('click', () => {
    if (state.busy || !state.pageReady || !state.request || moreUsed) return;
    moreUsed = true;
    $('[data-error]').hidden = true;
    setBusy(true); $('[data-status]').textContent = 'Finding more destinations…';
    jobs.run({ ...state.request, operation: 'more', catalog: host.catalog(), results: state.results, sampled: state.sampled, cursor: state.cursor }, receive, { reuse: true });
  });
  function search(event) {
    event?.preventDefault();
    clearTimeout(refreshTimer); refreshTimer = null;
    if (!form.checkValidity()) { form.reportValidity(); return; }
    for (const field of root.querySelectorAll('[data-criteria], [data-hours]')) if (!field.checkValidity()) { setFilters(true); field.closest('details')?.setAttribute('open', ''); field.reportValidity(); field.focus(); return; }
    try {
      const point = host.selection().point;
      const request = travelRequest({ mode: 'date', startUtc: input('arrival').value + 'Z', endUtc: input('departure').value + 'Z', point, criteria: state.criteria });
      invalidate('Finding places for your trip…'); autoRefresh = true; state.request = request; state.criteria = { ...request.criteria }; writeCriteria(); setBusy(true);
      // Publish the requested scene instant immediately through the existing host.
      const selectedPoint = point;
      state.expected = `${pointKey(selectedPoint)}@${Date.parse(request.startUtc)}`;
      host.select({ point: selectedPoint, startUtc: request.startUtc, endUtc: request.endUtc });
      jobs.run({ ...request, catalog: host.catalog() }, receive, { reuse: true });
    } catch (error) { $('[data-error]').textContent = error.message; $('[data-error]').hidden = false; }
  }
  form.addEventListener('submit', search);
  form.addEventListener('input', event => {
    if (event.target.name === 'arrival') setDeparture();
    if (event.target.name === 'departure') { const duration = (Date.parse(input('departure').value + 'Z') - Date.parse(input('arrival').value + 'Z')) / DAY; if (duration > 0 && duration <= 30) { state.criteria.durationDays = duration; writeCriteria(); } }
    tripText(); filtersChanged();
  });
  root.querySelectorAll('[data-criteria]').forEach(field => field.addEventListener('input', () => {
    const key = field.dataset.criteria;
    state.criteria[key] = field.type === 'checkbox' ? field.checked : Number(field.value) / (key.endsWith('Fraction') ? 100 : 1);
    if (key === 'durationDays' && field.validity.valid) setDeparture();
    writeHours(); tripText(); filtersChanged();
  }));
  root.querySelectorAll('[data-hours], [data-hours-slider]').forEach(field => field.addEventListener('input', () => {
    const kind = field.dataset.hours || field.dataset.hoursSlider;
    if (!field.validity.valid) { invalidate('Enter hours within your stay length.'); return; }
    const total = state.criteria.durationDays * 24, hours = Number(field.value);
    state.criteria[kind === 'sunlight' ? 'minSunFraction' : 'minEarthFraction'] = hours / total;
    // With no tighter interruption preference, the total-hours slider allows the remaining
    // time to be unavailable. Both limits still go through the existing science contract.
    const gap = kind === 'sunlight' ? 'maxDarkHours' : 'maxEarthOutageHours';
    state.criteria[gap] = Math.max(0, total - hours);
    $(`[data-criteria="${gap}"]`).value = state.criteria[gap];
    writeHours(field); filtersChanged();
  }));
  $('[data-known]').addEventListener('change', event => { state.knownFirst = event.target.checked; renderResults(true); });
  for (const [selector, key] of [['[data-sort-field]', 'sortField'], ['[data-sort-direction]', 'sortDirection']]) {
    $(selector).addEventListener('change', event => { state[key] = event.target.value; renderResults(true); });
  }
  root.querySelectorAll('[data-criteria][type="number"]').forEach(field => { field.required = true; });
  $('[data-reset]').addEventListener('click', () => { state.criteria = { ...TRAVEL_DEFAULTS }; state.knownFirst = true; $('[data-known]').checked = true; state.sortField = 'sunlight'; state.sortDirection = 'desc'; $('[data-sort-field]').value = state.sortField; $('[data-sort-direction]').value = state.sortDirection; writeCriteria(); setDeparture(); filtersChanged(); });
  $('[data-close]').addEventListener('click', () => setOpen(false));
  $('[data-expand]').addEventListener('click', () => {
    const expanded = root.classList.toggle('is-expanded');
    $('[data-expand]').setAttribute('aria-expanded', String(expanded));
    $('[data-expand]').setAttribute('aria-label', expanded ? 'Collapse Travel' : 'Expand Travel');
    $('[data-expand]').title = expanded ? 'Back to comparison' : 'Expand Travel';
    if (!expanded) $('.travel-main').scrollTop = 0;
    host.frame();
  });
  $('[data-filters]').addEventListener('click', () => setFilters($('[data-filters]').getAttribute('aria-expanded') !== 'true'));
  $('[data-filter-close]').addEventListener('click', () => setFilters(false));
  $('[data-cancel]').addEventListener('click', () => {
    autoRefresh = false; clearTimeout(refreshTimer); refreshTimer = null; jobs.cancel(); setBusy(false);
    state.pageReady = !!state.request; $('[data-load-more]').hidden = !state.pageReady || moreUsed;
    $('[data-status]').textContent = 'Search cancelled. Your existing matches remain available.';
  });
  $('[data-whole]').addEventListener('click', () => host.wholeMoon());
  $('[data-layer]').addEventListener('change', event => { state.layer = event.target.value; publish(); });
  $('[data-scan-map]').addEventListener('click', () => {
    if (!state.request) return;
    setBusy(true); $('[data-status]').textContent = 'Scanning the whole Moon…';
    jobs.run({ ...state.request, operation: 'map' }, message => {
      if (message.message) $('[data-status]').textContent = message.message;
      if (message.features) { state.features = message.features; showMapSummary(); publish(); }
      if (message.type === 'error') { jobs.cancel(); setBusy(false); $('[data-error]').textContent = message.message; $('[data-error]').hidden = false; $('[data-status]').textContent = 'Map scan incomplete. Your matching destinations remain available.'; }
      if (message.type === 'map-complete') { jobs.cancel(); setBusy(false); $('[data-status]').textContent = 'Whole-Moon map complete.'; }
    });
  });
  root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); $('.travel-filters').hidden ? setOpen(false) : setFilters(false); } });
  for (const id of ['search-btn', 'clock', 'now']) document.getElementById(id)?.addEventListener('click', () => { if (state.open) setOpen(false); });
  document.addEventListener('tanaw:travel-pick', event => {
    if (!state.open) return;
    const candidates = [...state.results, ...state.sampled].filter(r => pointKey(r.point) === event.detail.key);
    const result = candidates.find(r => Date.parse(r.startUtc) === Date.parse(input('arrival').value + 'Z')) || candidates[0];
    if (!result) return;
    choose(result, { preserveTime: !!event.detail.preserveTime }); [...root.querySelectorAll('.travel-result')].find(n => n.dataset.point === event.detail.key)?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  });
  const resize = new ResizeObserver(() => host.frame()); resize.observe(root); resize.observe($('.travel-filters'));
  window.addEventListener('pagehide', () => { clearTimeout(refreshTimer); jobs.cancel(); resize.disconnect(); }, { once: true });
  return {
    get active() { return state.open; },
    resultFor(point) { return [...state.results, ...state.sampled].find(r => r.status === 'pass' && pointKey(r.point) === pointKey(point)); },
    syncComparison() {
      if (!host.comparing()) {
        root.classList.remove('is-expanded');
        $('[data-expand]').setAttribute('aria-expanded', 'false');
        $('[data-expand]').setAttribute('aria-label', 'Expand Travel');
        $('[data-expand]').title = 'Expand Travel';
      }
      for (const row of root.querySelectorAll('.travel-result')) {
        const result = [...state.results, ...state.sampled].find(r => pointKey(r.point) === row.dataset.point);
        if (result) updateCompareAction(row, result);
      }
    },
    close: () => setOpen(false),
    focusComparison() { (root.querySelector('.travel-result.selected .travel-compare') || root.querySelector('.travel-compare'))?.focus({ preventScroll: true }); },
    sync(selection) {
      if (!state.open || !selection?.point || snapshotKey(selection) === state.expected) return;
      if (host.comparing()) return;
      // Scrubbing the surrounding forecast explores context, not a new booked interval.
      // Only a location change or an explicit edit to the Travel fields replaces the search.
      if (state.request && pointKey(selection.point) === state.expected.split('@')[0]) return;
      fillSelection(selection); invalidate();
    },
    bounds() {
      if (!state.open) return null;
      const box = root.getBoundingClientRect();
      // Filters overlay the scene; they must not change its camera framing.
      return { top: box.top, left: box.left, mobile: innerWidth < 1024 };
    }
  };
}
