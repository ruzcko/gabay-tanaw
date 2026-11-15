import { formatLatLon } from './math.js';
const customName = () => customSite ? formatLatLon(customSite.latitudeDeg, customSite.longitudeEastDeg) : 'Selected location';
import { createObserverView } from './index.js';
import { createStaticForecastProvider, toObserverViewSnapshot } from '../computation/dist/index.js';
import { localAssetProvider, createLocalTerrainProvider } from './local-providers.js';
import { createLocationGlobe } from './location-globe.js';
import { createCinematicMode } from './cinematic.js';
import { createDateScrubber } from './date-scrubber.js';
import { createSavedTerrainProvider } from './saved-terrain.js';
import { readLocalObserver, readLocalObserverWindow } from '../computation/dist/local-observer.js';
import { catalogSiteAt, requestedWindow } from './selection-window.js';
import { createLoadingStatus, displayedScene } from './loading-status.js';
import { readObserverRoute } from './route.js';
import { createProgressiveForecast } from './progressive-window.js';
import { createQuickEstimatePanel } from './quick-estimate.js';
import { createForecastSource } from '../forecast-source.js';
import { productSnapshot } from '../computation/dist/forecast-product.js';
import { QUICK_RANGE } from '../computation/dist/quick/coverage.js';
import { createProgressiveTerrainProvider } from './progressive-terrain.js';
import { createPlayback } from './playback.js';

// The local science service runs only on a developer's machine; static hosting has no /api, so
// the page doesn't ask for it there.
async function localServiceInfo(signal) {
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return {};
  const health = await fetch('/api/health', { signal });
  return health.ok ? health.json() : {};
}

const $ = selector => document.querySelector(selector);
const provider = createStaticForecastProvider();
const lifecycle = new AbortController();
let sites = [], scrubber, controller, generation = 0, firstSnapshot = true, accepted, customSite, serviceAvailable = false, scrubTimer;
let windowSupported = false, quickPanel, estimateMode = false, travelTrip = null;
let readyEstimateWindow, estimateRun;
let hoursSite, lastRouteWrite = 0;
let horizonLineVisible = true, selectedSiteId = 'custom';
const playback = createPlayback($('#observer-play'), {
  state: () => scrubber?.state,
  speedButton: $('#observer-speed'),
  select: utc => { clearTimeout(scrubTimer); scrubTimer = null; return updatePlayback(++generation, utc); },
  onPause: () => {
    ++generation; // An in-flight frame must not advance the display after Pause.
    if (accepted) { const url = new URL(location.href); url.searchParams.set('t', accepted.instantUtc); history.replaceState(null, '', url); }
  }
});
function prepareHours(site) {
  const key = JSON.stringify([site.latitudeDeg, site.longitudeEastDeg]);
  if (hoursSite !== key) { hoursSite = key; scrubber.setForecastDays([]); }
}
const estimateSource = createForecastSource();
const estimateTerrain = createLocalTerrainProvider();
const customServiceMessage = "Custom locations need the forecast service, which isn't available on this site. Choose another location on the Moon navigator.";
const serviceUnavailable = error => error?.serviceUnavailable || error instanceof TypeError || error instanceof SyntaxError || error?.code === 'UPSTREAM';
function showCustomServiceUnavailable() {
  serviceAvailable = false; windowSupported = false;
  $('#error').textContent = customServiceMessage;
  forecastStatus.set(displayedScene(accepted));
  locationGlobe.failSelection('');
  sceneNotice('');
  scrubber.setLoading(false);
  $('#window-status').hidden = true;
  $('#retry').hidden = false;
}
const progressive = createProgressiveForecast(readLocalObserverWindow, () => {
  if (!scrubber || selectedSiteId !== 'custom') return;
  showWindow();
  scrubber.setLoading(!!progressive.state?.loading);
});
const forecastStatus = createLoadingStatus($('#forecast-status'), $('#view'));
const terrainStatus = createLoadingStatus($('#terrain-status'));
const terrainWork = createLoadingStatus($('#terrain-work'));
const savedTerrain = createSavedTerrainProvider();
const terrainProvider = createProgressiveTerrainProvider({ local: estimateTerrain, saved: savedTerrain,
  catalog: createSavedTerrainProvider({ baseUrl: new URL('../assets/observer/terrain/catalog/', import.meta.url) }) });
const observer = createObserverView({
  container: $('#view'), terrainProvider, assetProvider: localAssetProvider, onSiteSelect: selectCoordinates,
  onTerrainStatus(info) {
    $('#terrain-note').textContent = info.state === 'ready'
      ? info.detailAvailable ? 'Detailed terrain loaded. Relief is aligned to the forecast ground height; visibility still uses the forecast horizon.'
        : 'Detailed terrain is unavailable here. Showing coarse terrain.'
      : info.state === 'error' ? 'Detailed terrain could not load. The current terrain remains visible.' : '';
    const busy = ['loading', 'refining'].includes(info.state);
    $('#terrain-work').hidden = !busy;
    terrainWork.set(info.state === 'refining' ? 'Loading detailed terrain…' : 'Loading terrain mesh…', busy);
    terrainStatus.set(info.state === 'ready' ? `${info.source} · ${info.resolutionM.toFixed(1)} m terrain sampling` :
      info.state === 'error' ? info.message : 'Loading terrain mesh…', busy);
  },
  // Terrain/appearance failures retain the sky and reference ground.
  onError(error) { terrainStatus.set(error.message); }
});
const siteReadout = document.createElement('p'); siteReadout.className = 'observer-site'; $('.observer-context').prepend(siteReadout);
const sceneFeedback = document.createElement('p'); sceneFeedback.className = 'scene-feedback'; sceneFeedback.hidden = true;
sceneFeedback.setAttribute('aria-hidden', 'true'); $('.observer-viewport').append(sceneFeedback);
const feedback = createLoadingStatus(sceneFeedback);
let feedbackTimer;
function sceneNotice(message, busy = false) {
  clearTimeout(feedbackTimer); sceneFeedback.hidden = !message;
  sceneFeedback.classList.toggle('is-selected', !!message && !busy);
  feedback.set(message, busy);
  if (message && !busy) feedbackTimer = setTimeout(() => { sceneFeedback.hidden = true; }, 2200);
}
const locationGlobe = createLocationGlobe($('.observer-viewport'), selectCoordinates);
$('.observer-controls').insertBefore($('#quick-estimate'), $('.observer-controls nav'));
function useQuickEstimateForCustomSite() {
  if (estimateMode || serviceAvailable || selectedSiteId !== 'custom') return;
  const { instantUtc, rangeDays, startUtc } = scrubber.state;
  estimateMode = true;
  configureScrubber(instantUtc, rangeDays, startUtc);
}
function selectCoordinates(coordinates) {
  playback.pause();
  locationGlobe.beginSelection(coordinates, true);
  const saved = catalogSiteAt(sites, coordinates);
  if (saved) {
    selectedSiteId = saved.id; scrubber.setCustomLocation(false);
    update(); return;
  }
  const next = { latitudeDeg: Number(coordinates.latitudeDeg.toFixed(6)), longitudeEastDeg: Number(coordinates.longitudeEastDeg.toFixed(6)) };
  const changed = JSON.stringify(next) !== JSON.stringify(customSite);
  customSite = next;
  selectedSiteId = 'custom';
  useQuickEstimateForCustomSite();
  scrubber.setCustomLocation(!estimateMode, changed);
  update();
}

function showWindow() {
  if (estimateMode) { $('#window-status').hidden = true; return; }
  const custom = selectedSiteId === 'custom';
  $('#window-status').hidden = !custom;
  if (!custom) return;
  const state = scrubber.state, progress = progressive.state;
  const matches = progress && progress.site.latitudeDeg === customSite.latitudeDeg && progress.site.longitudeEastDeg === customSite.longitudeEastDeg &&
    progress.window.startUtc === requestedWindow(state).startUtc && progress.window.endUtc === requestedWindow(state).endUtc;
  const ready = matches ? progress.readyDays : 0;
  scrubber.setCoverage(matches ? progress.samples : new Map());
  const phase = ready === state.length ? 'All dates ready.' : matches && progress.error ? 'Loading paused; retry missing dates.' : 'Loading more dates…';
  $('#window-status').textContent = `${ready} of ${state.length} days ready · ${state.startUtc.slice(0, 10)} to ${state.endUtc.slice(0, 10)} UTC. ${phase} Bright track: ready to scrub. Selecting an unloaded date loads it next.`;
  if (matches && progress.error) {
    if (serviceUnavailable(progress.error)) { showCustomServiceUnavailable(); return; }
    $('#error').textContent = `${progress.error.message} ${ready} of ${state.length} days remain available. Retry to load the missing dates.`;
    $('#retry').hidden = false;
  }
}

async function update() {
  if (!scrubber) return;
  // Static catalog selections need the same coherent product as minute playback:
  // the legacy hourly provider supplies visibility but no geometric lighting.
  const staticCatalog = !serviceAvailable && sites.some(site => site.id === selectedSiteId);
  if (estimateMode || staticCatalog || Date.parse(scrubber.instantUtc) % 3600000) return updateEstimate();
  showWindow();
  const current = ++generation;
  controller?.abort(); controller = new AbortController();
  const signal = controller.signal;
  const stale = () => current !== generation || lifecycle.signal.aborted;
  clearTimeout(scrubTimer); scrubTimer = null;
  const selected = sites.find(site => site.id === selectedSiteId), instantUtc = scrubber.instantUtc;
  const requested = selected ? { id: selected.id, latitudeDeg: selected.lat, longitudeEastDeg: selected.lon } : customSite;
  prepareHours(requested);
  locationGlobe.beginSelection(requested);
  scrubber.setLoading(true);
  const name = selected?.name || customName();
  $('#error').textContent = ''; $('#retry').hidden = true;
  const loading = message => { forecastStatus.set(`${message} ${displayedScene(accepted)}`, true); sceneNotice(message, true); };
  loading(selected ? `Loading ${name} · ${instantUtc.slice(0, 16).replace('T', ' ')} UTC…` : `Loading selected date · Preparing ${scrubber.state.length} days of terrain and sky data…`);
  try {
    let saved, result;
    if (selected) {
      progressive.stop(); scrubber.setCoverage(null);
      saved = await provider.observe({ site: requested, instantUtc, signal });
      if (stale()) return;
      if (serviceAvailable) loading('Loading observer sky…');
      result = serviceAvailable ? await readLocalObserver(requested, instantUtc, signal) : saved;
    } else {
      if (!windowSupported) {
        loading('Checking local science service…');
        const info = await localServiceInfo(signal);
        if (stale()) return;
        serviceAvailable = info.service === 'tanaw-observer';
        if (!serviceAvailable) throw Object.assign(new Error(customServiceMessage), { serviceUnavailable: true });
        windowSupported = info.observerWindow?.durationDays === 30;
        if (!windowSupported) throw new Error('This local service cannot prepare a 30-day window. Start the updated local science service.');
      }
      result = await progressive.select(requested, requestedWindow(scrubber.state), instantUtc, signal);
    }
    if (!result) throw new Error('The local science service is required for this location.');
    if (saved && serviceAvailable && JSON.stringify(saved.bodies) !== JSON.stringify(result.bodies)) throw new Error('Local observations differ from the published forecast.');
    if (stale()) return;
    displaySnapshot(result, selected, requested, name);
    if (selected) {
      estimateSource.published(`forecast/${selected.id}.json`, signal).then(index => {
        if (!stale()) scrubber.setForecastDays(index.days, 'accurate');
      }).catch(() => {});
    } else {
      const window = requestedWindow(scrubber.state);
      estimateSource.load({ name, lat: requested.latitudeDeg, lon: requested.longitudeEastDeg, instantUtc, ...window }, emission => {
        if (!stale()) scrubber.setForecastDays(emission.data.index.days, emission.quality);
      }).catch(() => {});
    }
  } catch (error) {
    if (stale()) return;
    if (!selected && serviceUnavailable(error)) { showCustomServiceUnavailable(); return; }
    locationGlobe.failSelection();
    $('#error').textContent = `${error.message} Choose another date or site, or retry.`;
    forecastStatus.set(`Forecast unavailable. ${displayedScene(accepted)}`);
    sceneNotice('Unable to load this selection. Use Retry below.');
    showWindow();
    $('#retry').hidden = false;
  } finally {
    if (current === generation) { $('#view').setAttribute('aria-busy', 'false'); scrubber.setLoading(!selected && !!progressive.state?.loading); }
  }
}

function displaySnapshot(result, selected, requested, name, frameUpdate = false) {
  const instantUtc = result.instantUtc;
  const snapshot = toObserverViewSnapshot(result);
  snapshot.site.name = name;
  if (observer.setSnapshot(snapshot) === false) throw new Error('The observer could not display this forecast.');
  const siteChanged = accepted?.site.id !== snapshot.site.id;
  accepted = snapshot;
  $('#observer-play').disabled = false;
  sceneNotice(siteChanged ? `Site selected · ${formatLatLon(snapshot.site.latitudeDeg, snapshot.site.longitudeEastDeg)}` : '');
  document.querySelectorAll('[data-look]').forEach(button => button.disabled = false);
  locationGlobe.update(snapshot);
  locationGlobe.setVisible(true);
  siteReadout.replaceChildren(document.createTextNode(name));
  const coords = document.createElement('small'); coords.textContent = formatLatLon(snapshot.site.latitudeDeg, snapshot.site.longitudeEastDeg); siteReadout.append(coords);
  if (firstSnapshot) { observer.frameOpening(); firstSnapshot = false; }
  const visibility = name => `${name === 'sun' ? 'Sun' : 'Earth'} ${snapshot.bodies[name].centerVisible ? 'in view' : 'hidden by terrain'}`;
  forecastStatus.set(`${snapshot.quality === 'estimate' ? 'Estimate · ' : snapshot.interpolated ? 'Accurate forecast (interpolated) \u00b7 ' : estimateMode ? 'Accurate forecast · ' : ''}${snapshot.instantUtc.slice(11, 16)} UTC · ${visibility('sun')} · ${visibility('earth')}`);
  showWindow();
  $('#modeled-height').textContent = `Observer height: ${snapshot.site.observerHeightM} m above modeled ground.`;
  quickPanel?.setDate(instantUtc);
  if (frameUpdate && playback.playing && performance.now() - lastRouteWrite < 500) return;
  lastRouteWrite = performance.now();
  const url = new URL(location.href); url.searchParams.set('t', instantUtc);
  url.searchParams.set('rangeStart', scrubber.state.startUtc);
  url.searchParams.set('rangeDays', String(scrubber.state.rangeDays));
  if (estimateMode) url.searchParams.set('estimate', '1'); else url.searchParams.delete('estimate');
  if (selected) { url.searchParams.set('site', selected.id); url.searchParams.delete('lat'); url.searchParams.delete('lon'); }
  else { url.searchParams.delete('site'); url.searchParams.set('lat', requested.latitudeDeg); url.searchParams.set('lon', requested.longitudeEastDeg); }
  history.replaceState(null, '', url);
  const moon = new URL('../', location.href); if (selected) moon.searchParams.set('site', selected.id); moon.searchParams.set('t', instantUtc);
  if (estimateMode) { moon.searchParams.set('estimate', '1'); if (!selected) { moon.searchParams.set('lat', requested.latitudeDeg); moon.searchParams.set('lon', requested.longitudeEastDeg); } }
  $('.observer-topbar a').href = moon.href;
}

function cancelSelection() {
  ++generation; clearTimeout(scrubTimer); scrubTimer = null;
  controller?.abort(); estimateSource.cancel(); progressive.stop();
  if (scrubber) scrubber.setLoading(false);
  if (!accepted) forecastStatus.set(displayedScene(accepted));
  sceneNotice('');
}
async function updateEstimate() {
  const selectionGeneration = generation;
  const selected = sites.find(site => site.id === selectedSiteId);
  const requested = selected ? { id: selected.id, latitudeDeg: selected.lat, longitudeEastDeg: selected.lon } : customSite;
  prepareHours(requested);
  const instantUtc = scrubber.instantUtc, start = Date.parse(scrubber.state.startUtc), end = Date.parse(scrubber.state.endUtc) + 86400000;
  const name = selected?.name || customName();
  const windowKey = JSON.stringify([requested.id, requested.latitudeDeg, requested.longitudeEastDeg, start, end]);
  // Finish work for this range before taking the newest scrub position. Aborting the
  // worker on every input destroys its loaded coefficients and prepared forecast.
  if (estimateRun?.key === windowKey) {
    await estimateRun.done.catch(() => {});
    if (selectionGeneration !== generation || lifecycle.signal.aborted) return;
  }
  cancelSelection(); const current = generation;
  const stale = () => current !== generation || lifecycle.signal.aborted;
  const run = { key: windowKey, done: null }; estimateRun = run;
  $('#error').textContent = ''; $('#retry').hidden = true;
  scrubber.setCoverage(null); showWindow();
  quickPanel.setDate(instantUtc); locationGlobe.beginSelection(requested);
  // Cached results and quick scene updates should not flash a forecast-loading message.
  const loadingTimer = setTimeout(() => {
    if (stale()) return;
    quickPanel.loading(instantUtc, `Preparing ${scrubber.state.length} days for ${name}…`);
    scrubber.setLoading(readyEstimateWindow !== windowKey);
    if (readyEstimateWindow !== windowKey) forecastStatus.set(`Preparing ${name}… ${displayedScene(accepted)}`, true);
  }, 150);
  try {
    run.done = estimateSource.load({ id: selected?.id, name, lat: requested.latitudeDeg, lon: requested.longitudeEastDeg,
      instantUtc, startUtc: new Date(start).toISOString(), endUtc: new Date(end).toISOString() }, emission => {
      if (stale()) return;
      clearTimeout(loadingTimer);
      readyEstimateWindow = windowKey;
      scrubber.setForecastDays(emission.data.index.days, emission.quality);
      displaySnapshot(productSnapshot(emission.data, instantUtc), selected, requested, name);
      quickPanel.show(emission, instantUtc); scrubber.setLoading(false);
    });
    await run.done;
  } catch (error) {
    if (stale()) return;
    quickPanel.error(error.message); locationGlobe.failSelection();
    forecastStatus.set(`Forecast unavailable. ${displayedScene(accepted)}`);
    $('#retry').hidden = false;
  } finally {
    if (estimateRun === run) estimateRun = null;
    clearTimeout(loadingTimer); if (!stale()) scrubber.setLoading(false);
  }
}

async function updatePlayback(current, instantUtc) {
  if (estimateRun) await estimateRun.done.catch(() => {});
  if (current !== generation || lifecycle.signal.aborted) return false;
  const selected = sites.find(site => site.id === selectedSiteId);
  const requested = selected ? { id: selected.id, latitudeDeg: selected.lat, longitudeEastDeg: selected.lon } : customSite;
  const name = selected?.name || customName();
  const request = { id: selected?.id, name, lat: requested.latitudeDeg, lon: requested.longitudeEastDeg,
    instantUtc, ...requestedWindow(scrubber.state) };
  let result;
  try { result = await estimateSource.sample(request); } catch { /* Prepare a missing frame/window below. */ }
  if (current !== generation || lifecycle.signal.aborted) return false;
  const show = result => {
    // Commit the visible clock, selected day, slider and scene in one turn.
    displaySnapshot(result, selected, requested, name, true);
    scrubber.seek(instantUtc, { notify: false });
  };
  if (result) { show(result); return true; }
  try {
    await estimateSource.load(request, emission => {
      if (current !== generation || lifecycle.signal.aborted) return;
      show(productSnapshot(emission.data, instantUtc));
      scrubber.setForecastDays(emission.data.index.days, emission.quality);
      quickPanel.show(emission, instantUtc);
    });
  } catch (error) {
    if (current === generation) quickPanel.error(error.message);
    return false;
  }
  return current === generation && accepted?.instantUtc === instantUtc;
}

function configureScrubber(initialUtc, rangeDays = 30, windowStartUtc) {
  playback.pause();
  scrubber?.dispose();
  scrubber = createDateScrubber($('#date-scrubber'), {
    startUtc: estimateMode ? new Date(QUICK_RANGE.start).toISOString() : '2026-12-01T00:00:00Z',
    endUtc: estimateMode ? new Date(QUICK_RANGE.end).toISOString() : '2027-12-01T00:00:00Z', initialUtc, rangeDays, windowStartUtc, fromSelection: estimateMode || Boolean(travelTrip), preferRangeDays: Boolean(travelTrip),
    onChange: () => {
      playback.pause();
      quickPanel?.setDate(scrubber.instantUtc);
      ++generation;
      controller?.abort(); if (!estimateMode) estimateSource.cancel();
      $('#error').textContent = ''; $('#retry').hidden = true;
      $('#observer-play').disabled = !accepted;
      // Keep the summary of the displayed snapshot until its replacement is ready.
      if (!estimateMode && selectedSiteId === 'custom') {
        clearTimeout(scrubTimer); scrubTimer = null; update();
      } else if (!scrubTimer) scrubTimer = setTimeout(() => { scrubTimer = null; update(); }, 60);
    }
  });
  scrubber.setCustomLocation(!estimateMode && selectedSiteId === 'custom');
}

document.querySelectorAll('[data-look]').forEach(button => {
  button.disabled = true;
  button.addEventListener('click', () => observer.lookToward(button.dataset.look));
});
document.querySelectorAll('[data-option]').forEach(input => input.addEventListener('change', () => observer.setOptions({ [input.dataset.option]: input.checked })));
$('#size').addEventListener('change', event => observer.setOptions({ bodySize: event.target.value }));
$('#quality').addEventListener('change', event => observer.setOptions({ quality: event.target.value }));
$('#relief').addEventListener('change', event => observer.setOptions({ verticalExaggeration: Number(event.target.value) }));
$('#day').addEventListener('pointerdown', () => playback.pause());
document.addEventListener('visibilitychange', () => { if (document.hidden) playback.pause(); }, { signal: lifecycle.signal });
$('#retry').addEventListener('click', () => { progressive.retry(); scrubber ? update() : initialize(); });
$('#star-brightness').addEventListener('input', event => observer.setOptions({ starBrightness: Number(event.target.value) }));
function showOptions(open) {
  $('#view-options').hidden = !open;
  $('#options-toggle').setAttribute('aria-expanded', String(open));
  (open ? $('#options-heading') : $('#options-toggle')).focus();
}
$('#options-toggle').addEventListener('click', () => showOptions($('#view-options').hidden));
$('#options-close').addEventListener('click', () => showOptions(false));
$('#horizon-toggle').addEventListener('click', () => {
  horizonLineVisible = !horizonLineVisible;
  $('#horizon-toggle').setAttribute('aria-pressed', String(horizonLineVisible));
  observer.setOptions({ horizonLine: horizonLineVisible });
});
const cinematic = createCinematicMode({
  button: $('#ui-toggle'), root: document.body,
  controls: [$('.location-globe'), $('#date-scrubber'), $('#ui-toggle')],
  playbackBar: $('#date-scrubber'),
  onChange: active => observer.setOptions({ horizonLine: !active && horizonLineVisible }),
  beforeEnter: () => { if (!$('#view-options').hidden) showOptions(false); }
});
window.addEventListener('pagehide', () => cinematic.dispose(), { once: true });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#view-options').hidden) { event.preventDefault(); showOptions(false); }
});
async function initialize() {
  $('#error').textContent = ''; $('#retry').hidden = true;
  forecastStatus.set('Loading site catalog and checking the local science service…', true);
  try {
    try {
      const info = await localServiceInfo(lifecycle.signal);
      serviceAvailable = info.service === 'tanaw-observer';
      windowSupported = serviceAvailable && info.observerWindow?.durationDays === 30;
    } catch { serviceAvailable = false; windowSupported = false; }
    const response = await fetch(new URL('../data/sites.json', import.meta.url), { signal: lifecycle.signal });
    if (!response.ok) throw new Error('Catalog unavailable');
    sites = await response.json();
    const params = new URL(location.href).searchParams;
    if (!params.has('t')) params.set('t', '2026-12-01T00:00:00Z');
    if (!params.has('site') && !params.has('lat') && !params.has('lon')) params.set('site', 'connecting-ridge');
    const route = await readObserverRoute(params, { fetcher: async () => new Response(JSON.stringify(sites)) });
    travelTrip = route.trip || null;
    const { latitudeDeg: lat, longitudeEastDeg: lon } = route.site;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) >= 90 || lon < -180 || lon > 360) throw new Error('Invalid location URL.');
    customSite = travelTrip ? { latitudeDeg: lat, longitudeEastDeg: lon } : { latitudeDeg: Number(lat.toFixed(6)), longitudeEastDeg: Number(lon.toFixed(6)) };
    if (Math.abs(customSite.latitudeDeg) >= 90) throw new Error('Choose a location away from the exact pole.');
    const saved = catalogSiteAt(sites, customSite);
    if (route.site.id && saved?.id !== route.site.id) throw new Error('Site ID and coordinates disagree.');
    selectedSiteId = saved?.id || 'custom';
    if (saved) customSite = undefined;
    estimateMode = Date.parse(route.instantUtc) % 3600000 !== 0 || (!saved && !serviceAvailable) || params.get('estimate') === '1' || route.instantUtc < '2026-12-01' || route.instantUtc >= '2027-12-01';
    if (travelTrip && Date.parse(travelTrip.endUtc) > Date.parse('2027-12-01T00:00:00Z')) estimateMode = true;
    if (route.range && (Date.parse(route.range.startUtc) < Date.parse('2026-12-01T00:00:00Z') || Date.parse(route.range.startUtc) + route.range.days * 86400000 > Date.parse('2027-12-01T00:00:00Z'))) estimateMode = true;
    quickPanel?.dispose();
    quickPanel = createQuickEstimatePanel($('#quick-estimate'), { initialUtc: route.instantUtc, compact: true,
      onCancel: () => { playback.pause(); cancelSelection(); }, onSelect: utc => {
        playback.pause();
        const range = scrubber?.state.rangeDays ?? 30;
        cancelSelection(); estimateMode = true; configureScrubber(utc, range); update();
      }
    });
    configureScrubber(route.instantUtc, route.range?.days ?? (travelTrip ? Math.ceil(travelTrip.durationDays) : 30), route.range?.startUtc);
    if (travelTrip) {
      const note = document.createElement('p'); note.className = 'observer-message';
      note.textContent = `Travel stay: ${travelTrip.startUtc.slice(0, 16).replace('T', ' ')} to ${travelTrip.endUtc.slice(0, 16).replace('T', ' ')} UTC. Scene visibility is not landing qualification.`;
      $('#date-scrubber').before(note);
    }
    $('#day').disabled = false;
    await update();
  } catch (error) {
    if (lifecycle.signal.aborted) return;
    forecastStatus.set('Forecast unavailable. No observation displayed.'); $('#error').textContent = error.message; $('#retry').hidden = false;
  }
}
window.addEventListener('pagehide', () => { ++generation; clearTimeout(scrubTimer); clearTimeout(feedbackTimer); lifecycle.abort(); playback.dispose(); controller?.abort(); quickPanel?.dispose(); scrubber?.dispose(); estimateSource.dispose(); estimateTerrain.dispose(); progressive.stop(); provider.dispose(); locationGlobe.dispose(); observer.dispose(); }, { once: true });
initialize();
