import { createForecastSource } from './forecast-source.js';
import { COMPARE_METRICS, compareSites, rankBy } from './compare/data.js';
import { createQuickEstimatePanel } from './observer/quick-estimate.js';
import { productMoonDirections, productSnapshot } from './computation/dist/forecast-product.js';
import { publishedGeometry } from './computation/dist/published-geometry.js';
import { parseUtc } from './computation/dist/core.js';
import { QUICK_RANGE } from './computation/dist/quick/coverage.js';
import { createDateWindow } from './observer/date-scrubber.js';
import { createTravelPanel } from './travel/panel.js';
import { createComparePanel } from './compare/panel.js';
import { createRangePicker, rangeDayCount } from './observer/range-picker.js';

let travel = null, comparison = null, compareCandidate = false, rangePicker, travelTrip = null, cinematic = false, cinematicTransition;

// Forecast readout: reads the precomputed forecasts in data/ (see science/FORECAST.md) and
// draws the planning bar, the sky clock, the times, the site comparison and the site picker.
// All times are UTC.

const NEEDS = { sunHours: 18, earthHours: 8 }; // example mission: change for your own
const RING_DAYS = 30; // the sky clock shows this many days around the planned day
const DEFAULT_SITE = "connecting-ridge";
const OBSERVER_ENTRY = true; // observer/ receives the selected catalog coordinates and UTC
const SUN_CENTRE = true; // the Sun-centred diagram needs data/orbit*.json
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Field names per body. Visibility and rise/set events come precomputed from the pipeline.
const BODIES = {
  sun: { az: "sunAz", el: "sunEl", visible: "sunVisible", next: "nextSunEvent", rise: "Sunrise in", set: "Sunset in" },
  earth: { az: "earthAz", el: "earthEl", visible: "earthVisible", next: "nextEarthEvent", rise: "Earthrise in", set: "Earthset in" },
};

const sunOk = (day) => day.sunHours >= NEEDS.sunHours;
const earthOk = (day) => day.earthHours >= NEEDS.earthHours;
const isGo = (day) => sunOk(day) && earthOk(day);

// Why a day is No-go, in a short phrase ("" for a Go day).
function reason(day) {
  const sun = Math.round(day.sunHours), earth = Math.round(day.earthHours);
  const parts = [];
  if (!sunOk(day)) parts.push(sun === 0 ? `Sun down all day, needs ${NEEDS.sunHours} h` : `Sun up ${sun} h, needs ${NEEDS.sunHours} h`);
  if (!earthOk(day)) parts.push(earth === 0 ? `Earth hidden all day, needs ${NEEDS.earthHours} h` : `Earth in view ${earth} h, needs ${NEEDS.earthHours} h`);
  return parts.join(" and ");
}

// The call's reason on any day: what was seen on a Go day, what falls short on a No-go day.
function why(day) {
  return isGo(day) ? `Sun up ${Math.round(day.sunHours)} h, Earth in view ${Math.round(day.earthHours)} h` : reason(day);
}

// Planning: the first Go day after day i, up to the end of the data (-1 when there is none).
function nextGo(days, i) {
  for (let j = i + 1; j < days.length; j++) if (isGo(days[j])) return j;
  return -1;
}

// The run of Go days from day i, counted across all the data: "15 days", or "15+ days" when
// the run reaches the end of the data.
function goRun(days, i) {
  let j = i;
  while (j < days.length && isGo(days[j])) j++;
  const n = j - i, open = j === days.length;
  return `${n}${open ? "+" : ""} ${n === 1 && !open ? "day" : "days"}`;
}

// The listed sites with a published forecast (not coordinates entered in the picker).
const listed = () => state.sites.filter((s) => state.data[s.id]);

// The sites that are Go on day i, in sites.json order.
function sitesGoOn(i) {
  return listed().filter((s) => isGo(state.data[s.id].forecast.days[i]));
}

// The day's next rise or set from its 00:00 UTC, as a label and the time to it in ms
// (null when there is none before the data ends).
function nextEvent(day, body) {
  const b = BODIES[body], next = day[b.next];
  if (!next) return { label: day[`${body}UpAt0`] ? b.set : b.rise, ms: null };
  return { label: b[next.kind], ms: Date.parse(next.at) - Date.parse(`${day.date}T00:00:00Z`) };
}

// "2 d 6 h", "6 h 14 m"; with no event, "before 1 Dec 2027" (end: the data's last instant),
// under a label that says so ("No earthset", countdownLabel). A count never breaks across
// lines (no-break spaces); the "before" text may wrap.
function countdownLabel(next) {
  return next.ms === null ? `No ${next.label.replace(/ in$/, "").toLowerCase()}` : next.label; // "Earthset in" → "No earthset"
}
function duration(ms, end) {
  if (ms === null) return `before ${siteDate(end.slice(0, 10))}`;
  const min = Math.floor(ms / 60000), d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  const text = d ? `${d} d ${h} h` : h ? `${h} h ${m} m` : `${m} m`;
  return text.replaceAll(" ", "\u00a0");
}

// "Tue 1 Dec 2026" from "2026-12-01"; without the year, "Tue 1 Dec".
// Built by hand, so the month names match the Compare axis in every browser.
function dateLabel(date, year = true) {
  const d = new Date(date + "T00:00:00Z");
  const label = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return year ? `${label} ${d.getUTCFullYear()}` : label;
}

// Page

const SVG_NS = "http://www.w3.org/2000/svg";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

const $ = (id) => document.getElementById(id);
const hud = document.querySelector(".hud");
const topbar = document.querySelector(".topbar");
const bar = document.querySelector(".bar");
const plan = $("plan");

// While the loading cover shows (#status has text; globe.js empties it once the Moon is in),
// everything else on the stage is inert, so Tab can't reach the controls hidden under it.
const statusEl = $("status");
function coverInert() {
  const covering = statusEl.textContent.trim() !== "";
  for (const n of statusEl.parentElement.children) if (n !== statusEl) n.inert = covering;
}
new MutationObserver(coverInert).observe(statusEl, { childList: true, characterData: true, subtree: true });
coverInert();
const call = $("call");
const wait = $("wait");
const move = $("move");
const times = $("times");
const compare = $("compare");
const rangeBtn = $("range-btn");
const ring = $("ring");
// Wide screens: the clock's column and the site panel scroll inside themselves with no visible
// scrollbar; .more fades the bottom edge while more of it is below the fold.
function fadeWhileMore(box) {
  const more = () => box.classList.toggle("more", box.scrollHeight - box.clientHeight - box.scrollTop > 2);
  box.addEventListener("scroll", more, { passive: true });
  new ResizeObserver(more).observe(box);
  // Content changes, not the sky clock's and strip's redraws (SVG), which never change its height.
  new MutationObserver((records) => { if (records.some((r) => !(r.target instanceof SVGElement))) requestAnimationFrame(more); })
    .observe(box, { childList: true, subtree: true });
}
fadeWhileMore(ring);
fadeWhileMore($("panel"));
const clock = $("clock");
const side = $("side");
const goList = $("go-list");
const nowName = $("now-name");
// The site name: one line at 16 px, shrinking to no less than 14 px to fit; a longer name
// wraps to two lines, at 15 px down to 12 px ("Connecting Ridge / Extension").
function fitSiteName() {
  nowName.classList.remove("two");
  nowName.style.fontSize = "16px";
  const width = nowName.clientWidth;
  if (!width || !nowName.textContent) return;
  // Rounded down to 0.1 px, 1 px inside the box, so the last letter never falls to an ellipsis.
  const one = Math.min(16, Math.floor(160 * (width - 1) / nowName.scrollWidth) / 10);
  if (one >= 14) { nowName.style.fontSize = `${one}px`; return; }
  nowName.classList.add("two");
  for (let size = 15; size >= 12; size--) {
    nowName.style.fontSize = `${size}px`;
    if (nowName.scrollWidth <= width && nowName.scrollHeight <= nowName.parentElement.clientHeight) break;
  }
}
const selectorSize = new ResizeObserver(fitSiteName);
selectorSize.observe(nowName.parentElement);
document.fonts.ready.then(fitSiteName);
let siteNameDirection = 1, siteNameAnimations = [];
function showSiteName(name) {
  if (nowName.textContent === name) return;
  const previous = nowName.textContent, button = nowName.parentElement;
  siteNameAnimations.forEach(animation => animation.cancel());
  button.querySelector('.now-name-out')?.remove();
  const outgoing = nowName.cloneNode();
  nowName.textContent = name; fitSiteName(); requestAnimationFrame(fitSiteName); // again once laid out (after the picker closes)
  button.title = name; button.setAttribute('aria-label', name);
  if (!previous) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const distance = reduced ? 0 : 14 * siteNameDirection;
  outgoing.removeAttribute('id');
  outgoing.classList.add('now-name-out'); outgoing.setAttribute('aria-hidden','true'); outgoing.textContent = previous;
  button.append(outgoing);
  const exit = outgoing.animate([{opacity:1,transform:'translateX(0)'},{opacity:0,transform:`translateX(${-distance}px)`}],
    {duration:reduced?80:110,easing:'ease-in',fill:'forwards'});
  const enter = nowName.animate([{opacity:0,transform:`translateX(${distance}px)`},{opacity:1,transform:'translateX(0)'}],
    {duration:reduced?100:220,delay:reduced?0:70,easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'});
  siteNameAnimations = [exit,enter];
  exit.finished.then(()=>outgoing.remove()).catch(()=>{});
}

const slider = $("day");
const dayOut = $("day-out");
// While the timeline is dragged, a small time bubble rides on the playhead: the day the thumb
// is on (fixed position, so no container clips it). Hidden from screen readers: the slider's own
// value text says the same.
const bubble = document.createElement("output");
bubble.className = "play-bubble";
bubble.setAttribute("aria-hidden", "true");
bubble.hidden = true;
document.body.append(bubble);
function showBubble() {
  if (!slider.matches(":active")) return;
  const utc = quickMode && quickWindow ? quickWindow.state.instantUtc : state.data[state.site] ? instant() : null;
  if (!utc) return;
  bubble.textContent = `${dateLabel(utc.slice(0, 10), false)} · ${utc.slice(11, 16)}`;
  bubble.hidden = false;
  const r = slider.getBoundingClientRect(), min = Number(slider.min), max = Number(slider.max) || 1, thumb = 16;
  const x = r.left + thumb / 2 + (Number(slider.value) - min) / (max - min || 1) * (r.width - thumb);
  bubble.style.transform = `translate(${Math.round(Math.min(innerWidth - bubble.offsetWidth / 2 - 8, Math.max(bubble.offsetWidth / 2 + 8, x)))}px, ${Math.round(r.top - 8)}px) translate(-50%, -100%)`;
}
// The site header (wider screens): the site switch, the date and the call, read as one header at
// the top of the left column, above the sky clock; phones keep them in the bar, near the thumb.
const siteHead = $("site-head"), siteSwitch = document.querySelector("#plan .switch");
const playBtn = $("play");
const timesBtn = $("times-btn");
const infoBtn = $("info-btn");
const compareBtn = $("compare-btn");
const now = $("now");
const picker = $("picker");
const pickerBody = $("picker-body");
const pickerSub = $("picker-sub");
const pickerHeading = $("picker-heading");
const pickerBack = $("picker-back");
const resetBtn = $("reset");
const viewMenu = $("view-menu");
const view3d = $("view-3d");
const panel = $("panel");
const panelId = $("panel-id");
const panelMore = $("panel-more");
const spotsBox = $("panel-spots");

// day: the planned day (index into days[]); ws and len: the visible window of days, which the
// slider, the lanes and Compare show. focus: a site has been picked by the user (off on load
// and after "Whole Moon"); it opens the site panel. view: "globe", or "site" for the terrain
// around the focused site (site.js), which needs a tile in tiles: data/terrain/index.json for the
// polar sites, and the observer's catalogue tiles (the same format) for the others.
// lit: the selected site's lit hour on the planned day, once its sky has loaded.
// grids: data/grid/index.json, the sites with nearby spots. spot: the selected nearby spot
// (i east, j north, in grid steps; 0, 0 is the site itself), back to the site's own spot on
// a change of site or on leaving the site view.
// hour: null for the default instant (the globe at the planned day's 00:00 UTC, the site view
// at the lit hour), or 0 to 23, an hour of the planned day set by autoplay. The current
// instant is the planned day plus that hour; every time-dependent view shows it.
const state = { sites: [], data: {}, site: "", day: 0, ws: 0, len: 30, focus: false, view: "globe", tiles: {}, lit: null, hour: null,
  grids: { sites: {} }, spot: { site: "", i: 0, j: 0 } };
let moreBtn = null;
call.append(el("span", "note", "Loading forecasts"));

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

// Every site's daily forecast and horizon up front. A site whose files don't load is left out.
async function load() {
  const [all, terrain, catalog, grids] = await Promise.all([
    getJSON("data/sites.json"),
    getJSON("data/terrain/index.json").catch(() => ({ sites: {} })), // no tiles: globe only
    getJSON("assets/observer/terrain/catalog/index.json").catch(() => ({ sites: {} })),
    getJSON("data/grid/index.json").catch(() => ({ sites: {} })), // no grids: no nearby spots
  ]);
  state.tiles = { ...terrain.sites };
  for (const [id, entry] of Object.entries(catalog.sites || {})) {
    if (!state.tiles[id]) state.tiles[id] = { ...entry, url: `assets/observer/terrain/catalog/${entry.file}` };
  }
  state.grids = grids;
  // Every site's forecast loads, also for estimate links: changing site, the picker and the
  // published view all need them (initializeQuick still opens estimate mode from the link).
  const files = await Promise.all(all.map((s) =>
    Promise.all([getJSON(`data/forecast/${s.id}.json`), getJSON(`data/horizons/${s.id}.json`)]).catch(() => null)));
  const skipped = all.filter((s, i) => !files[i]).map((s) => s.id);
  if (skipped.length) console.warn(`Skipped sites whose forecast or horizon didn't load: ${skipped.join(", ")}`);
  const sites = all.filter((s, i) => files[i]);
  if (!sites.length) throw new Error("No site's forecast loaded");
  sites.forEach((s) => { const [forecast, horizon] = files[all.indexOf(s)]; state.data[s.id] = { forecast, horizon }; });
  // Every catalogue site has a photo at assets/sites/<id>.webp unless sites.json names another.
  sites.forEach((s) => { s.image ??= `assets/sites/${s.id}.webp`; });
  state.sites = sites;
  state.site = sites.some((s) => s.id === DEFAULT_SITE) ? DEFAULT_SITE : sites[0].id;
}

// Hourly sky, one file per site and month, loaded when the sky clock first needs it.
const skyMonths = new Map(); // "id/YYYY-MM" → Promise of that month's file
const skyLoaded = new Map(); // the same files once loaded, for smooth autoplay (smoothAt)
function skyMonth(id, month) {
  const key = `${id}/${month}`;
  if (!skyMonths.has(key)) {
    const file = getJSON(`data/forecast/${key}.json`);
    file.then((f) => skyLoaded.set(key, f), () => skyMonths.delete(key)); // try again next time
    skyMonths.set(key, file);
  }
  return skyMonths.get(key);
}

function fail(err) {
  console.error(err);
  call.replaceChildren(el("span", "error", "Couldn't load the forecasts. Reload to try again."));
  clock.replaceChildren();
  side.replaceChildren();
}

// A lane over the window's days as one background: each run of days that meet ok() is a bar in
// the colour, the rest transparent. "none" when no day meets it.
function runs(days, ok, colour) {
  const pct = (i) => `${(i / days.length * 100).toFixed(3)}%`;
  const stops = [];
  for (let i = 0; i < days.length;) {
    if (!ok(days[i])) { i++; continue; }
    let j = i;
    while (j < days.length && ok(days[j])) j++;
    stops.push(`transparent ${pct(i)}, ${colour} ${pct(i)}, ${colour} ${pct(j)}, transparent ${pct(j)}`);
    i = j;
  }
  return stops.length ? `linear-gradient(to right, ${stops.join(", ")})` : "none";
}

// The selected site's Go days painted on the slider track: day i's segment is centred under
// the thumb centre at value i, which travels from thumb/2 to 100% - thumb/2 in n - 1 steps.
function goTrack(days) {
  const n = days.length;
  const at = (x) => `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${x} / ${n - 1})`;
  const stops = [];
  let from = 0;
  for (let i = 1; i <= n; i++) {
    if (i < n && isGo(days[i]) === isGo(days[from])) continue;
    const colour = isGo(days[from]) ? "var(--text)" : "var(--line)";
    stops.push(`${colour} ${from === 0 ? "0%" : at(from - 0.5)} ${i === n ? "100%" : at(i - 0.5)}`);
    from = i;
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

// One site's lanes, slider track and counts over the current window, cached per window.
const laneCache = new Map(); // "id:ws:len" → { s, e, g, track, go, sun, earth }
function lanes(id) {
  const key = `${id}:${state.ws}:${state.len}`;
  if (!laneCache.has(key)) {
    const days = state.data[id].forecast.days.slice(state.ws, state.ws + state.len);
    const count = (ok) => days.filter(ok).length;
    laneCache.set(key, {
      s: runs(days, sunOk, "var(--sun)"),
      e: runs(days, earthOk, "var(--earth)"),
      g: runs(days, isGo, "var(--text)"),
      track: goTrack(days),
      go: count(isGo), sun: count(sunOk), earth: count(earthOk),
    });
  }
  return laneCache.get(key);
}

// The window holds the planned day. When the day leaves it, or the range changes (force), it
// moves so the day sits a third of the way in.
function fitWindow(force) {
  const n = state.data[state.site].forecast.days.length;
  if (!force && state.day >= state.ws && state.day < state.ws + state.len) return;
  state.ws = Math.max(0, Math.min(state.day - Math.floor(state.len / 3), n - state.len));
}

// Every user selection comes through here: it focuses the site (the site panel opens), and a
// site with a terrain tile opens in the site view.
function select(id) {
  if (!comparison?.fromTravel) travel?.close();
  travelTrip = null;
  pause();
  const fromTyped = !state.data[state.site]; // leaving coordinates typed in the picker
  state.site = id;
  state.focus = true;
  selectedForCompare();
  // From a typed place to a listed site on a published whole hour: the normal view again,
  // as after the date picker's in-year Confirm.
  if (quickMode && fromTyped && state.data[id]) {
    const utc = quickEmission?.selection.instantUtc ?? quickUtc;
    if (publishedDate(utc) && Date.parse(utc) % 3600000 === 0) { leaveQuick(utc, comparison?.active ? compareWindow() : null); return; }
  }
  fpOpen = fpChoice ?? (!phone.matches && innerHeight >= FP_TALL); // the forecast panel, by choice or by room
  state.view = !comparison?.active && state.tiles[id] ? "site" : "globe"; // a typed or clicked point has no tile
  if (quickMode) { loadQuick(quickUtc, !!comparison?.active && !!quickWindow); return; }
  render();
}

function setRange(len) {
  pause();
  travelTrip = null;
  state.len = len;
  if (quickMode) { quickWindow.range(len); loadQuick(quickWindow.state.instantUtc, true); return; }
  state.hour = null;
  fitWindow(true);
  render();
}

function start() {
  slider.min = 0;
  // Dragging or a key pauses autoplay and snaps to whole days, back at the default instant.
  slider.addEventListener("pointerdown", () => { leaveLive(); pause(); showBubble(); });
  for (const end of ["pointerup", "pointercancel", "blur"]) slider.addEventListener(end, () => { bubble.hidden = true; });
  slider.addEventListener("keydown", (e) => {
    if (SLIDER_KEYS.includes(e.key)) leaveLive();
    if (quickMode) return;
    if (!SLIDER_KEYS.includes(e.key) || state.hour === null) return;
    pause();
    slider.step = "1";
    slider.value = state.day - state.ws;
  });
  slider.addEventListener("input", () => {
    leaveLive();
    pause();
    requestAnimationFrame(showBubble); // after the day has moved
    if (quickMode) { quickWindow.select(Number(slider.value)); loadQuick(quickWindow.state.instantUtc, true); return; }
    state.day = state.ws + Math.round(Number(slider.value));
    state.hour = null;
    render();
  });
  playBtn.addEventListener("click", () => (play.on ? pause() : startPlay()));
  rangePicker = createRangePicker(rangeBtn, { onChange(amount, unit) {
    const utc = quickMode ? quickWindow.state.instantUtc : `${state.data[state.site].forecast.days[state.day].date}T00:00:00Z`;
    setRange(rangeDayCount(amount, unit, utc));
  } });
  window.addEventListener('pagehide', () => rangePicker.dispose(), { once: true });

  initializeQuick();
  if (!quickMode) render();
  frame();
  prefetchMonths();
}

// Each site's month of hourly sky for the planned day, fetched one site at a time while the
// page is idle, so a site's first click doesn't wait for it. Skipped on Save-Data and slow links.
function prefetchMonths() {
  const link = navigator.connection;
  if (link?.saveData || /(^|-)(2g|3g)$/.test(link?.effectiveType || "")) return;
  const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 5000 }) : setTimeout(fn, 1000));
  const queue = state.sites.filter((s) => state.data[s.id] && s.id !== state.site).map((s) => s.id);
  const next = () => {
    const id = queue.shift();
    if (!id || quickMode) return;
    const day = state.data[id].forecast.days[state.day];
    if (!day) return idle(next);
    skyMonth(id, day.date.slice(0, 7)).catch(() => {}).finally(() => idle(next));
  };
  // Start only once the loading cover has cleared, so it never competes with the Moon maps.
  if (!statusEl.textContent.trim()) return idle(next);
  const cleared = new MutationObserver(() => {
    if (statusEl.textContent.trim()) return;
    cleared.disconnect();
    idle(next);
  });
  cleared.observe(statusEl, { childList: true, characterData: true, subtree: true });
}

function render() {
  sendTrack();
  if (quickMode) { renderQuick(); return; }
  fitWindow(false);
  const { forecast, horizon } = state.data[state.site];
  const site = state.sites.find((s) => s.id === state.site);
  const days = forecast.days;
  const day = days[state.day];
  const utc = instant();
  times.dataset.quality = sem.dataset.quality = 'accurate';
  times.dataset.instant = sem.dataset.instant = utc;
  times.setAttribute('aria-label', `Rise and set times · Accurate forecast · ${utc}`);
  $('moon').setAttribute('aria-label', `Moon viewer · Accurate forecast · ${utc}`);
  const sunCentre = semCentreBtns.find(b => b.dataset.centre === 'sun');
  sunCentre.disabled = false; sunCentre.title = '';
  const label = dateLabel(day.date);
  const inSite = state.view === "site";
  const viewChanged = inSite !== hud.classList.contains("site");
  hud.classList.toggle("site", inSite);
  view3d.hidden = !inSite;
  $("show-spots").hidden = !state.grids.sites[state.site]; // nearby spots only where there is a grid
  hud.classList.toggle("hour", state.hour !== null);
  // "Whole Moon" ends focus (wholeMoon); otherwise "View" opens the view menu (globe.js).
  resetBtn.classList.toggle("whole", state.focus);
  resetBtn.setAttribute("aria-label", resetBtn.dataset.tip = state.focus ? "Whole Moon" : "View");
  if (state.focus) {
    if (viewMenu.matches(":popover-open")) viewMenu.hidePopover();
    for (const name of ["popovertarget", "aria-haspopup", "aria-expanded"]) resetBtn.removeAttribute(name);
  } else if (!resetBtn.hasAttribute("aria-haspopup")) {
    resetBtn.setAttribute("popovertarget", "view-menu");
    resetBtn.setAttribute("aria-haspopup", "menu");
    resetBtn.setAttribute("aria-expanded", "false");
  }
  showDay(label);
  slider.max = state.len - 1;
  placeThumb();
  slider.style.setProperty("--go-track", lanes(state.site).track);
  showSiteName(site.name);

  semBtn.hidden = inSite;
  semBox.hidden = !inSite;
  (inSite ? semBox : semBtn).append(semSvg);
  renderCall(days);
  renderTimes(day, forecast);
  comparison?.sync();
  renderPanel(site);
  renderForecastPanel();
  if (state.spot.site !== state.site || !inSite) state.spot = { site: state.site, i: 0, j: 0 };
  renderSpots();
  layout();
  if (viewChanged) frame(); // the 3D view's row of buttons comes or goes under the band

  // Tell the globe the selected site and day, so its pins and sunlight match (globe.js).
  // view and tile tell the site view whether to show this site's terrain (site.js); focus
  // tells the globe that the top bar's button ends focus rather than resetting the view.
  document.dispatchEvent(new CustomEvent("tanaw:select", { detail: {
    site: state.site, sites: state.sites, date: day.date, instant: instant(), focus: state.focus, view: state.view,
    tile: state.tiles[state.site] || null, terrain: Object.keys(state.tiles),
  } }));
  sendSpot();

  renderRing(forecast, horizon);
  quickPanel?.setDate(shownUtc(instant())); // the date field follows the slider
}

// The planned date, with the hour ("…, 05:00 UTC") while autoplay has set one, and in the
// site view with the lit hour once it is known. On phones the date with an hour drops the
// weekday and year ("13 Dec, 13:00 UTC"); the slider's value text keeps the full form.
let dayLabel = "";
function showDay(label) {
  dayLabel = label;
  const lit = state.lit;
  const hour = state.hour !== null ? String(state.hour).padStart(2, "0")
    : state.view === "site" && lit && lit.site === state.site && lit.day === state.day ? lit.hour.slice(11, 13) : null;
  const text = hour === null ? label : `${label}, ${hour}:00 UTC`;
  dayOut.textContent = hour !== null && phone.matches ? `${label.split(" ").slice(1, 3).join(" ")}, ${hour}:00 UTC` : text;
  quickPanel?.setDate(shownUtc(instant()));
  slider.setAttribute("aria-valuetext", text);
}

// An estimate's instant: the autoplay hour while playing, else the engine's own instant.
function quickNow() {
  if (quickPlay.hour >= 0) return new Date(quickPlay.t0 + quickPlay.hour * 3600000).toISOString();
  return quickEmission?.selection.instantUtc;
}
// The globe's instant as an ISO time: the planned day's 00:00 UTC plus the autoplay hour.
function instant() {
  if (quickMode) return quickNow() ?? quickUtc;
  const date = state.data[state.site].forecast.days[state.day].date;
  return new Date(Date.parse(`${date}T00:00:00Z`) + (state.hour ?? 0) * 3600000).toISOString();
}

// The slider thumb at the current instant: whole days, or hour by hour (step "any") while
// autoplay has set an hour. The last day's hours sit at the end of the track.
function placeThumb() {
  slider.step = state.hour === null ? "1" : "any";
  slider.value = state.day - state.ws + (state.hour ?? 0) / 24;
}

// A chip: a button with a muted prefix ("Wait:", "Move:") and its text.
function chip(prefix, text, onClick) {
  const b = el("button", "btn chip");
  b.type = "button";
  b.append(el("span", "pre", `${prefix} `), text);
  b.addEventListener("click", onClick);
  return b;
}

// The call, why, and the two ways round a No-go day: wait for the next Go day, or move to a
// site that is Go on this one.
function renderCall(days) {
  const day = days[state.day], go = isGo(day);
  const dot = el("span", go ? "dot" : "dot no");
  dot.setAttribute("aria-hidden", "true");
  call.replaceChildren(dot, el("span", "verdict", go ? "Go" : "No-go"), el("span", "why", ` · ${why(day)}`));

  moreBtn = null;
  if (go) {
    wait.replaceChildren(el("span", "plain", `Go for ${goRun(days, state.day)}`));
    move.replaceChildren();
    return;
  }

  const j = nextGo(days, state.day);
  wait.replaceChildren(j < 0
    ? el("span", "plain muted", `Not Go by ${dateLabel(days[days.length - 1].date)}`)
    : chip("Wait:", `${dateLabel(days[j].date, false)}, +${j - state.day} d · Go ${goRun(days, j)}`, () => {
      leaveLive();
      pause();
      state.day = j;
      state.hour = null;
      render();
    }));

  const others = sitesGoOn(state.day).filter((s) => s.id !== state.site);
  if (!others.length) {
    move.replaceChildren(el("span", "plain muted", "No site Go on this date"));
    return;
  }
  const first = chip("Move:", others[0].name, () => select(others[0].id));
  if (others.length === 1) {
    move.replaceChildren(first);
    return;
  }
  moreBtn = el("button", "btn", `+${others.length - 1} more`);
  moreBtn.type = "button";
  moreBtn.setAttribute("popovertarget", "go-list");
  move.replaceChildren(first, moreBtn);
  goList.replaceChildren(...others.map((s) => {
    const b = el("button", "btn", s.name);
    b.type = "button";
    b.addEventListener("click", () => {
      goList.hidePopover();
      select(s.id);
    });
    return b;
  }));
}

// The list of Go sites opens just above "+N more", kept on screen.
goList.addEventListener("beforetoggle", (e) => {
  if (e.newState !== "open" || !moreBtn) return;
  const r = moreBtn.getBoundingClientRect();
  Object.assign(goList.style, {
    left: `${Math.max(8, r.left)}px`,
    bottom: `${innerHeight - r.top + 8}px`,
    maxHeight: `${Math.max(120, r.top - 16)}px`,
  });
});
goList.addEventListener("toggle", (e) => {
  if (e.newState !== "open") return;
  const r = goList.getBoundingClientRect();
  if (r.right > innerWidth - 8) goList.style.left = `${Math.max(8, innerWidth - 8 - r.width)}px`;
});

function renderTimes(day, forecast) {
  const count = (body) => {
    let next = nextEvent(day, body);
    if (quickMode) {
      const at = Date.parse(quickNow()), b = BODIES[body];
      const events = forecast.days.flatMap(d => ['rise', 'set'].flatMap(kind =>
        d[`${body}${kind}`].map(time => ({ kind, at: Date.parse(time) }))));
      const event = events.filter(e => e.at > at).sort((a, b) => a.at - b.at)[0];
      next = event ? { label: b[event.kind], ms: event.at - at }
        : { label: productSnapshot(quickEmission.data, quickNow()).bodies[body].centerVisible ? b.set : b.rise, ms: null };
    }
    const box = el("div");
    box.append(el("span", "k", countdownLabel(next)), el("span", `v ${body}`, duration(next.ms, forecast.window.end)));
    return box;
  };
  const height = (body, label) => {
    const box = el("div");
    heights[body] = el("span", `v ${body}`);
    box.append(el("span", "k", label), heights[body]);
    return box;
  };
  const counts = el("div", "counts");
  counts.append(count("sun"), count("earth"), height("sun", "Sun above level"), height("earth", "Earth above level"));
  times.replaceChildren(atLine, counts, ...(sem.parentElement === times ? [sem] : []));
  showHeights();
}

// The Sun's and Earth's height over the shown dates, from the sky clock's month files, for the
// forecast panel's chart: hourly at 30 days or less, otherwise each UTC day's highest hourly
// value, and the day counts as seen if any hour was (a display choice).
function chartSeries(files, dates) {
  const s = { days: dates, hourly: dates.length <= 31, t: [], sun: [], earth: [], sunSeen: [], earthSeen: [] };
  const step = s.hourly ? 1 : 24;
  for (let i = 0; i < dates.length * 24; i += step) {
    const date = dates[Math.floor(i / 24)], file = files.find(f => f?.start.slice(0, 7) === date.slice(0, 7));
    const at = file ? (Date.parse(`${date}T00:00:00Z`) - Date.parse(file.start)) / 3600000 + i % 24 : 0;
    const hours = f => file ? file[f].slice(at, at + step) : [];
    s.t.push(s.hourly ? i : i + 12);
    s.sun.push(Math.max(...hours("sunEl")));
    s.earth.push(Math.max(...hours("earthEl")));
    s.sunSeen.push(hours("sunVisible").some(Boolean) ? 1 : 0);
    s.earthSeen.push(hours("earthVisible").some(Boolean) ? 1 : 0);
  }
  return s;
}

// "At <site>" above the countdowns while the site view's pin is on a nearby spot, since the
// countdowns and heights are the site's own.
const atLine = el("p", "at");
function showAt() {
  const { site, i, j } = state.spot;
  atLine.hidden = !(state.view === "site" && site === state.site && (i || j));
  atLine.textContent = `At ${state.sites.find((s) => s.id === state.site).name}`;
}

// The Sun's and Earth's published elevations above the level horizon at the current instant:
// the autoplay hour, else the lit hour in the site view, else the planned day's 00:00 UTC.
// "–" until the day's month file has loaded.
const heights = {};
function showHeights() {
  if (quickMode) {
    if (!quickEmission) return;
    const snapshot = productSnapshot(quickEmission.data, quickNow());
    for (const body of ['sun', 'earth']) {
      const e = Math.round(snapshot.bodies[body].elevationDeg * 10) / 10;
      if (heights[body]) heights[body].textContent = `${e < 0 ? '−' : ''}${Math.abs(e).toFixed(1)}°`;
    }
    updatePointSky();
    return;
  }
  const ready = sky && sky.site === state.site && sky.day === state.day;
  const i = !ready ? null : state.hour !== null ? sky.dayStart + state.hour
    : state.view === "site" ? sky.lit : sky.dayStart;
  for (const body of ["sun", "earth"]) {
    const e = i === null ? null : Math.round(sky.h[BODIES[body].el][i] * 10) / 10;
    heights[body].textContent = e === null ? "–" : `${e < 0 ? "−" : ""}${Math.abs(e).toFixed(1)}°`;
  }
}

// Keep comparison locations independent from the host's current candidate.
function compareWindow() {
  if (quickMode && quickWindow) return { startUtc: quickWindow.state.startUtc.slice(0, 10) + 'T00:00:00Z', days: quickWindow.state.length };
  // A newly clicked custom point inherits the published window before its estimate loads.
  const forecast = (state.data[state.site] || Object.values(state.data)[0]).forecast;
  return { startUtc: forecast.days[state.ws].date + 'T00:00:00Z', days: state.len };
}
function syncCompareAction() {
  const button = $('panel-compare');
  const point = state.sites.find(s => s.id === state.site);
  if (!button || !point) return;
  const active = comparison?.active;
  button.textContent = active ? comparison.action(point) : 'Compare';
  button.disabled = active && button.textContent !== 'Add site';
  button.setAttribute('aria-expanded', String(!!active));
}
function comparisonChanged() {
  if (comparison.picking) { compareCandidate = false; sheet = false; }
  hud.classList.toggle('compare-picking', comparison.picking);
  syncCompareAction(); travel?.syncComparison(); layout(); frame();
}
function selectedForCompare() {
  if (!comparison?.active) return;
  if (comparison.fromTravel) {
    if (comparison.picking) { const result = travel.resultFor(travelSelection().point); if (result) comparison.add(compareTravelPoint(result.point)); }
    compareCandidate = false; sheet = false; state.focus = false; layout(); return;
  }
  compareCandidate = true;
  state.view = 'globe';
  if (comparison.picking) {
    if (comparison.add(state.sites.find(s => s.id === state.site))) compareCandidate = false;
  }
  sheet = compareCandidate && !wide.matches;
  renderPanel(state.sites.find(s => s.id === state.site));
  layout();
}

// The sky clock covers RING_DAYS days around the planned day, from the selected site's month
// files. It redraws once they have loaded; until then the previous ring stays, and a newer
// request wins over a slower older one. The span reaches at least 15 days past the planned
// day, so during autoplay the next month's file is requested well before the playhead gets
// there. sky: the loaded span for one site and day, which hour ticks read from.
let ringRequest = 0;
let sky = null; // { site, day, date, h, dayStart, lit }: h hourly arrays, dayStart and lit indices into them
// The hourly sky over RING_DAYS days round day i of a site, from its month files joined into
// one run: hour 0 of the first ring day (first) is at base. The sky clock and Compare's
// columns both draw from it.
function skySpan(id, i) {
  const days = state.data[id].forecast.days;
  const first = Math.max(0, Math.min(i - 14, days.length - RING_DAYS));
  const months = [...new Set(days.slice(first, first + RING_DAYS).map((d) => d.date.slice(0, 7)))];
  return Promise.all(months.map((m) => skyMonth(id, m))).then((files) => {
    const hourly = {};
    for (const b of Object.values(BODIES)) for (const f of [b.az, b.el, b.visible]) hourly[f] = files.flatMap((x) => x[f]);
    const base = (Date.parse(`${days[first].date}T00:00:00Z`) - Date.parse(files[0].start)) / 3600000;
    return { hourly, base, first };
  });
}

function renderRing(forecast, horizon) {
  const days = forecast.days, day = state.day, id = state.site;
  const request = ++ringRequest;
  skySpan(id, day).then(({ hourly, base, first }) => {
    if (quickMode || request !== ringRequest) return;
    // The lit hour: the planned day's first hour with the Sun in view, else 12:00 UTC. The
    // site view is lit for it at the default instant, and the clock and strip ring the Sun there.
    const dayStart = base + (day - first) * 24;
    let k = 0;
    while (k < 24 && !hourly.sunVisible[dayStart + k]) k++;
    if (k === 24) k = 12;
    const date = days[day].date;
    state.lit = { site: id, day, hour: new Date(Date.parse(`${date}T00:00:00Z`) + k * 3600000).toISOString() };
    sky = { site: id, day, date, h: hourly, dayStart, lit: dayStart + k };
    ring.dataset.quality = 'accurate'; ring.dataset.instant = instant();
    ring.querySelector('h2').textContent = 'Sky from the site';
    ring.setAttribute('aria-label', `Sky from the site · Accurate forecast · ${instant()}`);
    clock.replaceChildren(drawRing(hourly, base, first, days[day], day, horizon));
    stripArgs = [hourly, base, first, days[day], day, horizon];
    drawSide();
    showSky();
    showDay(dateLabel(date));
    observerLink();
  }, (err) => {
    if (request === ringRequest) console.error(err);
  });
}

// The sky at the current instant: the hour the site view is lit for (tanaw:sky, site.js), whether
// Earth is in view at the globe's instant (now, for globe.js's Earth & Sun view), and
// the clock and strip marks. While autoplay has set an hour, both bodies are ringed there;
// otherwise the site view rings the Sun at the lit hour, and the globe view rings nothing.
function nowMark() {
  if (quickMode) return sky?.mark ?? null;
  if (!sky || sky.site !== state.site || sky.day !== state.day) return null;
  if (state.hour !== null) return { i: sky.dayStart + state.hour, bodies: ["sun", "earth"] };
  return { i: sky.lit, bodies: state.view === "site" ? ["sun"] : [] };
}

function showSky() {
  if (quickMode) return;
  showHeights();
  const now = nowMark();
  if (!now) return; // the day's sky is still loading: renderRing calls again once it has
  const { h } = sky, i = now.i;
  document.dispatchEvent(new CustomEvent("tanaw:sky", { detail: {
    site: sky.site, hour: new Date(Date.parse(`${sky.date}T00:00:00Z`) + (i - sky.dayStart) * 3600000).toISOString(),
    sunAz: h.sunAz[i], sunEl: h.sunEl[i], sunVisible: Boolean(h.sunVisible[i]),
    earthAz: h.earthAz[i], earthEl: h.earthEl[i], earthVisible: Boolean(h.earthVisible[i]),
    now: { instant: instant(), earthVisible: Boolean(h.earthVisible[sky.dayStart + (state.hour ?? 0)]) },
  } }));
  clock.firstElementChild?.setNow?.(i, now.bodies);
  side.firstElementChild?.setNow?.(i, now.bodies);
  // The thumb at the instant the bar shows: the playhead's hour, else the lit hour in the
  // site view, else 00:00 UTC (showDay).
  const t = state.hour !== null ? sky.dayStart + state.hour : state.view === "site" ? sky.lit : sky.dayStart;
  thumbFill(h.sunVisible[t], h.earthVisible[t]);
}

// The slider thumb shows what is in view at its instant: Sun, Earth, both (half and half) or
// neither (style.css, --thumb-fill). Callers pass published or estimate visibility.
function thumbFill(sun, earth) {
  slider.style.setProperty("--thumb-fill", sun && earth ? "linear-gradient(90deg, var(--sun) 50%, var(--earth) 50%)"
    : sun ? "var(--sun)" : earth ? "var(--earth)" : "var(--sel)");
}

// Sky clock: the edge is the horizon, further in is higher in the sky; azimuth 0 (north) is up,
// clockwise. Points are faint where the terrain hides them; the planned day's points are larger.
// On a No-go day, the planned day's hours of each body that falls short stand out (hollow where
// hidden) and every other day fades. h: hourly arrays from the ring's first day (at base);
// first: that day's index; planned: the planned day and its index. The returned svg's
// setNow(i, bodies) rings the listed bodies' points at hour i (index into h) of the planned day.
function drawRing(h, base, first, planned, plannedIndex, horizon) {
  const R = (e) => 88 - (Math.max(-3, Math.min(9, e)) + 3) / 12 * 64;
  const P = (az, r) => { const a = az * Math.PI / 180; return [(r * Math.sin(a)).toFixed(1), (-r * Math.cos(a)).toFixed(1)]; };

  const root = svg("svg", { viewBox: "-100 -100 200 200", "aria-hidden": "true" });
  const sky = horizon.elevations.map((e, az) => P(az, R(e)).join(","));
  // The ground band: the horizon circle minus the skyline, so the sky inside stays black.
  const ground = `M88,0A88,88 0 1 0-88,0A88,88 0 1 0 88,0Z M${sky.join("L")}Z`;
  root.append(
    svg("path", { d: ground, "fill-rule": "evenodd", fill: "var(--terrain)" }),
    svg("polygon", { points: sky.join(" "), fill: "none", stroke: "var(--muted)", "stroke-width": 1, "vector-effect": "non-scaling-stroke" }),
  );

  const day = planned, go = isGo(day), at = (plannedIndex - first) * 24;
  const short = { sun: !go && !sunOk(day), earth: !go && !earthOk(day) };

  const steps = { sun: 2, earth: 4 }; // every 2nd Sun hour, every 4th Earth hour
  const path = (body) => {
    const b = BODIES[body], step = steps[body];
    const g = svg("g", { class: body });
    for (let k = 0; k < RING_DAYS * 24; k++) {
      const on = k >= at && k < at + 24, i = base + k;
      if (k % step || !Number.isFinite(h[b.az][i])) continue;
      if (on && short[body]) continue;
      const seen = h[b.visible][i];
      const [cx, cy] = P(h[b.az][i], R(h[b.el][i]));
      g.append(svg("circle", {
        cx, cy,
        r: on ? 2.6 : 1.3,
        fill: "currentColor",
        opacity: !go && !on ? (seen ? 0.35 : 0.15) : (seen ? 1 : 0.25),
      }));
    }
    return g;
  };
  const why = (body) => {
    const b = BODIES[body];
    const g = svg("g", { class: body });
    for (let i = base + at; i < base + at + 24; i++) {
      const [cx, cy] = P(h[b.az][i], R(h[b.el][i]));
      g.append(svg("circle", h[b.visible][i]
        ? { cx, cy, r: 3.2, fill: "currentColor" }
        : { cx, cy, r: 3.2, fill: "none", stroke: "currentColor", "stroke-width": 1.6 }));
    }
    return g;
  };
  root.append(path("sun"), path("earth"));
  for (const body of ["sun", "earth"]) if (short[body]) root.append(why(body));
  // The now marks: a ring round each listed body's point at hour i, and the point itself when
  // the path skips that hour.
  const now = svg("g", {});
  root.append(now);
  root.setNow = (i, bodies, positions) => {
    now.replaceChildren(...bodies.flatMap((body) => {
      const b = BODIES[body], point = positions?.[body];
      const [cx, cy] = P(point?.azimuthDeg ?? h[b.az][i], R(point?.elevationDeg ?? h[b.el][i]));
      const marks = [litRing(cx, cy, (short[body] ? 3.2 : 2.6) + 2.5, true)];
      if (point || (!short[body] && (i - base) % steps[body])) {
        marks.unshift(svg("circle", { class: body, cx, cy, r: 2.6, fill: "currentColor", opacity: (point?.centerVisible ?? h[b.visible][i]) ? 1 : 0.25 }));
      }
      return marks;
    }));
  };

  ["N", "E", "S", "W"].forEach((t, i) => {
    const [x, y] = P(i * 90, 95);
    const label = svg("text", { x, y, class: "compass", "text-anchor": "middle", "dominant-baseline": "central", fill: "var(--muted)" });
    label.textContent = t;
    root.append(label);
  });
  return root;
}

// Height strip: the sky clock unrolled into a side view under it. Azimuth runs left to right
// from north round to north, elevation up over the clock's −3° to +9°. It shows only the
// planned day's hours: filled where the body is seen, hollow where the terrain hides it.
// Drawn in real pixels so the points stay round; it redraws when its width changes.
// The now mark: a 1.5 px --text ring round a body's point (r: the point's radius + 2.5).
function litRing(cx, cy, r, scaled) {
  const attrs = { cx, cy, r, fill: "none", stroke: "var(--text)", "stroke-width": 1.5 };
  if (scaled) attrs["vector-effect"] = "non-scaling-stroke";
  return svg("circle", attrs);
}

const STRIP_H = 56;
let stripArgs = null;
function drawSide() {
  const w = side.clientWidth;
  if (!stripArgs || !w) return;
  side.replaceChildren(drawStrip(...stripArgs, w));
  const now = nowMark();
  if (now) side.firstElementChild.setNow(now.i, now.bodies, now.positions);
}
new ResizeObserver(drawSide).observe(side);

function drawStrip(h, base, first, planned, plannedIndex, horizon, width) {
  const inset = 6; // room for the centred N at each end
  const X = (az) => (inset + az / 360 * (width - 2 * inset)).toFixed(1); // az 0 to 360
  const Y = (e) => ((9 - Math.max(-3, Math.min(9, e))) / 12 * STRIP_H).toFixed(1);
  const root = svg("svg", { width, height: STRIP_H + 16, viewBox: `0 0 ${width} ${STRIP_H + 16}`, "aria-hidden": "true" });

  const sky = horizon.elevations.map((e, az) => `${X(az)},${Y(e)}`);
  sky.push(`${X(360)},${Y(horizon.elevations[0])}`); // back to north
  root.append(
    svg("polygon", { points: `${inset},${STRIP_H} ${sky.join(" ")} ${width - inset},${STRIP_H}`, fill: "var(--terrain)" }),
    svg("polyline", { points: sky.join(" "), fill: "none", stroke: "var(--muted)", "stroke-width": 1, "vector-effect": "non-scaling-stroke" }),
    svg("line", { x1: inset, x2: width - inset, y1: Y(0), y2: Y(0), stroke: "var(--edge)", "stroke-width": 1, "stroke-dasharray": "3 3" }),
  );

  // Each hour's mark: a dot inside the strip's −3° to +9°; beyond it, a small arrow on the edge
  // it left through (up above +9°, down below −3°) at its azimuth. Filled where seen, outlined
  // where hidden. EDGE_Y: the arrow's middle, where the now ring centres on it.
  const EDGE_Y = (e) => (e > 9 ? 2.5 : STRIP_H - 2.5).toFixed(1);
  const mark = (x, e, seen) => {
    const style = seen ? { fill: "currentColor" } : { fill: "none", stroke: "currentColor", "stroke-width": 1.5, "stroke-linejoin": "round" };
    if (e >= -3 && e <= 9) return svg("circle", seen ? { cx: x, cy: Y(e), r: 2.5, ...style } : { cx: x, cy: Y(e), r: 2.25, ...style });
    const tip = e > 9 ? 0 : STRIP_H, base = e > 9 ? 5 : STRIP_H - 5;
    return svg("polygon", { points: `${(+x - 3).toFixed(1)},${base} ${(+x + 3).toFixed(1)},${base} ${x},${tip}`, ...style });
  };
  const at = base + (plannedIndex - first) * 24;
  for (const body of ["sun", "earth"]) {
    const b = BODIES[body];
    const g = svg("g", { class: body });
    for (let i = at; i < at + 24; i++) g.append(mark(X((h[b.az][i] + 360) % 360), h[b.el][i], h[b.visible][i]));
    root.append(g);
  }
  const now = svg("g", {});
  root.append(now);
  root.setNow = (i, bodies, positions) => {
    now.replaceChildren(...bodies.map((body) => {
      const b = BODIES[body], point = positions?.[body], e = point?.elevationDeg ?? h[b.el][i];
      const y = e >= -3 && e <= 9 ? Y(e) : EDGE_Y(e); // round the dot, or round the edge arrow
      return litRing(X(((point?.azimuthDeg ?? h[b.az][i]) + 360) % 360), y, ((point?.centerVisible ?? h[b.visible][i]) ? 2.5 : 2.25) + 2.5);
    }));
  };

  ["N", "E", "S", "W", "N"].forEach((t, i) => {
    const label = svg("text", { x: X(i * 90), y: STRIP_H + 13, "text-anchor": "middle", "font-size": 12, fill: "var(--muted)" });
    label.textContent = t;
    root.append(label);
  });
  return root;
}

// Autoplay: steps the current instant hour by hour through the window, so the visible range
// plays in about PLAY_S seconds (30 days: a day a second). It is time-based, skipping hours
// when frames are slow. An hour tick only moves the instant (tickHour); a new day runs the full
// render() once. With reduced motion it steps a day at a time at the default instant. It never
// starts by itself; any change of day, site or panel by the user pauses it. At the end of the
// range it loops back to its start and keeps playing. Pausing keeps the hour.
const PLAY_S = 30;
const SLIDER_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const play = { on: false, reduced: false, pos: 0, last: 0, raf: 0, busy: false, speed: 1 }; // pos: hours (or days) from the data's start
// Playback speed: 1× plays the range in PLAY_S seconds; 2×, 4× and 8× in a half, a quarter and an
// eighth of that. Kept while the page is open. Reduced motion still steps a day at a time at 1×.
const SPEEDS = [1, 2, 4, 8];
const speedBtn = $("speed");
speedBtn.addEventListener("click", () => {
  play.speed = SPEEDS[(SPEEDS.indexOf(play.speed) + 1) % SPEEDS.length];
  speedBtn.textContent = `${play.speed}×`;
  speedBtn.setAttribute("aria-label", `Playback speed ${play.speed}×`);
});

function setPlaying(on) {
  play.on = on;
  playBtn.classList.toggle("on", on);
  playBtn.setAttribute("aria-label", on ? "Pause" : "Play");
  dayOut.setAttribute("aria-live", on ? "off" : "polite"); // no announcement every hour
  cancelAnimationFrame(play.raf);
  if (on) {
    play.last = performance.now();
    play.raf = requestAnimationFrame(playStep);
  }
}

function pause() {
  if (!play.on) return;
  setPlaying(false);
  if (quickMode && !play.reduced && quickPlay.hour >= 0) settleQuick();
  // Back to the published hour the bar shows: the globe and the sky clock's rings.
  if (!quickMode && state.hour !== null && state.data[state.site]) {
    smooth.minute = -1;
    document.dispatchEvent(new CustomEvent("tanaw:time", { detail: { instant: instant() } }));
    showSky();
  }
}

// Smooth autoplay (published year): between the published hours the globe's Sun and Earth,
// and the sky clock's and strip's rings, move each whole minute. The positions come from the
// computation module (productSnapshot and productMoonDirections, its bracketing
// interpolation between adjacent hours) over the same published files, gathered here as an
// accurate product; nothing is interpolated in the view. The data, the call and the bar stay
// hourly and daily. A minute whose files have not loaded yet keeps the hourly positions.
const smooth = { minute: -1, geo: new Map() }; // geo: data/sun/<month>.json once loaded
function sunGeo(month) {
  if (!smooth.geo.has(month)) smooth.geo.set(month, getJSON(`data/sun/${month}.json`).then((g) => (smooth.geo.set(month, g), g), () => smooth.geo.delete(month)));
  const g = smooth.geo.get(month);
  return g instanceof Promise ? null : g;
}
// The Earth & Sun view's paths (tanaw:track, globe.js): the Sun's and Earth's Moon-frame
// directions every TRACK_H hours across the shown range, from the computation module
// (productMoonDirections) over the published geometry files, or over the estimate's own track.
// Sent once per range; nothing is interpolated here.
const TRACK_H = 2;
let trackKey = "";
async function sendTrack() {
  const est = quickMode && quickEmission;
  const start = est ? Date.parse(quickWindow.state.startUtc) : quickMode ? NaN
    : Date.parse(`${state.data[state.site].forecast.days[state.ws].date}T00:00:00Z`);
  const days = est ? quickWindow.state.length : state.len;
  if (!Number.isFinite(start)) return;
  const key = `${est ? `estimate:${quickEmission.data.index.window.start}` : "published"}:${start}:${days}`;
  if (key === trackKey) return;
  trackKey = key;
  const times = [];
  for (let h = 0; h < days * 24; h += TRACK_H) times.push(new Date(start + h * 3600000).toISOString());
  let product = est ? quickEmission.data : null;
  if (!est) {
    const months = [...new Set(times.map((t) => t.slice(0, 7)))], geometryMonthly = {};
    await Promise.all(months.map(async (m) => {
      sunGeo(m);
      const g = await smooth.geo.get(m);
      if (g) geometryMonthly[m] = g;
    }));
    if (trackKey !== key) return;
    product = { index: state.data[state.site].forecast, geometryMonthly, quality: "accurate" };
  }
  const sun = [], earth = [];
  for (const t of times) {
    try {
      const d = productMoonDirections(product, t);
      sun.push(...d.sun);
      earth.push(...d.earth);
    } catch { /* an hour without saved geometry: the path skips it */ }
  }
  document.dispatchEvent(new CustomEvent("tanaw:track", { detail: { sun, earth } }));
}
function smoothAt(minute) {
  if (minute === smooth.minute) return;
  const { forecast, horizon } = state.data[state.site];
  const ms = Date.parse(`${forecast.days[0].date}T00:00:00Z`) + minute * 60000, utc = new Date(ms).toISOString();
  const months = [...new Set([utc.slice(0, 7), new Date(Math.floor(ms / 3600000) * 3600000 + 3600000).toISOString().slice(0, 7)])];
  const monthly = {}, geometryMonthly = {};
  for (const m of months) {
    const sky = skyLoaded.get(`${state.site}/${m}`), geo = sunGeo(m);
    if (!sky) skyMonth(state.site, m);
    if (!sky || !geo) return; // loading: the hourly positions stay meanwhile
    monthly[m] = sky; geometryMonthly[m] = geo;
  }
  const product = { index: forecast, horizon, monthly, geometryMonthly, quality: "accurate" };
  let snapshot, directions;
  try { snapshot = productSnapshot(product, utc); directions = productMoonDirections(product, utc); }
  catch { return; } // the last published hour, with no next hour to interpolate towards
  const newHour = Math.floor(minute / 60) !== Math.floor(smooth.minute / 60);
  smooth.minute = minute;
  document.dispatchEvent(new CustomEvent("tanaw:directions", { detail: { instant: utc, ...directions } }));
  if (newHour) { semLast = { instant: utc, directions }; semDraw(); } // the diagram, once an hour
  const now = nowMark();
  if (!now) return;
  clock.firstElementChild?.setNow?.(now.i, ["sun", "earth"], snapshot.bodies);
  side.firstElementChild?.setNow?.(now.i, ["sun", "earth"], snapshot.bodies);
}

// Smooth autoplay in estimate mode: the same split over the loaded estimate, whose product has
// an hourly Moon-frame track (geometry) besides its hourly sky. Each whole minute the globe's
// Sun and Earth (productMoonDirections) and the clock's and strip's rings (productSnapshot);
// each hour the bar and the site's lighting (tanaw:sky, from the hour's azimuths and heights);
// each day the call, times and the clock. No engine run while playing: pausing runs it once for
// the hour it stopped on (settleQuick), so every view shows one result again.
const quickPlay = { t0: 0, minute: -1, hour: -1, day: -1 }; // t0: the window's first day, 00:00 UTC
function quickAt(minute) {
  if (minute === quickPlay.minute || !quickEmission) return;
  const { data } = quickEmission, utc = new Date(quickPlay.t0 + minute * 60000).toISOString();
  let snapshot, directions;
  try { snapshot = productSnapshot(data, utc); directions = productMoonDirections(data, utc); }
  catch { return; } // not loaded or outside the track: the last positions stay
  const hour = Math.floor(minute / 60), day = Math.floor(hour / 24);
  quickPlay.minute = minute;
  document.dispatchEvent(new CustomEvent('tanaw:directions', { detail: { instant: utc, estimateScene: true, ...directions } }));
  if (day !== quickPlay.day) {
    quickPlay.day = day;
    quickWindow.select(day);
    renderQuickDay(utc, snapshot);
    renderForecastPanel();
  }
  if (hour !== quickPlay.hour) {
    quickPlay.hour = hour;
    quickBar(new Date(quickPlay.t0 + hour * 3600000).toISOString(), day); // the bar shows whole hours
    quickSky(utc, snapshot);
    renderTimes(data.index.days.find(d => d.date === utc.slice(0, 10)), data.index); // countdowns and heights
    semLast = { instant: utc, directions }; semDraw();
  }
  if (!quickRing) return;
  const i = quickRing.base + (Date.parse(utc) - quickRing.start) / 3600000;
  clock.firstElementChild?.setNow?.(i, ['sun', 'earth'], snapshot.bodies);
  side.firstElementChild?.setNow?.(i, ['sun', 'earth'], snapshot.bodies);
}
// The bar while playing: the hour shown, the thumb on its day.
function quickBar(utc, offset) {
  slider.value = String(offset);
  slider.setAttribute('aria-valuetext', `${dateLabel(utc.slice(0, 10))}, ${utc.slice(11, 16)} UTC`);
  dayOut.textContent = phone.matches ? `${dateLabel(utc.slice(0, 10)).split(' ').slice(1, 3).join(' ')}, ${utc.slice(11, 16)} UTC` : slider.getAttribute('aria-valuetext');
  quickPanel.setDate(utc);
}
// One engine run at the hour playback stopped on, in the same window and range.
function settleQuick() {
  const selected = quickWindow.state, utc = new Date(quickPlay.t0 + quickPlay.hour * 3600000).toISOString();
  quickPlay.minute = quickPlay.hour = quickPlay.day = -1;
  if (utc === selected.instantUtc) { renderQuick(); return; }
  const w = createDateWindow(new Date(QUICK_RANGE.start).toISOString(), new Date(QUICK_RANGE.end).toISOString(),
    new Date(quickPlay.t0 + Date.parse(utc) % 86400000).toISOString(), { fromSelection: true });
  w.range(selected.rangeDays);
  w.select(Math.floor((Date.parse(utc) - quickPlay.t0) / 86400000));
  quickWindow = w;
  renderQuickTimeline();
  loadQuick(w.state.instantUtc, true);
}

// From the current instant (hour 0 at the default instant); at the end of the range, from
// its start.
function startPlay() {
  leaveLive(); // Play fast-forwards from the shown instant; Today returns to the live clock
  if (quickMode) {
    const selected = quickWindow.state;
    play.reduced = reduceMotion.matches;
    if (play.reduced) play.pos = selected.offset >= selected.length-1 ? -1 : selected.offset;
    else {
      // Hours from the window's first day at 00:00 UTC; at the last whole hour, from the start.
      quickPlay.t0 = Date.parse(selected.startUtc);
      const at = (Date.parse(selected.instantUtc) - quickPlay.t0) / 3600000;
      play.pos = at >= selected.length * 24 - 1 ? 0 : at;
      quickPlay.minute = quickPlay.hour = quickPlay.day = -1;
    }
    setPlaying(true); return;
  }
  const last = state.ws + state.len - 1, before = `${state.day}:${state.hour}`;
  play.reduced = reduceMotion.matches;
  if (state.day >= last && (play.reduced || state.hour === 23)) {
    state.day = state.ws;
    state.hour = null;
  }
  state.hour = play.reduced ? null : state.hour ?? 0;
  play.pos = play.reduced ? state.day : state.day * 24 + state.hour;
  if (before !== `${state.day}:${state.hour}`) render();
  setPlaying(true);
}

function playStep(now) {
  // The first frame's time can be just before the click; a hidden tab doesn't jump on its return.
  const dt = Math.max(0, Math.min(0.25, (now - play.last) / 1000));
  play.last = now;
  if (quickMode && !play.reduced) {
    const span = quickWindow.state.length * 24, end = span - 1; // end: the last whole hour
    play.pos = (play.pos + dt * span * play.speed / PLAY_S) % span; // past the last hour, the first
    quickAt(Math.floor(Math.min(end, play.pos) * 60));
    play.raf = requestAnimationFrame(playStep);
    return;
  }
  if (quickMode) {
    if (!play.busy) {
      const selected = quickWindow.state;
      play.pos = (play.pos + dt * selected.length / PLAY_S) % selected.length; // past the last day, the first
      const offset = Math.max(0, Math.floor(play.pos));
      if (offset !== selected.offset) {
        quickWindow.select(offset); play.busy = true;
        loadQuick(quickWindow.state.instantUtc, true, false, true).finally(() => { play.busy = false; });
      }
    }
    if (play.on) play.raf = requestAnimationFrame(playStep);
    return;
  }
  const last = state.ws + state.len - 1;
  if (play.reduced) {
    play.pos += dt * state.len / PLAY_S;
    if (play.pos >= last + 1) play.pos = state.ws + (play.pos - state.ws) % state.len; // past the last day, the first
    const day = Math.floor(play.pos);
    if (day !== state.day) {
      state.day = day;
      render();
    }
  } else {
    const start = state.ws * 24, span = state.len * 24;
    play.pos += dt * span * play.speed / PLAY_S;
    if (play.pos >= start + span) play.pos = start + (play.pos - start) % span; // past the last hour, the first
    const at = Math.floor(play.pos), day = Math.floor(at / 24), hour = at % 24;
    if (day !== state.day) {
      state.day = day;
      state.hour = hour;
      render();
    } else if (hour !== state.hour) {
      state.hour = hour;
      tickHour();
    }
    smoothAt(Math.floor(play.pos * 60)); // the drawn positions between the hours
  }
  play.raf = requestAnimationFrame(playStep);
}

// An hour tick within the planned day: the date readout, the thumb, the globe (tanaw:time),
// and the site view and the clock and strip marks (showSky).
function tickHour() {
  showDay(dateLabel(state.data[state.site].forecast.days[state.day].date));
  placeThumb();
  document.dispatchEvent(new CustomEvent("tanaw:time", { detail: { instant: instant(), smooth: play.on && !play.reduced } }));
  showSky();
  observerLink();
}

// Site picker: one card per site, filtered by the optional category, or one site's details.
// Optional fields (category, mission, agency, date, summary, link, image, imageCredit) show
// only when a site has them.

// [id, filter label, label for one site]
const CATEGORIES = [["base-candidate", "Base candidates", "Base candidate"], ["visited", "Visited", "Visited"], ["upcoming", "Upcoming", "Upcoming"]];
const pick = { filter: "all", detail: null };

// "CR" from "Connecting Ridge": the first letters of the first two words that start with a letter.
function initials(name) {
  return name.split(/\s+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

// "22 Feb 2024" from "2024-02-22"; any other date as given.
function siteDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : date;
}

// "89.44° S, 222.83° E · frame unverified" (longitude east-positive, as in sites.json).
function coords(s) {
  const frame = !s.referenceFrame || s.referenceFrame === "unverified" ? "frame unverified" : s.referenceFrame;
  return `${Math.abs(s.lat).toFixed(2)}° ${s.lat < 0 ? "S" : "N"}, ${s.lon.toFixed(2)}° E · ${frame}`;
}

function groundHeight(s) {
  const m = Math.round(s.surfaceElevationM);
  if (s.elevationDatum === "sphere-1737400m") {
    return `${Math.abs(m).toLocaleString("en-GB")} m ${m < 0 ? "below" : "above"} the reference sphere`;
  }
  return s.elevationDatum ? `${m.toLocaleString("en-GB")} m, ${s.elevationDatum}` : `${m.toLocaleString("en-GB")} m`;
}

function hero(s) {
  const box = el("span", "hero");
  if (s.image) {
    const img = el("img");
    img.alt = "";
    img.src = s.image;
    box.append(img);
  } else {
    const tile = el("span", "initials", initials(s.name));
    tile.setAttribute("aria-hidden", "true");
    box.append(tile);
  }
  return box;
}

// The call for the planned date: a Go dot (gold) or a hollow No-go dot, then the text.
function callLine(s, label, cls, extra) {
  const day = state.data[s.id].forecast.days[state.day], go = isGo(day);
  const line = el("span", cls);
  const dot = el("span", go ? "dot" : "dot no");
  dot.setAttribute("aria-hidden", "true");
  line.append(dot, `${go ? "Go" : "No-go"}${label}${extra ? ` · ${why(day)}` : ""}`);
  return line;
}

// Search: one field at the top of the picker that narrows the sites as you type, by name,
// mission, agency and category; every word must match. Enter goes to the first match. The
// field is made once, so it keeps its text and focus while the results change.
const find = el("label", "pk-find");
find.insertAdjacentHTML("afterbegin", '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"/><path d="M21 21l-6 -6"/></svg>');
const findInput = el("input");
Object.assign(findInput, { type: "search", placeholder: "Search sites", autocomplete: "off", spellcheck: false });
findInput.setAttribute("aria-label", "Search sites by name, mission, agency or category");
find.append(findInput);
const findCount = el("p", "sr");
findCount.setAttribute("aria-live", "polite");
function matches(s) {
  const words = findInput.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const cat = CATEGORIES.find(([c]) => c === s.category);
  const text = [s.name, s.mission, s.agency, cat && cat[1], cat && cat[2]].filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => text.includes(w));
}
function showResults() {
  const box = pickerBody.querySelector(".pk-results");
  if (box) box.replaceChildren(...results());
}
findInput.addEventListener("input", showResults);
findInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  pickerBody.querySelector(".pk-results :is(.card-main, .btn)")?.click();
});

// Go to coordinates: latitude and longitude typed in the picker (north and east positive) open
// that place in estimate mode, named by its coordinates ("85.50° S, 30.25° E").
function coordName(lat, lon) {
  const e = ((lon + 180) % 360 + 360) % 360 - 180; // -180 to 180, east positive
  return `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? "S" : "N"}, ${Math.abs(e).toFixed(2)}° ${e < 0 ? "W" : "E"}`;
}
const goForm = el("form", "pk-go");
goForm.noValidate = true;
goForm.setAttribute("aria-labelledby", "pk-go-title");
const goTitle = el("p", "pk-go-title", "Go to coordinates");
goTitle.id = "pk-go-title";
const coordField = (name, hint) => {
  const input = el("input");
  Object.assign(input, { type: "text", name, autocomplete: "off", spellcheck: false, placeholder: hint });
  input.setAttribute("aria-label", `${name === "lat" ? "Latitude" : "Longitude"} in degrees, ${hint}`);
  return input;
};
const latInput = coordField("lat", "N +, S −"), lonInput = coordField("lon", "E +, W −");
const goBtn = el("button", "btn", "Go");
goBtn.type = "submit";
const goError = el("p", "pk-go-error");
goError.setAttribute("role", "alert");
const goRow = el("div", "pk-go-row");
goRow.append(latInput, lonInput, goBtn);
goForm.append(goTitle, goRow, goError);
const degreesIn = (text) => Number(text.trim().replace(/[−–]/g, "-").replace(/°/g, ""));
goForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const lat = degreesIn(latInput.value), lon = degreesIn(lonInput.value);
  const bad = !latInput.value.trim() || !Number.isFinite(lat) || Math.abs(lat) >= 90 ? latInput
    : !lonInput.value.trim() || !Number.isFinite(lon) || lon < -180 || lon >= 360 ? lonInput : null;
  latInput.toggleAttribute("aria-invalid", bad === latInput);
  lonInput.toggleAttribute("aria-invalid", bad === lonInput);
  if (bad) {
    goError.textContent = bad === latInput ? "Latitude is between −90 and 90 (south negative)." : "Longitude is between −180 and 360 (west negative).";
    bad.focus();
    return;
  }
  goError.textContent = "";
  goTo(Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4);
});
// A click on the Moon's face (globe.js) opens that point as typed coordinates do.
document.addEventListener("tanaw:point", (e) => {
  goTo(Math.round(e.detail.lat * 1e4) / 1e4, Math.round(e.detail.lon * 1e4) / 1e4);
});
function goTo(lat, lon) {
  const utc = instant(), id = `custom-${lat}-${lon}`;
  const window = comparison?.active && !quickMode ? compareWindow() : null;
  if (!state.sites.some((s) => s.id === id)) state.sites.push({ id, name: coordName(lat, lon), lat, lon });
  closePicker();
  pause();
  state.site = id;
  state.focus = true;
  if (window) {
    quickWindow = createDateWindow(new Date(QUICK_RANGE.start).toISOString(), new Date(QUICK_RANGE.end).toISOString(), utc,
      { windowStartUtc: window.startUtc, rangeDays: window.days });
  }
  loadQuick(utc, !!comparison?.active && !!quickWindow);
  selectedForCompare();
}

function selectFromPicker(id) {
  select(id);
  closePicker();
}

function renderPicker() {
  if (quickMode) {
    pickerSub.textContent = 'Choose a location for the selected estimate date'; pickerBack.hidden = true;
    const box = el("div", "pk-results");
    pickerBody.replaceChildren(find, findCount, goForm, box);
    showResults(); return;
  }
  const label = dateLabel(state.data[state.site].forecast.days[state.day].date);
  pickerSub.textContent = `Calls for ${label}`;
  pickerBack.hidden = !pick.detail;
  pickerBody.replaceChildren(...(pick.detail ? [siteDetail(pick.detail, label)] : siteGrid(label)));
  if (!pick.detail) showResults();
}

function siteGrid(label) {
  const used = CATEGORIES.filter(([c]) => state.sites.some((s) => s.category === c));
  if (!used.some(([c]) => c === pick.filter)) pick.filter = "all";
  const parts = [];
  if (used.length) {
    const filters = el("div", "filters");
    filters.setAttribute("aria-label", "Filter sites");
    filters.append(...[["all", "All"], ...used].map(([c, text]) => {
      const b = el("button", "btn", text);
      b.type = "button";
      b.setAttribute("aria-pressed", String(c === pick.filter));
      b.addEventListener("click", () => {
        pick.filter = c;
        renderPicker();
        pickerBody.querySelector('.filters [aria-pressed="true"]').focus();
      });
      return b;
    }));
    parts.push(filters);
  }
  const box = el("div", "pk-results");
  parts.unshift(find, findCount, goForm);
  parts.push(box);
  return parts;
}

// The sites the filter and the search leave: cards (or, in estimate mode, a plain list), or a
// line saying none match.
function results() {
  if (quickMode) {
    const shown = state.sites.filter(matches);
    findCount.textContent = `${shown.length} ${shown.length === 1 ? "site" : "sites"}`;
    if (!shown.length) return [el("p", "note", "No sites match.")];
    // No forecast for the estimate date yet, so each card shows the photo, name and mission only.
    const cards = el("div", "cards");
    cards.append(...shown.map((s) => {
      const card = el("article", "card"), main = el("button", "card-main");
      card.dataset.site = s.id;
      main.type = "button";
      if (s.id === state.site) main.setAttribute("aria-current", "true");
      const h = hero(s);
      h.setAttribute("aria-hidden", "true");
      main.append(h, el("span", "cname", s.name));
      const meta = [s.mission, siteDate(s.date)].filter(Boolean).join(" · ");
      if (meta) main.append(el("span", "cmeta", meta));
      main.addEventListener("click", () => selectFromPicker(s.id));
      card.append(main);
      return card;
    }));
    return [cards];
  }
  const label = dateLabel(state.data[state.site].forecast.days[state.day].date);
  const shown = listed().filter((s) => (pick.filter === "all" || s.category === pick.filter) && matches(s));
  findCount.textContent = `${shown.length} ${shown.length === 1 ? "site" : "sites"}`;
  if (!shown.length) return [el("p", "note", "No sites match.")];
  const cards = el("div", "cards");
  cards.append(...shown.map((s) => {
    const card = el("article", "card");
    card.dataset.site = s.id;
    const main = el("button", "card-main");
    main.type = "button";
    if (s.id === state.site) main.setAttribute("aria-current", "true");
    const h = hero(s);
    h.setAttribute("aria-hidden", "true");
    main.append(h, el("span", "cname", s.name));
    const meta = [s.mission, siteDate(s.date)].filter(Boolean).join(" · ");
    if (meta) main.append(el("span", "cmeta", meta));
    main.append(callLine(s, ` on ${label}`, "ccall"));
    main.addEventListener("click", () => selectFromPicker(s.id));
    const more = el("button", "btn details", "Details");
    more.type = "button";
    more.setAttribute("aria-label", `Details: ${s.name}`);
    more.addEventListener("click", () => {
      pick.detail = s.id;
      renderPicker();
      picker.scrollTop = 0;
      pickerBody.querySelector(".detail h3").focus();
    });
    card.append(main, more);
    return card;
  }));
  return [cards];
}

function siteDetail(id, label) {
  const s = state.sites.find((x) => x.id === id);
  const { forecast, horizon } = state.data[id];
  const box = el("div", "detail");
  const name = el("h3", "", s.name);
  name.tabIndex = -1;
  box.append(hero(s), name);
  if (s.summary) box.append(el("p", "summary", s.summary));

  const facts = el("dl", "facts");
  const row = (dt, dd) => {
    if (!dd) return;
    const value = el("dd");
    value.append(dd);
    facts.append(el("dt", "", dt), value);
  };
  row("Mission", s.mission);
  row("Agency", s.agency);
  row("Date", siteDate(s.date));
  row("Coordinates", coords(s));
  if (typeof s.surfaceElevationM === "number") row("Ground height", groundHeight(s));
  row(`Call on ${label}`, callLine(s, "", "", true));
  box.append(facts);

  const sources = [s.source, forecast.ephemeris, horizon.terrain].filter(Boolean);
  if (sources.length) box.append(el("p", "sources", `Sources: ${sources.join(" · ")}`));

  const actions = el("div", "actions");
  if (s.link) {
    const a = el("a", "btn", "Official page");
    a.href = s.link;
    a.target = "_blank";
    a.rel = "noopener";
    actions.append(a);
  }
  const choose = el("button", "btn primary", "Select this site");
  choose.type = "button";
  choose.addEventListener("click", () => selectFromPicker(id));
  actions.append(choose);
  box.append(actions);
  return box;
}

// Site panel: the focused site's details, rebuilt only when the site changes.
let panelSite = "";

// "89.44° S, 137.17° W": longitudes over 180° east are given as west.
function lonLat(s) {
  const lon = s.lon > 180 ? `${(360 - s.lon).toFixed(2)}° W` : `${s.lon.toFixed(2)}° E`;
  return `${Math.abs(s.lat).toFixed(2)}° ${s.lat < 0 ? "S" : "N"}, ${lon}`;
}

// On landing day, for a visited site: the touchdown in UTC (data/landings.json) and the Sun and
// Earth at that instant from the browser quick estimate (1969–2100, coarse terrain), with the
// source. The engine and the file load only once the block is on screen, in their own client,
// so this never disturbs the main view's requests.
let landings = null, landingClient = null;
const landingSkies = new Map(); // site id → Promise of the product around its landing
const landingSeen = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting } of entries) if (isIntersecting) { landingSeen.unobserve(target); fillLanding(target); }
});
function landingBlock(s) {
  const box = el("section", "landing");
  box.dataset.site = s.id;
  box.setAttribute("aria-labelledby", `landing-${s.id}`);
  const h = el("h3", "", "On landing day");
  h.id = `landing-${s.id}`;
  const sky = el("p", "l-sky", "Working out the sky…");
  sky.setAttribute("aria-live", "polite");
  box.append(h, el("p", "l-when", ""), sky);
  landingSeen.observe(box);
  return box;
}
const LANDING_DAYS = 30;
// How long the landing-time state lasts: the next set while up, the next rise while hidden, from
// the estimate's own events. Earth with no rise or set in the whole 30-day window never changes
// there (it stays up on the near side, hidden on the far side); the Sun past the window is "more
// than N days".
function landingSpan(product, key, utc, up) {
  const t = Date.parse(utc), kind = up ? "set" : "rise";
  const next = product.index.days.flatMap((d) => d[`${key}${kind}`]).map(Date.parse).filter((x) => x > t).sort((a, b) => a - b)[0];
  const rest = Date.parse(product.index.window.end) - t; // what the estimate covers after t
  const span = (ms) => (ms < 86400000 ? `${Math.max(1, Math.round(ms / 3600000))} h` : `${(ms / 86400000).toFixed(1)} days`);
  const whole = (ms) => (ms < 86400000 ? span(ms) : `${Math.floor(ms / 86400000)} days`);
  const what = key === "sun" ? "sunlight" : "Earth view"; // reads as "2.4 days of sunlight"
  if (next === undefined) {
    // "Never" only when the window covers a whole libration cycle (~27 days) after t.
    if (key === "earth" && rest >= 27 * 86400000) return up ? "never sets here" : "never rises here";
    return up ? `more than ${whole(rest)} of ${what} left` : `rises in more than ${whole(rest)}`;
  }
  return up ? `${span(next - t)} of ${what} left` : `rises in ${span(next - t)}`;
}
async function fillLanding(box) {
  const site = state.sites.find((x) => x.id === box.dataset.site);
  const [when, sky] = box.querySelectorAll(".l-when, .l-sky");
  try {
    landings ??= getJSON("data/landings.json");
    const landing = (await landings)[site.id];
    if (!landing) { box.remove(); return; }
    const utc = landing.landingUtc, day = utc.slice(0, 10);
    when.textContent = `${dateLabel(day)}, ${utc.slice(11, 16)} UTC`;
    if (!landingSkies.has(site.id)) {
      landingSkies.set(site.id, (async () => {
        const { createQuickEstimateClient } = await import("./computation/dist/quick/client.js");
        landingClient ??= createQuickEstimateClient();
        // 30 days from landing day: long enough to see each body's next rise or set.
        const start = `${day}T00:00:00Z`, end = new Date(Date.parse(start) + LANDING_DAYS * 86400000).toISOString();
        return landingClient.estimate({ id: site.id, name: site.name, lat: site.lat, lon: site.lon, instantUtc: utc, startUtc: start, endUtc: end });
      })());
    }
    const product = await landingSkies.get(site.id), bodies = productSnapshot(product, utc).bodies;
    const line = (key, name) => {
      const b = bodies[key], e = Math.round(b.elevationDeg * 10) / 10;
      const span = el("span", "l-body", `${name} ${b.centerVisible ? "up" : "hidden"}, ${e < 0 ? "−" : ""}${Math.abs(e).toFixed(1)}° · ${landingSpan(product, key, utc, b.centerVisible)}`);
      span.prepend(el("span", `l-k ${key}`));
      return span;
    };
    sky.replaceChildren(line("sun", "Sun"), line("earth", "Earth"));
    // "Estimate on coarse terrain." then the source as a small link ("Name: https://…").
    const [, label, url] = /^(.*?):\s*(https?:\/\/\S+)$/.exec(landing.landingSource) || [];
    const note = el("p", "l-note", "Estimate on coarse terrain. ");
    if (url) {
      const a = el("a", "", `Source: ${label}`);
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      note.append(a);
    } else note.append(`Source: ${landing.landingSource}`);
    box.append(note);
  } catch (err) {
    landingSkies.delete(site.id);
    if (err?.name === "AbortError") return; // another site's estimate replaced it; this panel has gone
    sky.textContent = "Couldn't work out the sky on landing day.";
    console.warn(`Landing-day sky for ${site.id}:`, err);
  }
}

// A typed or clicked point: how far it is from the nearest listed site (great circle on the
// 1737.4 km sphere), and the Sun and Earth at the selected time with how long each lasts, from the
// estimate on screen (the same lines as "On landing day"; showHeights keeps them current).
function nearestSite(p) {
  const rad = Math.PI / 180, dist = (a) => 1737.4 * Math.acos(Math.min(1, Math.sin(p.lat * rad) * Math.sin(a.lat * rad) +
    Math.cos(p.lat * rad) * Math.cos(a.lat * rad) * Math.cos((p.lon - a.lon) * rad)));
  const [km, site] = listed().map((a) => [dist(a), a]).sort((x, y) => x[0] - y[0])[0] || [];
  return site ? `${km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString("en")} km from ${site.name}` : "";
}
function pointSkyBlock(s) {
  const box = el("section", "landing point-sky");
  box.setAttribute("aria-labelledby", `point-sky-${s.id}`);
  const h = el("h3", "", "At the selected time");
  h.id = `point-sky-${s.id}`;
  const sky = el("p", "l-sky", "Working out the sky…");
  box.append(h, el("p", "l-when", ""), sky, el("p", "l-note", "Estimate on coarse terrain."));
  queueMicrotask(updatePointSky);
  return box;
}
function updatePointSky() {
  const box = panelMore.querySelector(".point-sky");
  if (!box || !quickEmission || quickEmission.selection.id !== state.site) return;
  const utc = quickNow();
  let bodies;
  try { bodies = productSnapshot(quickEmission.data, utc).bodies; } catch { return; } // past the window's last hour
  box.querySelector(".l-when").textContent = `${dateLabel(utc.slice(0, 10))}, ${utc.slice(11, 16)} UTC`;
  const line = (key, label) => {
    const b = bodies[key], e = Math.round(b.elevationDeg * 10) / 10;
    const span = el("span", "l-body", `${label} ${b.centerVisible ? "up" : "hidden"}, ${e < 0 ? "−" : ""}${Math.abs(e).toFixed(1)}° · ${landingSpan(quickEmission.data, key, utc, b.centerVisible)}`);
    span.prepend(el("span", `l-k ${key}`));
    return span;
  };
  box.querySelector(".l-sky").replaceChildren(line("sun", "Sun"), line("earth", "Earth"));
}
function renderPanel(s) {
  syncCompareAction();
  if (panelSite === s.id) {
    observerLink();
    return;
  }
  panelSite = s.id;
  const name = el("h2", "p-name", s.name || [s.region, lonLat(s)].filter(Boolean).join(" · "));
  name.id = "panel-name";
  name.tabIndex = -1;
  const category = CATEGORIES.find(([c]) => c === s.category);
  const where = [lonLat(s), category && category[2], s.positionAccuracy === "approximate" && "approximate position"];
  // A typed place is named by its coordinates, so it has no second coordinates line.
  const parts = s.id.startsWith("custom-") ? [name, el("p", "p-coords", nearestSite(s))] : [name, el("p", "p-coords", where.filter(Boolean).join(" · "))];
  const meta = [s.mission, s.agency, siteDate(s.date)].filter(Boolean).join(" · ");
  if (meta) parts.push(el("p", "p-meta", meta));
  panelId.replaceChildren(...parts);

  const more = [];
  if (s.image) {
    const photo = el("figure", "p-photo");
    const img = el("img");
    img.alt = "";
    img.src = s.image;
    photo.append(img);
    more.push(photo);
  }
  if (s.summary) more.push(el("p", "summary", s.summary));
  if (s.category === "visited") more.push(landingBlock(s));
  if (s.id.startsWith("custom-")) more.push(pointSkyBlock(s));
  const actions = el("div", "actions");
  if (s.link) {
    const a = el("a", "btn", "Official page");
    a.href = s.link;
    a.target = "_blank";
    a.rel = "noopener";
    actions.append(a);
  }
  if (OBSERVER_ENTRY) {
    const a = el("a", "btn icon observer");
    a.setAttribute("aria-label", "Observer view");
    a.dataset.tip = "Observer view";
    a.append($("observer-top").querySelector("svg").cloneNode(true));
    actions.append(a);
  }
  if (actions.children.length) more.push(actions);
  panelMore.replaceChildren(...more);
  observerLink();
}

// The Observer view link opens the focused site at the current instant: the autoplay hour,
// else the lit hour ("2026-12-16T05:00:00Z"), or the planned day's 00:00 UTC until the lit
// hour is known.
// The same link is in the top bar, so it works with or without the site panel.
function observerLink() {
  const links = [panelMore.querySelector(".observer"), $("observer-top")].filter(Boolean);
  if (!links.length || (!quickMode && !state.data[state.site])) return;
  const lit = state.lit;
  const t = quickMode ? instant() : state.hour !== null ? instant()
    : lit && lit.site === state.site && lit.day === state.day
    ? lit.hour
    : `${state.data[state.site].forecast.days[state.day].date}T00:00:00Z`;
  const site = state.sites.find(s => s.id === state.site);
  const rangeStart = quickMode ? quickWindow.state.startUtc : `${state.data[state.site].forecast.days[state.ws].date}T00:00:00Z`;
  const rangeDays = quickMode ? quickWindow.state.rangeDays : state.len;
  const href = `observer/?${new URLSearchParams({ ...(site.id.startsWith('custom-') ? {} : {site:site.id}), lat: String(site.lat), lon: String(site.lon), t, rangeStart, rangeDays: String(rangeDays), ...(quickMode ? {estimate:"1"} : {}) })}`;
  for (const a of links) a.href = href;
}

// Nearby spots: for sites listed in data/grid/index.json, a 5 × 5 grid of spots around the site
// (spacingM apart, i east and j north from -2 to 2) with each spot's published year
// percentages and daily Sun and Earth hours. Shown in the site view only. The site's own spot
// (0, 0) reads the site's forecast, so it matches the bar exactly. The host owns the selected
// spot and tells the site view (tanaw:spot, site.js), which asks for a new one with
// tanaw:spotpick.
const grids = new Map(); // site id → the loaded grid { points, at(i, j), offset }, or null when it failed
const gridLoads = new Map(); // site id → Promise of its file
function spotGrid() {
  const id = state.site, file = state.view === "site" && state.grids.sites[id];
  if (!file) return null;
  if (!grids.has(id) && !gridLoads.has(id)) {
    gridLoads.set(id, getJSON(`data/grid/${file}`).then((g) => {
      // The grid's day d is days since its start; the forecast's day 0 may be later.
      const days = state.data[id].forecast.days;
      const offset = Math.round((Date.parse(days[0].date) - Date.parse(state.grids.start)) / 86400000);
      const fits = g.points.length === 25 && g.points.every((p) =>
        p.sunHours.length >= offset + days.length && p.earthHours.length >= offset + days.length);
      if (!fits) throw new Error(`data/grid/${file}: doesn't cover the forecast's days`);
      const byKey = new Map(g.points.map((p) => [`${p.i},${p.j}`, p]));
      grids.set(id, { points: g.points, at: (i, j) => byKey.get(`${i},${j}`), offset });
      if (id === state.site) {
        renderSpots();
        sendSpot();
      }
    }).catch((err) => {
      grids.set(id, null); // this site shows no spots
      console.warn("No nearby spots:", err);
    }).finally(() => gridLoads.delete(id)));
  }
  return grids.get(id) || null;
}

// "500 m east, 1 km north"; "" for the site itself.
function spotPlace(i, j) {
  const step = (n, pos, neg) => {
    const m = Math.abs(n) * state.grids.spacingM;
    return `${m >= 1000 ? `${m / 1000} km` : `${m} m`} ${n > 0 ? pos : neg}`;
  };
  return [i && step(i, "east", "west"), j && step(j, "north", "south")].filter(Boolean).join(", ");
}

// "4°", "0.5°" under 1°, and a decimal where a whole number would hide that it is over 10°.
function slopeText(deg) {
  return `${deg < 1 || (deg > 10 && Math.round(deg) <= 10) ? deg.toFixed(1) : Math.round(deg)}°`;
}
const steep = (p) => p.slopeDeg > 10;

// The spot's day for the planned date: the site's own forecast day for the site itself.
function spotDay(g, i, j) {
  if (!i && !j) return state.data[state.site].forecast.days[state.day];
  const p = g.at(i, j), d = state.day + g.offset;
  return { sunHours: p.sunHours[d], earthHours: p.earthHours[d] };
}

function setSpot(i, j) {
  state.spot = { site: state.site, i, j };
  renderSpots();
  sendSpot();
}
// What a spot says to a screen reader, on its button on the ground (site.js).
function spotLabel(p, i, j) {
  const name = state.sites.find((s) => s.id === state.site).name;
  return `${!i && !j ? name : spotPlace(i, j)}: sunlight ${Math.round(p.sunPct)}% of the year, ` +
    `slope ${slopeText(p.slopeDeg)}${steep(p) ? ", too steep to land" : ""}`;
}

let spotsSite = "";
const spotParts = {};
// The panel keeps the selected spot's readout and "Back to site"; the spots themselves are
// buttons on the ground in the site view (site.js).
function buildSpots() {
  spotsSite = state.site;
  const head = el("h3", "s-head", "Selected spot");
  Object.assign(spotParts, {
    where: el("p", "s-where"), call: el("p", "s-call"), year: el("p", "s-year"), slope: el("p", "s-slope"),
    back: el("button", "btn", "Back to site"),
  });
  spotParts.back.type = "button";
  spotParts.back.addEventListener("click", () => setSpot(0, 0));
  const read = el("div", "s-read");
  read.append(spotParts.where, spotParts.call, spotParts.year, spotParts.slope);
  spotsBox.replaceChildren(head, read, spotParts.back);
}

// The selected spot's readout for the planned day.
function renderSpots() {
  showAt();
  const g = spotGrid();
  spotsBox.hidden = !g;
  if (!g) {
    spotsSite = "";
    return;
  }
  if (spotsSite !== state.site) buildSpots();
  const { i, j } = state.spot, p = g.at(i, j), site = !i && !j;
  const name = state.sites.find((s) => s.id === state.site).name;
  spotParts.where.textContent = site ? name : `${spotPlace(i, j)} of ${name}`;
  const day = spotDay(g, i, j), go = isGo(day);
  const dot = el("span", go ? "dot" : "dot no");
  dot.setAttribute("aria-hidden", "true");
  spotParts.call.replaceChildren(dot, el("span", "verdict", go ? "Go" : "No-go"), ` · ${why(day)}`);
  spotParts.year.replaceChildren("Year: Sun ", el("span", "sun", `${Math.round(p.sunPct)}%`),
    ", Earth ", el("span", "earth", `${Math.round(p.earthPct)}%`));
  spotParts.slope.replaceChildren(`Slope ${slopeText(p.slopeDeg)}`);
  if (steep(p)) spotParts.slope.append(" · ", el("span", "steep", "too steep to land"));
  spotParts.back.hidden = site;
}

// Tell the site view the selected spot and the grid's spots (null without a loaded grid), only
// when either has changed.
let spotSent = "";
function sendSpot() {
  const g = spotGrid(), { i, j } = state.spot;
  const key = `${state.site}:${i}:${j}:${Boolean(g)}`;
  if (key === spotSent) return;
  spotSent = key;
  document.dispatchEvent(new CustomEvent("tanaw:spot", { detail: {
    site: state.site, i, j, spacingM: state.grids.spacingM,
    points: g ? g.points.map((p) => ({ i: p.i, j: p.j, groundM: p.groundM, sunPct: p.sunPct, steep: steep(p), label: spotLabel(p, p.i, p.j) })) : null,
  } }));
}

// A spot tapped on the ground, or the pin dropped near one (site.js).
document.addEventListener("tanaw:spotpick", (e) => {
  const { site, i, j } = e.detail;
  if (site !== state.site || !spotGrid() || (i === state.spot.i && j === state.spot.j)) return;
  setSpot(i, j);
});

// Previous and next step through the sites in list order, wrapping around.
function stepSite(by) {
  siteNameDirection = by;
  const sites = listed(); // entered coordinates are not stepped through
  if (!sites.length) return;
  const i = sites.findIndex((s) => s.id === state.site); // -1 from entered coordinates: the first or last
  select(sites[(i + by + sites.length) % sites.length].id);
}
$("prev").addEventListener("click", () => stepSite(-1));
$("next").addEventListener("click", () => stepSite(1));

// Details on demand, one at a time: the site picker (from the site name), Compare, the times,
// the enlarged sky clock, and on narrower screens the site panel's sheet ("Site info"). Escape closes
// whichever is open.
function setCompare(on, tripResult = null) {
  if (!comparison || on === comparison.active) return;
  if (on) {
    pause(); if (!tripResult) travel?.close(); setTimes(false); setBig(false); setPicker(false); setSheet(false);
    comparison.open(tripResult ? compareTravelPoint(tripResult.point) : undefined, tripResult ? {
      startUtc: tripResult.startUtc, endUtc: tripResult.endUtc, resultFor: point => travel.resultFor(point)
    } : null);
    compareCandidate = false;
    state.view = 'globe';
  } else { comparison.close(); compareCandidate = false; sheet = false; }
  hud.classList.toggle('compare', on);
  hud.classList.toggle('travel-compare', on && comparison.fromTravel);
  travel?.syncComparison();
  hud.classList.remove('compare-picking');
  ring.inert = on;
  compareBtn.setAttribute('aria-expanded', String(on));
  syncCompareAction();
  render(); layout(); frame();
}

function setTimes(on) {
  if (on) { pause(); setCompare(false); setBig(false); setPicker(false); setSheet(false); }
  hud.classList.toggle("times", on);
  layout();
  frame();
}

function setBig(on) {
  if (on) { pause(); setCompare(false); setTimes(false); setPicker(false); setSheet(false); }
  hud.classList.toggle("big", on);
  clock.setAttribute("aria-expanded", String(on));
  frame();
}

// The picker opens on the grid of cards, with focus on its heading; closing it returns focus
// to the site name.
function setPicker(on) {
  if (on === hud.classList.contains("picker") || !state.sites.length) return;
  if (on) {
    pause();
    setCompare(false); setTimes(false); setBig(false); setSheet(false);
    pick.detail = null;
    renderPicker();
  }
  hud.classList.toggle("picker", on);
  now.setAttribute("aria-expanded", String(on));
  searchBtn.setAttribute("aria-expanded", String(on));
  if (!on) findInput.value = ""; // the next opening shows every site
  if (on) {
    picker.scrollTop = 0;
    pickerHeading.focus();
  }
}

function closePicker() {
  setPicker(false);
  now.focus();
}

// Narrower screens: while a site is focused, the bar's "Site info" button opens the site panel
// as a bottom sheet at half height, with focus on its heading; closing it returns focus there. Its handle toggles half and full height, or drags the sheet: on release
// it snaps to the nearer height, or closes below a quarter of the screen.
let sheet = false;
const grab = $("panel-grab");
function setSheet(on) {
  on = on && state.focus && !wide.matches;
  if (on === sheet) return;
  if (on) { pause(); setTimes(false); setBig(false); setPicker(false); }
  sheet = on;
  setFull(false);
  layout();
  if (on) {
    panel.scrollTop = 0;
    $("panel-name")?.focus({ preventScroll: true }); // the sheet is still sliding in
  }
}

function setFull(on) {
  panel.classList.toggle("full", on);
  grab.setAttribute("aria-expanded", String(on));
  grab.setAttribute("aria-label", on ? "Collapse details" : "Expand details");
}

const SHEET_TOP = 68; // the full sheet's top, just under the top bar (style.css)
const drag = { id: null, y: 0, top: 0, moved: false };
grab.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  grab.setPointerCapture(e.pointerId);
  drag.id = e.pointerId;
  drag.y = e.clientY;
  drag.top = panel.offsetTop;
  drag.moved = false;
});
grab.addEventListener("pointermove", (e) => {
  if (e.pointerId !== drag.id) return;
  const dy = e.clientY - drag.y;
  if (!drag.moved && Math.abs(dy) < 6) return;
  drag.moved = true;
  panel.classList.add("drag");
  panel.style.top = `${Math.round(Math.min(hud.clientHeight - 44, Math.max(SHEET_TOP, drag.top + dy)))}px`;
});
const release = (e) => {
  if (e.pointerId !== drag.id) return;
  drag.id = null;
  if (!drag.moved) return;
  const h = hud.clientHeight, height = h - panel.offsetTop;
  panel.classList.remove("drag");
  panel.style.top = "";
  if (height < h * 0.25) closeSheet();
  else setFull(height > (h / 2 + h - SHEET_TOP) / 2);
};
grab.addEventListener("pointerup", release);
grab.addEventListener("pointercancel", release);
grab.addEventListener("click", (e) => {
  if (e.detail && drag.moved) { drag.moved = false; return; } // the end of a drag, not a tap
  setFull(!panel.classList.contains("full"));
});

function closeSheet() {
  if (comparison?.active) { compareCandidate = false; sheet = false; layout(); frame(); compareBtn.focus(); return; }
  if (!sheet) return;
  setSheet(false);
  infoBtn.focus();
}

$('panel-compare').addEventListener('click', () => {
  if (!comparison?.active) { setCompare(true); compareBtn.focus(); return; }
  if (comparison.add(state.sites.find(s => s.id === state.site))) {
    compareCandidate = false; sheet = false; layout(); frame();
    $('compare-slots').querySelector('.compare-add, .compare-remove')?.focus();
  }
});
compareBtn.addEventListener("click", () => setCompare(!hud.classList.contains("compare")));
now.addEventListener("click", () => setPicker(!hud.classList.contains("picker")));
$("picker-close").addEventListener("click", closePicker);
// The top bar's search opens the picker's grid with the cursor in the search field.
const searchBtn = $("search-btn");
searchBtn.addEventListener("click", () => {
  if (hud.classList.contains("picker") && pick.detail) { pick.detail = null; renderPicker(); }
  setPicker(true);
  findInput.focus();
});
pickerBack.addEventListener("click", () => {
  const id = pick.detail;
  pick.detail = null;
  renderPicker();
  pickerBody.querySelector(`.card[data-site="${id}"] .details`)?.focus();
});
$("compare-close").addEventListener("click", () => { setCompare(false); if (travel?.active) travel.focusComparison(); else compareBtn.focus(); });
timesBtn.addEventListener("click", () => setTimes(!hud.classList.contains("times")));
infoBtn.addEventListener("click", () => setSheet(!sheet));
$("panel-close").addEventListener("click", closeSheet);
clock.addEventListener("click", () => setBig(!hud.classList.contains("big")));
$("clock-close").addEventListener("click", () => { setBig(false); clock.focus(); });
// About: credits, sources, the key and the scale notes, in a modal dialog over the whole
// screen. The dialog closes itself on Escape and returns focus to the "i" button.
const about = $("about");
// The Go rule, in About and as the call's tooltip, from NEEDS.
$("about-go").textContent = `For the example mission, a day is Go when, seen from 2\u00a0m above the ground, the Sun is up for at least ${NEEDS.sunHours} hours and Earth is in view for at least ${NEEDS.earthHours} hours of that UTC day. Otherwise it is No-go, and the reason beside the call says what falls short.`;
call.title = `Go: Sun up ${NEEDS.sunHours} h or more and Earth in view ${NEEDS.earthHours} h or more in a UTC day (example mission)`;
// The public source repository; the About link stays hidden while this is empty.
const REPO_URL = "https://github.com/ruzcko/gabay-tanaw";
if (REPO_URL) {
  $("about-repo").querySelector("a").href = REPO_URL;
  $("about-repo").hidden = false;
}
$("about-btn").addEventListener("click", () => about.showModal());
$("about-close").addEventListener("click", () => about.close());
about.addEventListener("click", (e) => { // a click on the backdrop, outside the sheet
  const r = about.getBoundingClientRect();
  if (e.target === about && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) about.close();
});

// Presentation only: preserve the current selection, panels, camera and playback clock.
function setCinematic(on) {
  if (on === cinematic) return;
  const playbackBar = $('dayctl'), back = $('cinematic-back');
  const from = playbackBar.getBoundingClientRect();
  cinematicTransition?.cancel();
  document.querySelectorAll(':popover-open').forEach(menu => menu.hidePopover());
  cinematic = on;
  hud.parentElement.classList.toggle('moon-cinematic', on);
  back.hidden = !on;
  const to = playbackBar.getBoundingClientRect();
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    cinematicTransition = playbackBar.animate([
      { translate: `${from.left - to.left}px ${from.top - to.top}px` },
      { translate: '0px 0px' }
    ], { duration: 320, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }
  frame();
  (on ? back : resetBtn).focus({ preventScroll: true });
}
$('cinematic-mode').addEventListener('click', () => setCinematic(true));
$('cinematic-back').addEventListener('click', () => setCinematic(false));
document.addEventListener('keydown', e => {
  if (!cinematic || e.key !== 'Escape' || document.querySelector(':popover-open')) return;
  e.preventDefault(); e.stopImmediatePropagation();
  setCinematic(false);
}, { capture: true });

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || about.open) return;
  if (comparison?.active && comparison.picking) { comparison.cancelPick(); return; }
  if (comparison?.active && compareCandidate) { closeSheet(); return; }
  const open = sheet || ["picker", "compare", "times", "big"].some((c) => hud.classList.contains(c));
  if (hud.classList.contains("picker")) closePicker();
  closeSheet();
  setCompare(false);
  setTimes(false);
  setBig(false);
  // With nothing open, Escape closes the 3D view, unless focus is in a text field.
  const typing = e.target.closest?.("textarea, select, [contenteditable], input:not([type=range])");
  if (!open && !typing && state.view === "site") wholeMoon();
});

// Sun–Earth–Moon diagram: seen from the north, not to scale, with a choice of centre. Each
// centre is its own frame, drawn only from published data, and all three show the same angle
// between the Sun and the Moon at the instant. The Earth and Moon centres use the hourly entry
// the globe uses (tanaw:sun, globe.js), projected onto the plane square to lunar north (which
// stands in for ecliptic north).
// - Earth (default): Earth-centred and turning with the Sun, which stays on the left. The Moon
//   sits at the angle round Earth from the Sun's direction to the Moon's, counter-clockwise
//   (waxing) positive: new on the left, first quarter below.
// - Moon: the Moon-fixed frame from above the lunar north pole, longitude 0 (the near side) on
//   the left and east longitude counter-clockwise. Earth is on the inner ring at the sub-Earth
//   longitude (its small wobble is the libration), the Sun on the outer ring at the subsolar
//   longitude, going round clockwise once a month. They share a bearing at Full Moon and are
//   opposite at New Moon.
// - Sun (behind SUN_CENTRE): ecliptic longitude 0 on the right, counter-clockwise. Earth is on
//   its orbit at earthHelioLonDeg and the Moon on a small, enlarged circle round it at
//   moonGeoLonDeg, both from data/orbit/<YYYY-MM>.json. Without that hour the bodies hide.
// On the globe the drawing is a button for the Earth & Sun view.
const sem = $("sem");
const semBtn = $("sem-btn");
const semBox = $("sem-box");
const semPhase = $("sem-phase");
const esBtn = $("mode-es");
const SEM = { x: 80, y: 80, orbit: 46, earth: 12, moon: 5 };
const SEM_MOON = { moon: 12, inner: 36, outer: 64, earth: 7, sun: 7 };
const SEM_SUN = { sun: 9, orbit: 46, earth: 7, loop: 20, moon: 4 };
const PHASES = ["New Moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full Moon",
  "Waning gibbous", "Last quarter", "Waning crescent"];
const RAD = Math.PI / 180;

// Gradients for the shaded spheres, in the body's own box, lit from the left: the lit colour
// fading into the dark --glass-solid half across a wide, soft terminator 36% of the diameter,
// the limb darkening toward black, a --text highlight toward the light, and on the night
// side a faint rim in the body's colour, strongest at the far limb, so the dark half still reads
// as round.
function semStop(offset, colour, opacity = 1) {
  return svg("stop", { offset, style: `stop-color: var(${colour}); stop-opacity: ${opacity}` });
}
function semGradient(tag, attrs, stops) {
  const g = svg(tag, attrs);
  g.append(...stops.map((st) => semStop(...st)));
  return g;
}
const semDefs = svg("defs", {});
for (const [body, colour] of [["earth", "--earth"], ["moon", "--text"]]) {
  semDefs.append(
    semGradient("linearGradient", { id: `sem-lit-${body}`, x1: 0, y1: 0, x2: 1, y2: 0 },
      [[0, colour], [0.32, colour], [0.68, "--glass-solid"], [1, "--glass-solid"]]),
    semGradient("radialGradient", { id: `sem-rim-${body}`, cx: 0.3, cy: 0.5, r: 0.7 },
      [[0.75, colour, 0], [1, colour, 0.22]]));
}
// The Sun's glow: --sun at 35% from the disc's edge (at 1/2.2 of the halo's radius) fading
// to nothing at 2.2 times the disc's radius.
semDefs.append(
  semGradient("radialGradient", { id: "sem-glow", cx: 0.5, cy: 0.5, r: 0.5 }, [[0, "--sun", 0.35], [0.455, "--sun", 0.35], [1, "--sun", 0]]),
  semGradient("radialGradient", { id: "sem-limb", cx: 0.5, cy: 0.5, r: 0.5 }, [[0.5, "--space", 0], [1, "--space", 0.5]]),
  semGradient("radialGradient", { id: "sem-hi", cx: 0.3, cy: 0.5, r: 0.3 }, [[0, "--text", 0.5], [1, "--text", 0]]));

// A shaded sphere: the shading turns so the lit half faces the light, then a 1 px outline just
// outside the limb, so the dark half reads against black. place(x, y, light) moves it, with
// light the screen angle (degrees, SVG rotation) that turns the lit half from the left.
function semSphere(r, body, edge) {
  const g = svg("g", {});
  const shade = svg("g", {});
  shade.append(...[`sem-lit-${body}`, "sem-limb", "sem-hi", `sem-rim-${body}`].map((id) => svg("circle", { r, fill: `url(#${id})` })));
  g.append(shade, svg("circle", { r: r + 0.5, fill: "none", stroke: edge, "stroke-width": 1 }));
  g.place = (x, y, light) => {
    g.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)})`);
    shade.setAttribute("transform", `rotate(${light.toFixed(1)})`);
  };
  g.r = r;
  return g;
}
// The Sun: a flat --sun disc over its glow. place(x, y) moves it.
function semSunDisc(r, x = 0, y = 0) {
  const g = svg("g", {});
  g.append(svg("circle", { r: r * 2.2, fill: "url(#sem-glow)" }), svg("circle", { r, fill: "var(--sun)" }));
  g.place = (px, py) => g.setAttribute("transform", `translate(${px.toFixed(1)},${py.toFixed(1)})`);
  g.place(x, y);
  return g;
}
// The near side: a short tick just outside the Moon's limb, on black, pointing along (dx, dy).
function semTick(moon, len = 7) {
  const tick = svg("line", { stroke: "var(--muted)", "stroke-width": 2, "stroke-linecap": "butt" });
  moon.append(tick);
  moon.tick = (dx, dy) => {
    [["x1", dx * (moon.r + 1.5)], ["y1", dy * (moon.r + 1.5)], ["x2", dx * (moon.r + 1.5 + len)], ["y2", dy * (moon.r + 1.5 + len)]]
      .forEach(([k, v]) => tick.setAttribute(k, v.toFixed(1)));
  };
}
function semRing(r, x = SEM.x, y = SEM.y) {
  return svg("circle", { cx: x, cy: y, r, fill: "none", stroke: "var(--edge)", "stroke-width": 1 });
}
function semShow(nodes, on) {
  nodes.forEach((n) => (on ? n.removeAttribute("visibility") : n.setAttribute("visibility", "hidden")));
}
const semSvg = svg("svg", { viewBox: "0 0 160 160", width: 160, height: 160, "aria-hidden": "true" });

// Earth centre.
const semE = svg("g", {});
const semEarth = semSphere(SEM.earth, "earth", "var(--earth)");
semEarth.place(SEM.x, SEM.y, 0);
const semMoon = semSphere(SEM.moon, "moon", "var(--muted)");
semTick(semMoon);
semShow([semMoon], false);
semE.append(semRing(SEM.orbit), semSunDisc(7, 11, SEM.y), semEarth, semMoon);

// Moon centre.
const semM = svg("g", {});
const semMMoon = semSphere(SEM_MOON.moon, "moon", "var(--muted)");
semTick(semMMoon);
semMMoon.tick(-1, 0); // longitude 0
semMMoon.place(SEM.x, SEM.y, 0);
const semMEarth = semSphere(SEM_MOON.earth, "earth", "var(--earth)");
const semMSun = semSunDisc(SEM_MOON.sun);
semShow([semMEarth, semMSun], false);
semM.append(semRing(SEM_MOON.inner), semRing(SEM_MOON.outer), semMMoon, semMEarth, semMSun);

// Sun centre.
const semS = svg("g", {});
const semSEarth = semSphere(SEM_SUN.earth, "earth", "var(--earth)");
const semSLoop = semRing(SEM_SUN.loop, 0, 0);
const semSMoon = semSphere(SEM_SUN.moon, "moon", "var(--muted)");
semTick(semSMoon, 4);
semS.append(semRing(SEM_SUN.orbit), semSunDisc(SEM_SUN.sun, SEM.x, SEM.y), semSLoop, semSEarth, semSMoon);

semSvg.append(semDefs, semE, semM, semS);
semBtn.append(semSvg);

const semLayers = { earth: semE, moon: semM, sun: semS };
let semCentre = "earth";
let semLast = null; // the latest tanaw:sun detail

function drawSunCentre(o) {
  const parts = [semSEarth, semSLoop, semSMoon];
  if (!o) return semShow(parts, false);
  const le = o.earth * RAD, lm = o.moon * RAD;
  const ex = SEM.x + SEM_SUN.orbit * Math.cos(le), ey = SEM.y - SEM_SUN.orbit * Math.sin(le);
  const mx = ex + SEM_SUN.loop * Math.cos(lm), my = ey - SEM_SUN.loop * Math.sin(lm);
  const light = (x, y) => Math.atan2(y - SEM.y, x - SEM.x) / RAD; // lit halves face the Sun at the centre
  semSEarth.place(ex, ey, light(ex, ey));
  semSMoon.place(mx, my, light(mx, my));
  semSMoon.tick(-Math.cos(lm), Math.sin(lm)); // at Earth
  semSLoop.setAttribute("cx", ex.toFixed(1));
  semSLoop.setAttribute("cy", ey.toFixed(1));
  semShow(parts, true);
}
drawSunCentre(null);

// The Sun centre's data, only with SUN_CENTRE: data/orbit.json lists the months, and each
// data/orbit/<YYYY-MM>.json holds its hours from its own start, loaded when first needed.
const orbit = { index: null, instant: "", months: new Map() };
function orbitIndex() {
  if (!orbit.index) orbit.index = getJSON("data/orbit.json").catch((err) => { orbit.index = null; throw err; });
  return orbit.index;
}
function orbitMonth(month) {
  if (!orbit.months.has(month)) orbit.months.set(month, getJSON(`data/orbit/${month}.json`));
  return orbit.months.get(month);
}
// Outside the published months (estimate mode and any other date from 1969 to 2100) the same
// longitudes come from the quick-estimate engine (quickOrbit, computation/), loaded the first
// time it is needed, with one shared coefficient set. A newer instant cancels the work for an
// older one (AbortSignal). While it works the drawing is dimmed (aria-busy on the diagram);
// sem.dataset.orbit says which source drew it ("accurate" or "estimate").
let orbitQuick = null, orbitWork = null, orbitLast = { instant: "", o: null }; // the last estimate drawn
function quickOrbitAt(instant, signal) {
  orbitQuick ??= Promise.all([import("./computation/dist/quick/orbit.js"), import("./computation/dist/quick/coefficients.js")])
    .then(([o, c]) => ({ quickOrbit: o.quickOrbit, coefficients: new c.Coefficients() }))
    .catch((err) => { orbitQuick = null; throw err; });
  return orbitQuick.then(({ quickOrbit, coefficients }) => quickOrbit([Date.parse(instant)], { coefficients, signal })).then(([o]) => o);
}
function drawOrbit(o, source) {
  drawSunCentre(o);
  sem.dataset.orbit = o ? source : "";
}
function applyOrbit() {
  if (!SUN_CENTRE || semCentre !== "sun" || !semLast) return;
  const instant = semLast.instant;
  orbit.instant = instant;
  orbitWork?.abort();
  orbitWork = null;
  sem.setAttribute("aria-busy", "false");
  const estimate = () => {
    if (orbitLast.instant === instant) return drawOrbit(orbitLast.o, "estimate"); // a redraw of the same instant
    const work = orbitWork = new AbortController();
    sem.setAttribute("aria-busy", "true");
    quickOrbitAt(instant, work.signal).then((o) => {
      if (orbit.instant !== instant || work.signal.aborted) return;
      orbitLast = { instant, o: { earth: o.earthHelioLonDeg, moon: o.moonGeoLonDeg } };
      drawOrbit(orbitLast.o, "estimate");
    }, (err) => {
      if (orbit.instant === instant && err?.name !== "AbortError") drawOrbit(null);
    }).finally(() => { if (orbitWork === work) { orbitWork = null; sem.setAttribute("aria-busy", "false"); } });
  };
  if (quickMode && quickEmission?.quality !== 'accurate') return estimate();
  const month = instant.slice(0, 7);
  orbitIndex().then((index) => {
    if (orbit.instant !== instant) return;
    // The month 4 days ahead loads early, so autoplay crosses into it without a pause.
    const ahead = new Date(Date.parse(instant) + 4 * 86400000).toISOString().slice(0, 7);
    if (ahead !== month && index.months.includes(ahead)) orbitMonth(ahead).catch(() => { orbit.months.delete(ahead); });
    if (!index.months.includes(month)) return estimate();
    return orbitMonth(month).then((t) => {
      if (orbit.instant !== instant) return;
      const i = Math.round((Date.parse(instant) - Date.parse(t.start)) / (t.stepMinutes * 60000));
      const ok = i >= 0 && i < t.earthHelioLonDeg.length && i < t.moonGeoLonDeg.length;
      if (ok) drawOrbit({ earth: t.earthHelioLonDeg[i], moon: t.moonGeoLonDeg[i] }, "accurate");
      else estimate();
    }, (err) => { orbit.months.delete(month); throw err; });
  }).catch(() => { if (orbit.instant === instant) estimate(); });
}

document.addEventListener("tanaw:sun", (e) => {
  if (quickMode) return;
  semLast = e.detail;
  semDraw();
});
function semDraw() {
  const p = semLast;
  if (!p) return;
  const flat = (lat, lon) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD)];
  const [sx, sy] = p.directions ? [p.directions.sun[0], -p.directions.sun[2]] : flat(p.subsolarLat, p.subsolarLon);
  const [ex, ey] = p.directions ? [p.directions.earth[0], -p.directions.earth[2]] : flat(p.subEarthLat, p.subEarthLon);
  const a = Math.atan2(-sx * ey + sy * ex, -sx * ex - sy * ey); // from S to −E (Earth → Moon)

  // Earth centre.
  const x = SEM.x - SEM.orbit * Math.cos(a), y = SEM.y + SEM.orbit * Math.sin(a);
  semMoon.place(x, y, 0);
  semMoon.tick(Math.cos(a), -Math.sin(a)); // at Earth's centre
  semShow([semMoon], true);

  // Moon centre: longitude L points along (−cos L, sin L).
  const ls = Math.atan2(sy, sx), le = Math.atan2(ey, ex);
  const sunX = SEM.x - SEM_MOON.outer * Math.cos(ls), sunY = SEM.y + SEM_MOON.outer * Math.sin(ls);
  const earthX = SEM.x - SEM_MOON.inner * Math.cos(le), earthY = SEM.y + SEM_MOON.inner * Math.sin(le);
  const light = -ls / RAD;
  semMMoon.place(SEM.x, SEM.y, light);
  semMEarth.place(earthX, earthY, light);
  semMSun.place(sunX, sunY);
  semShow([semMEarth, semMSun], true);

  applyOrbit();
  const deg = ((a / RAD) % 360 + 360) % 360;
  semPhase.textContent = PHASES[Math.round(deg / 45) % 8];
}

// The centre: joined segments under the drawing, each a small glyph of its body (drawn with
// the drawing's own Sun and sphere gradients, lit from the left), named by its aria-label and
// a tooltip. Switching
// cross-fades the drawing (at once with reduced motion); the choice stays across sites and dates.
function semGlyph(c) {
  const g = svg("svg", { viewBox: "-10 -10 20 20", width: 20, height: 20, "aria-hidden": "true" });
  const body = c === "sun" ? semSunDisc(5) : semSphere(8, c, c === "earth" ? "var(--earth)" : "var(--muted)");
  if (c !== "sun") body.place(0, 0, 0);
  g.append(body);
  return g;
}
const semRow = el("div", "range sem-row");
semRow.setAttribute("role", "group");
semRow.setAttribute("aria-label", "Centre");
const semCentreBtns = [["sun", "Sun"], ["earth", "Earth"], ["moon", "Moon"]]
  .filter(([c]) => SUN_CENTRE || c !== "sun")
  .map(([c, label]) => {
    const b = el("button", "btn");
    b.type = "button";
    b.append(semGlyph(c));
    b.setAttribute("aria-label", b.dataset.tip = `${label} at the centre`);
    b.dataset.centre = c;
    b.setAttribute("aria-pressed", String(c === semCentre));
    b.addEventListener("click", () => setCentre(c));
    return b;
  });
semRow.append(...semCentreBtns);
sem.append(semRow);
function showCentre() {
  for (const [c, g] of Object.entries(semLayers)) {
    if (c === semCentre) g.removeAttribute("display");
    else g.setAttribute("display", "none");
  }
  applyOrbit();
}
let semFade = 0;
function setCentre(c) {
  if (semCentreBtns.find(b => b.dataset.centre === c)?.disabled) return;
  if (c === semCentre) return;
  semCentre = c;
  semCentreBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.centre === c)));
  clearTimeout(semFade);
  if (reduceMotion.matches) { showCentre(); semSvg.classList.remove("out"); return; }
  semSvg.classList.add("out");
  semFade = setTimeout(() => { showCentre(); semSvg.classList.remove("out"); }, 200);
}
showCentre();

semBtn.addEventListener("click", () => esBtn.click());
new MutationObserver(() => semBtn.setAttribute("aria-pressed", esBtn.getAttribute("aria-pressed")))
  .observe(esBtn, { attributes: true, attributeFilter: ["aria-pressed"] });

// Where the sky clock and Times live. The clock sits top left (in the bar beside the call on
// phones), and Times opens above the bar. Wide screens (1024 px and up): while a site is focused
// the site panel is open on the right (unless Compare is), and Times moves into the clock's
// column, under its key, so the bar's Times button hides. On other non-phone screens, opening
// Times also uses that column. Narrower site details use the sheet opened by "Site info".
const phone = matchMedia("(max-width: 760px)");
const wide = matchMedia("(min-width: 1024px)");
const clockClose = $("clock-close");

// Forecast panel: the shown window as a table, one column per day like a weather table, between
// the site row and the play bar. Rows: the day, Go, Sun and Earth hours (tinted from black to
// 40% of the body's colour) and the height chart, which marks each body's highest point. At
// 30 days on wider screens the columns sit exactly over the timeline; otherwise they are 28 px
// (44 px on phones) and scroll sideways, keeping the planned day in view. The slider stays the
// control; a column's day button also picks that day (a 44 px target on phones only). It opens
// with a site on tall wider screens only (FP_TALL), and keeps the user's own choice once made.
const fpanel = $("fpanel"), fpTable = $("fp-table"), fcBtn = $("fc-btn");
const FP_KEY = "tanaw.forecastPanel", FP_THUMB = 14; // px: the slider's thumb (#dayctl --thumb)
// Without a choice of the user's, it opens with a site only on screens at least FP_TALL px
// tall and wider than a phone, where the clock's column and the site panel keep their room.
const FP_TALL = 950;
let fpChoice = null; // true or false once the user has opened or folded it (kept in local storage)
try { const kept = localStorage.getItem(FP_KEY); if (kept) fpChoice = kept === "open"; } catch { /* no storage */ }
let fpOpen = fpChoice ?? false, fpCentred = "", fpRequest = 0;
function setForecast(on, remember = false) {
  fpOpen = on;
  if (remember) {
    fpChoice = on;
    try { localStorage.setItem(FP_KEY, on ? "open" : "folded"); } catch { /* kept for this visit only */ }
  }
  renderForecastPanel();
}
fcBtn.addEventListener("click", () => setForecast(!fpOpen, true));
const degrees = (v) => `${v.toFixed(1)}°`.replace("-", "−");
function fpCell(cls, row, i, text) {
  const c = el("div", `fp-c ${cls}`, text);
  c.style.gridRow = row;
  c.style.gridColumn = i + 2;
  return c;
}
function pickDay(i) {
  leaveLive();
  pause();
  if (quickMode) { quickWindow.select(i); loadQuick(quickWindow.state.instantUtc, true); return; }
  state.day = state.ws + i;
  state.hour = null;
  render();
}
// The panel's window: the published days, or the estimate's (its per-day hours and its hourly
// sky, the same fields as the published files), with the selected day and hour in it.
function fpWindow() {
  if (!quickMode) return { days: state.data[state.site].forecast.days.slice(state.ws, state.ws + state.len), i: state.day - state.ws, hour: state.hour ?? 0 };
  const { startUtc, length, offset } = quickWindow.state, first = startUtc.slice(0, 10);
  const all = new Map(quickEmission.data.index.days.map(d => [d.date, d]));
  const days = Array.from({ length }, (_, i) => {
    const date = new Date(Date.parse(first + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10);
    return all.get(date) || { date, sunHours: null, earthHours: null };
  });
  const now = quickNow();
  return { days, i: quickPlay.day >= 0 ? quickPlay.day : offset,
    hour: now ? new Date(now).getUTCHours() : 0, estimate: true };
}
function buildForecastTable(id, days, key, estimate = false) {
  fpTable.dataset.key = key;
  fpTable.style.setProperty("--n", days.length);
  const label = estimate && quickEmission.quality === "estimate";
  const labels = [[label ? "Estimate" : "", ""], ["Go", ""], ["Sun hours", "sun"], ["Earth hours", "earth"], ["Height", ""]];
  const parts = labels.map(([text, k], r) => {
    const l = el("div", "fp-l", text);
    l.style.gridRow = r + 1;
    if (k) l.prepend(el("span", `fp-k ${k}`));
    return l;
  });
  days.forEach((d, i) => {
    const date = new Date(`${d.date}T00:00:00Z`), first = date.getUTCDate() === 1 || i === 0;
    const known = Number.isFinite(d.sunHours) && Number.isFinite(d.earthHours);
    const go = known && isGo(d), m = date.getUTCDate() === 1 ? " m" : "";
    const b = el("button", `fp-c fp-day${m}`);
    b.type = "button";
    b.style.gridColumn = i + 2;
    b.dataset.i = i;
    b.tabIndex = -1;
    b.setAttribute("aria-label", known ? `${dateLabel(d.date)}: ${go ? "Go" : "No-go"}, Sun up ${Math.round(d.sunHours)} h, Earth in view ${Math.round(d.earthHours)} h` : `${dateLabel(d.date)}: forecast unknown; select to load this date`);
    b.append(el("span", "", first ? MONTHS[date.getUTCMonth()] : WEEKDAYS[date.getUTCDay()][0]), el("b", "", String(date.getUTCDate())));
    const call = fpCell(`call${m}`, 2, i, "");
    call.append(known ? el("span", go ? "dot" : "dot no") : el('span', '', '—'));
    const sun = fpCell(`sun${m}${known && d.sunHours < 0.5 ? " zero" : ""}`, 3, i, known ? String(Math.round(d.sunHours)) : '—');
    sun.style.setProperty("--f", d.sunHours / 24);
    const earth = fpCell(`earth${m}${known && d.earthHours < 0.5 ? " zero" : ""}`, 4, i, known ? String(Math.round(d.earthHours)) : '—');
    earth.style.setProperty("--f", d.earthHours / 24);
    parts.push(b, call, sun, earth);
  });
  const chart = el("div", "fp-chart");
  const sel = el("div", "fp-sel");
  parts.push(chart, sel);
  fpTable.replaceChildren(...parts);
  fpTable.querySelectorAll(":scope > *").forEach((n) => n.setAttribute("aria-hidden", n.classList.contains("fp-day") ? "false" : "true"));
  // The chart, once the month files are in.
  if (label) parts[0].title = "Estimate: worked out in your browser from JPL DE440 and coarser terrain";
  const request = ++fpRequest, dates = days.map((d) => d.date);
  const month = (m) => (estimate ? Promise.resolve(quickEmission.data.monthly[m]) : skyMonth(id, m));
  Promise.all([...new Set(dates.map((d) => d.slice(0, 7)))].map(month)).then((files) => {
    if (request !== fpRequest || files.some((f) => !f)) return; // an estimate month not computed: no heights
    fpTable.series = chartSeries(files, dates);
    drawForecastChart();
  }, (err) => { if (request === fpRequest) console.error(err); });
}
// The chart row: each body's height across the columns, solid where seen and thin dashed
// where hidden, the level line, the planned instant, and each body's highest point in the
// window with its height and day ("Highest Sun 2.0° · Fri 4 Dec").
function drawForecastChart() {
  const s = fpTable.series, chart = fpTable.querySelector(".fp-chart");
  if (!s || !chart) return;
  const col = parseFloat(getComputedStyle(fpTable).getPropertyValue("--col")) || 28;
  const w = col * s.days.length, h = chart.clientHeight || 80, per = s.hourly ? 24 : 1;
  const all = [...s.sun, ...s.earth].filter(Number.isFinite), hi = Math.max(5, ...all), lo = Math.min(-5, ...all);
  const x = (k) => (Math.floor(k / per) + ((k % per) + 0.5) / per) * col, y = (v) => 18 + (hi - v) / (hi - lo) * (h - 36);
  const path = (vals, seen, on) => {
    let d = "", pen = false;
    vals.forEach((v, k) => {
      if (Number.isFinite(v) && !!seen[k] === on) { d += `${pen ? "L" : "M"}${x(k).toFixed(1)},${y(v).toFixed(1)}`; pen = true; } else pen = false;
    });
    return d;
  };
  const at = fpWindow(), now = (at.i + at.hour / 24) * col + (s.hourly ? 0 : col / 2);
  // Each body's highest point: a dot on its line, and its label in a strip clear of the lines
  // (the Sun's along the top, Earth's along the bottom), starting just right of the dot, or
  // ending just left of it in the right half, then kept inside the chart.
  const peak = (name, vals, ty) => {
    const finite = vals.filter(Number.isFinite);
    if (!finite.length) return "";
    const k = vals.indexOf(Math.max(...finite)), px = x(k), left = px > w / 2;
    const text = `Highest ${name === "sun" ? "Sun" : "Earth"} ${degrees(vals[k])} · ${dateLabel(s.days[Math.floor(k / per)], false)}`;
    return `<circle class="${name}" cx="${px.toFixed(1)}" cy="${y(vals[k]).toFixed(1)}" r="3"/>
    <text class="${name}" x="${(left ? px - 10 : px + 10).toFixed(1)}" y="${ty}" text-anchor="${left ? "end" : "start"}">${text}</text>`;
  };
  chart.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <line class="lvl" x1="0" x2="${w}" y1="${y(0)}" y2="${y(0)}"/>
    <path class="hid" d="${path(s.sun, s.sunSeen, false)}"/><path class="hid" d="${path(s.earth, s.earthSeen, false)}"/>
    <path class="sun" d="${path(s.sun, s.sunSeen, true)}"/><path class="earth" d="${path(s.earth, s.earthSeen, true)}"/>
    <line class="now" x1="${now.toFixed(1)}" x2="${now.toFixed(1)}" y1="0" y2="${h}"/>
    ${peak("sun", s.sun, 12)}${peak("earth", s.earth, h - 4)}</svg>`;
  chart.querySelectorAll("text").forEach((t) => {
    const b = t.getBBox(), shift = Math.max(2 - b.x, Math.min(0, w - 2 - (b.x + b.width)));
    if (shift) t.setAttribute("x", Number(t.getAttribute("x")) + shift);
  });
}
// Column width and the label column: at 30 days on wider screens, matched to the slider so
// column i sits over thumb position i; otherwise fixed widths that scroll.
function fitForecastTable() {
  if (quickMode && !quickEmission) return; // A resize can arrive while a picked point is loading.
  if (!fpanel.getClientRects().length) return; // not laid out (hidden under the picker, Compare, …): fits when it shows
  const n = Number(fpTable.style.getPropertyValue("--n")) || state.len;
  let col = phone.matches ? 44 : 28, label = phone.matches ? 96 : 0;
  if (!phone.matches) {
    const sl = slider.getBoundingClientRect(), box = fpanel.getBoundingClientRect();
    const aligned = n > 1 ? (sl.width - FP_THUMB) / (n - 1) : sl.width;
    if (travel?.active) {
      label = 96;
      col = Math.max(44, (box.width - label) / n);
    } else {
      if (n <= 31) col = aligned;
      label = Math.max(96, sl.left + FP_THUMB / 2 - aligned / 2 - box.left);
    }
  }
  const was = fpTable.style.getPropertyValue("--col");
  fpTable.style.setProperty("--col", `${col}px`);
  fpTable.style.setProperty("--label", `${label}px`);
  if (was !== `${col}px`) drawForecastChart();
  // The planned day in view, centred, when it or the table changes (not on every redraw, so a
  // sideways scroll by hand stays put).
  const i = fpWindow().i, at = `${fpTable.dataset.key}:${i}`;
  if (fpCentred !== at) {
    fpCentred = at;
    fpTable.scrollLeft = Math.max(0, i * col + col / 2 - (fpTable.clientWidth - label) / 2);
  }
}
function renderForecastPanel() {
  const ready = quickMode ? Boolean(quickEmission) : Boolean(state.data[state.site]);
  const show = fpOpen && state.sites.length > 0 && ready;
  fcBtn.hidden = !ready;
  fcBtn.setAttribute("aria-expanded", String(show));
  fpanel.hidden = !show;
  if (!show) { fpCentred = ""; return; }
  const { days, i, estimate } = fpWindow();
  const key = estimate ? `estimate:${quickEmission.selection.id}:${days[0]?.date}:${days.length}:${quickEmission.data.index.window.start}`
    : `${state.site}:${state.ws}:${state.len}`;
  if (fpTable.dataset.key !== key) buildForecastTable(state.site, days, key, estimate);
  let trip = fpTable.querySelector('.fp-trip');
  if (travelTrip?.site === state.site && days.length) {
    if (!trip) { trip = el('div', 'fp-trip'); fpTable.append(trip); }
    const first = Date.parse(days[0].date + 'T00:00:00Z');
    const start = Math.max(0, (Date.parse(travelTrip.startUtc) - first) / 86400000);
    const end = Math.min(days.length, (Date.parse(travelTrip.endUtc) - first) / 86400000);
    trip.hidden = end <= start;
    trip.style.gridColumn = `${Math.floor(start) + 2} / ${Math.ceil(end) + 2}`;
    trip.style.marginLeft = `calc(var(--col) * ${start % 1})`;
    trip.style.marginRight = `calc(var(--col) * ${Math.ceil(end) - end})`;
    trip.setAttribute('role', 'img');
    trip.setAttribute('aria-label', `Travel dates: ${instantText(travelTrip.startUtc)} to ${instantText(travelTrip.endUtc)}`);
  } else trip?.remove();
  fitForecastTable();
  fpTable.querySelector(".fp-sel").style.gridColumn = i + 2;
  fpTable.querySelectorAll(".fp-day").forEach((b) => {
    b.tabIndex = Number(b.dataset.i) === i ? 0 : -1;
    b.setAttribute("aria-current", Number(b.dataset.i) === i ? "date" : "false");
  });
  drawForecastChart();
}
fpTable.addEventListener("click", (e) => {
  const b = e.target.closest(".fp-day");
  if (b) pickDay(Number(b.dataset.i));
});
// Keyboard: the planned day's button is the one tab stop; Left and Right step the day.
fpTable.addEventListener("keydown", (e) => {
  const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
  if (!step || !e.target.closest(".fp-day")) return;
  e.preventDefault();
  const n = Number(fpTable.style.getPropertyValue("--n")) || state.len;
  const i = Math.max(0, Math.min(n - 1, fpWindow().i + step));
  pickDay(i);
  fpTable.querySelector(`.fp-day[data-i="${i}"]`)?.focus();
});
// Re-fit whenever the slider or the panel changes size, including when the panel shows again
// after an overlay (the picker, Compare, an enlarged view) that hid it.
const fpSizes = new ResizeObserver(() => requestAnimationFrame(() => { if (!fpanel.hidden) fitForecastTable(); }));
fpSizes.observe(slider);
fpSizes.observe(fpanel);

function layout() {
  if (!state.focus || wide.matches) sheet = false;
  if (state.focus && wide.matches) hud.classList.remove("times");
  const open = !comparison?.fromTravel && state.focus && (comparison?.active ? compareCandidate : (wide.matches || sheet));
  const col = !comparison?.active && open && wide.matches;
  const changed = open !== hud.classList.contains("panel") || col !== hud.classList.contains("col");
  hud.classList.toggle("focus", state.focus);
  hud.classList.toggle("panel", open);
  hud.classList.toggle("col", col);

  const place = (node, parent, before) => {
    if (node.parentElement !== parent || node.nextElementSibling !== before) parent.insertBefore(node, before);
  };
  const headed = !phone.matches, dateField = document.querySelector(".dayctl .date-field, #site-head .date-field");
  siteHead.hidden = !headed;
  if (headed) {
    place(siteSwitch, siteHead, null);
    if (dateField) place(dateField, siteHead, null);
    place(call, siteHead, null);
    place($("wait"), siteHead, null); // "Go for 14 days", or the Wait chip, under the call
  } else {
    place(siteSwitch, plan, plan.firstElementChild === siteSwitch ? siteSwitch.nextElementSibling : plan.firstElementChild);
    place($("wait"), plan, $("move"));
    place(call, plan, $("wait"));
    if (dateField) place(dateField, $("dayctl"), $("dayctl").querySelector('label[for="day"]'));
  }
  // Times is the Forecast panel's right-hand column (under the table on phones); on phones the
  // Sun–Earth–Moon diagram goes with it, elsewhere it stays last in the clock's column.
  const travelBtn = $("travel-btn");
  if (travelBtn) {
    if (phone.matches) place(travelBtn, fcBtn.parentElement, fcBtn);
    else { const lb = $("layers-btn"); place(travelBtn, lb.parentElement, lb.nextElementSibling === travelBtn ? travelBtn.nextElementSibling : lb.nextElementSibling); }
  }
  place(times, fpanel, null);
  place(sem, phone.matches ? times : ring, null);
  semDraw(); // its labels' size depends on where it is
  if (phone.matches && !comparison?.active) place(ring, plan, call);
  else place(ring, hud, $("view-3d")); // its own place, right after the top bar
  if (!col) ring.scrollTop = 0;

  timesBtn.setAttribute("aria-expanded", String(hud.classList.contains("times")));
  infoBtn.setAttribute("aria-expanded", String(sheet));
  if (changed) frame();
}
for (const m of [phone, wide]) m.addEventListener("change", layout);
phone.addEventListener("change", () => { if (quickMode && quickWindow) renderQuickTimeline(); else if (dayLabel) showDay(dayLabel); });
addEventListener("resize", layout);
layout();

// Tell the globe the free band between the top bar and the bar (or the open Times, or the open
// Compare panel on wider screens), right of the clock's column while it holds Times, and left
// of the open site panel, in viewport px, so it can frame the Moon there (globe.js, site.js).
let framing = false;
function frame() {
  if (framing) return;
  framing = true;
  queueMicrotask(() => {
    framing = false;
    if (cinematic) {
      const box = hud.getBoundingClientRect(), pad = getComputedStyle(hud);
      document.dispatchEvent(new CustomEvent('tanaw:frame', { detail: {
        top: box.top + parseFloat(pad.paddingTop), bottom: bar.getBoundingClientRect().top - 8,
        left: box.left + parseFloat(pad.paddingLeft), right: box.right - parseFloat(pad.paddingRight)
      } }));
      return;
    }
    if (hud.classList.contains("big") && phone.matches) return; // the clock has left the bar for a moment
    const hudBox = hud.getBoundingClientRect();
    let edge = bar.getBoundingClientRect().top;
    // Wide screens: the site panel and the clock's column end 12 px above the bar.
    hud.style.setProperty("--below", `${Math.round(hudBox.bottom - edge + 12)}px`);
    if (comparison?.active) {
      hud.style.setProperty('--compare-bottom', `${Math.round(hudBox.bottom - $('dayctl').getBoundingClientRect().top + 12)}px`);
      hud.style.setProperty('--compare-height', `${compare.offsetHeight}px`);
    }
    if (travel?.active) hud.style.setProperty('--travel-bottom', `${Math.round(hudBox.bottom - $('dayctl').getBoundingClientRect().top + 12)}px`);
    if (hud.classList.contains("times") && !hud.classList.contains("col")) edge = times.getBoundingClientRect().top;
    // Narrower screens: the stage sits above the sheet; the full sheet covers it, so the
    // framing stays where the half sheet leaves it.
    if (sheet && !comparison?.active) edge = panel.classList.contains("full") ? hudBox.top + hudBox.height / 2 : panel.getBoundingClientRect().top;
    const top = topbar.getBoundingClientRect().bottom + 8;
    let left = hudBox.left, right = hudBox.right;
    if (hud.classList.contains("col") && !hud.classList.contains("big")) left = ring.getBoundingClientRect().right + 16;
    if (wide.matches && hud.classList.contains("panel")) right = panel.getBoundingClientRect().left - 16;
    // In the site view, its row of buttons sits centred under the band, just above whatever
    // ends it (16 px in from the band's sides), and the band ends above the row.
    let bottom = edge - 8;
    const travelBounds = travel?.bounds();
    if (travelBounds) {
      if (travelBounds.mobile) bottom = Math.min(bottom, travelBounds.top - 12);
      else right = Math.min(right, travelBounds.left - 16);
    }
    if (comparison?.fromTravel) {
      const bounds = compare.getBoundingClientRect();
      bottom = Math.min(bottom, bounds.top - 12);
    }
    if (!view3d.hidden) {
      view3d.style.maxWidth = `${Math.round(right - left - 32)}px`;
      bottom -= view3d.offsetHeight;
      view3d.style.transform = `translate(${Math.round((left + right - view3d.offsetWidth) / 2 - hudBox.left)}px, ${Math.round(bottom - hudBox.top)}px)`;
      bottom -= 8;
    }
    document.dispatchEvent(new CustomEvent("tanaw:frame", { detail: { top, bottom, left, right } }));
  });
}
const sizes = new ResizeObserver(frame);
[topbar, bar, compare, times, panel, ring].forEach((n) => sizes.observe(n));
addEventListener("resize", frame);

// While a site is focused the top bar's button reads "Whole Moon" and ends focus: the site
// panel closes and the globe shows, still facing the selected site. Otherwise it reads "View"
// and opens the view menu (globe.js). Escape in the site view and zooming out past the site view's
// limit (tanaw:wholemoon, site.js) end focus the same way.
function wholeMoon() {
  if (!state.focus) return;
  state.focus = false;
  state.view = "globe";
  render();
}
// The click is cancelled, so the menu it opens once focus has ended doesn't open as well.
resetBtn.addEventListener("click", (e) => {
  if (!state.focus) return;
  e.preventDefault();
  wholeMoon();
});
document.addEventListener("tanaw:wholemoon", wholeMoon);

// The site view's display options, on by default and kept for the session: the 5 km ring (with
// its label, and the globe's ring) and the nearby-spot dots. tanaw:layers tells site.js and
// globe.js; nothing else changes.
const layers = { ring: true, spots: true, map: "", shadow: false };
const sendLayers = () => document.dispatchEvent(new CustomEvent("tanaw:layers", { detail: { ...layers } }));
for (const [key, btn] of [["ring", $("show-ring")], ["spots", $("show-spots")]]) {
  btn.addEventListener("click", () => {
    layers[key] = !layers[key];
    btn.setAttribute("aria-pressed", String(layers[key]));
    sendLayers();
  });
}

// Map layers (the top bar's Layers menu): None, Slope, Sunlight or Permanent shadow, one at a
// time, kept across sites, dates and visits (local storage). globe.js and site.js draw it from
// data/layers/ (tanaw:layers' map); the key under the bar takes its labels from the layers'
// index.json.
// Each layer has its own switch (menuitemcheckbox rows that keep the menu open). Slope and
// Sunlight both fill the ground, so one turns the other off; Permanent shadow is an outline that
// stacks over either. "All off" clears them. The choice is saved as "<fill>" plus "+shadow".
const FILLS = [["slope", "Slope"], ["sunlight", "Sunlight"]];
const LAYER_KEY = "tanaw-layer";
const layersBtn = $("layers-btn"), layerMenu = $("layer-menu"), layerKey = $("layer-key");
let layerIndex = null;
try {
  const saved = (localStorage.getItem(LAYER_KEY) || "").split("+");
  layers.map = FILLS.some(([k]) => k === saved[0]) ? saved[0] : "";
  layers.shadow = saved.includes("shadow"); // also an older single "shadow" choice
} catch { /* no saved choice */ }
const layerRow = (key, name, role, onClick) => {
  const b = el("button", "btn", name);
  b.type = "button";
  b.dataset.layer = key;
  b.setAttribute("role", role);
  if (role === "menuitemcheckbox") b.dataset.toggleDot = "";
  b.addEventListener("click", onClick);
  return b;
};
// One switch, flipped from the menu or the site view's row of layer buttons (index.html, the same
// layers in the same order).
const flipLayer = (key) => key === "shadow" ? setLayers(layers.map, !layers.shadow) : setLayers(layers.map === key ? "" : key, layers.shadow);
layerMenu.replaceChildren(
  ...FILLS.map(([key, name]) => layerRow(key, name, "menuitemcheckbox", () => flipLayer(key))),
  layerRow("shadow", "Permanent shadow", "menuitemcheckbox", () => flipLayer("shadow")),
  layerRow("", "All off", "menuitem", () => { setLayers("", false); layerMenu.hidePopover(); }),
);
const layerRowBtns = [...$("layer-row").querySelectorAll("[data-layer]")];
layerRowBtns.forEach((b) => b.addEventListener("click", () => flipLayer(b.dataset.layer)));
function setLayers(map, shadow) {
  layers.map = map;
  layers.shadow = shadow;
  try { localStorage.setItem(LAYER_KEY, [map, shadow ? "shadow" : ""].filter(Boolean).join("+")); } catch { /* kept for this visit only */ }
  showMapLayer();
  sendLayers();
}
// The menu's checks, the row's pressed buttons, and the key: a line for each layer that is on.
function showMapLayer() {
  const isOn = (key) => key === "shadow" ? layers.shadow : key === layers.map;
  layerMenu.querySelectorAll("[role=menuitemcheckbox]").forEach((b) => b.setAttribute("aria-checked", String(isOn(b.dataset.layer))));
  layerRowBtns.forEach((b) => b.setAttribute("aria-pressed", String(isOn(b.dataset.layer))));
  const on = Boolean(layers.map || layers.shadow);
  layerMenu.querySelector('[role=menuitem]').disabled = !on;
  layersBtn.setAttribute("aria-pressed", String(on));
  layerKey.hidden = !on || !layerIndex;
  if (layerKey.hidden) return;
  const L = layerIndex.layers, swatch = (cls, text) => { const s = el("span"); s.append(el("i", cls), text); return s; };
  // Sunlight and shadow have published maps only towards the poles: the key says where not.
  const gap = (id) => { const cov = L[id]?.coverageDeg; return cov ? [el("span", "", `No data between ${Math.abs(cov.south)}°S and ${cov.north}°N`)] : []; };
  const line = (title, ...parts) => { const row = el("div", "layer-line"); row.append(...parts); if (title) row.title = title; return row; };
  const lines = [];
  if (layers.map === "slope") {
    lines.push(line("On the globe, slope is measured over kilometres (finer near the south pole), so it reads gentler than over 100 m in a site view.",
      el("b", "", "Slope"), ...L.slope.bands.map((band) => swatch(`l${band.value}`, band.label)), el("span", "", `Over ${L.slope.landingLimitDeg}°: too steep to land`)));
  } else if (layers.map === "sunlight") {
    const ramp = el("span");
    ramp.append("0%", el("i", "ramp"), "100%");
    lines.push(line("Average share of time the Sun is up at ground level over 18.6 years (NASA PGDA, Mazarico et al. 2011). The forecast's Sun hours are for 2 m above the ground over one year, so the two differ.",
      el("b", "", "Sunlight"), ramp, el("span", "", "ground level, 18.6-year average"), ...(layers.shadow ? [] : gap("sunlight"))));
  }
  // Sunlight and shadow share their coverage: with both on, the note ends the shadow line only.
  if (layers.shadow) lines.push(line("", swatch("ls", "Outlined: permanently shadowed, never sunlit"), ...gap("shadow")));
  layerKey.replaceChildren(...lines);
}
getJSON("data/layers/index.json").then((index) => { layerIndex = index; showMapLayer(); }, () => {});
showMapLayer();
if (layers.map || layers.shadow) sendLayers(); // a saved choice (globe.js and site.js load before this module)
// Under the button, right-aligned with it; the checked row takes focus. Arrows move, Escape
// closes only the menu.
layerMenu.addEventListener("beforetoggle", (e) => {
  if (e.newState !== "open") return;
  const r = layersBtn.getBoundingClientRect();
  Object.assign(layerMenu.style, { top: `${r.bottom + 8}px`, right: `${Math.max(8, innerWidth - r.right)}px`, left: "auto" });
});
layerMenu.addEventListener("toggle", (e) => {
  const open = e.newState === "open";
  layersBtn.setAttribute("aria-expanded", String(open));
  if (open) layerMenu.firstElementChild.focus();
});
layerMenu.addEventListener("keydown", (e) => {
  if (e.key === "Escape") e.stopPropagation();
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const rows = [...layerMenu.querySelectorAll("[role^=menuitem]:not(:disabled)")], i = rows.indexOf(document.activeElement);
  rows[(i + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length].focus();
});

// A site whose terrain couldn't be shown (site.js) stays on the globe.
document.addEventListener("tanaw:view", (e) => {
  if (e.detail.view !== "globe" || e.detail.site !== state.site || state.view !== "site") return;
  state.view = "globe";
  render();
});

// A pin tapped on the globe selects that site, like tapping its row.
document.addEventListener("tanaw:pick", (e) => {
  if (!state.data[e.detail.site]) return;
  select(e.detail.site);
});

const sceneSource = createForecastSource();
// Stars reuse the same computation inputs as Observer. Load only while requested;
// coalesce fast scrub/playback updates instead of queuing a worker job per frame.
let starsEnabled = true, wantedStarFrame = null, starFrameRunning = false;
async function updateStarFrame(utc = quickMode ? quickNow() : instant()) {
  if (!starsEnabled) return;
  wantedStarFrame = { utc, site: state.site, estimate: quickMode, emission: quickEmission };
  if (starFrameRunning) return;
  starFrameRunning = true;
  try {
    while (wantedStarFrame && starsEnabled) {
      const frame = wantedStarFrame; wantedStarFrame = null;
      let snapshot = null;
      try {
        if (frame.estimate && frame.emission) {
          snapshot = await sceneSource.sample({ ...frame.emission.selection, instantUtc: frame.utc });
        } else if (!frame.estimate) {
          const months = [...new Set([frame.utc.slice(0, 7), new Date(Math.floor(Date.parse(frame.utc) / 3600000) * 3600000 + 3600000).toISOString().slice(0, 7)])];
          const geometryMonthly = {};
          await Promise.all(months.map(async month => { sunGeo(month); geometryMonthly[month] = await smooth.geo.get(month); }));
          snapshot = publishedGeometry({ index: state.data[frame.site].forecast, geometryMonthly }, frame.utc);
        }
      } catch { /* Unsupported orientation stays absent, never guessed from the Sun. */ }
      if (starsEnabled && frame.site === state.site && frame.estimate === quickMode && !wantedStarFrame)
        document.dispatchEvent(new CustomEvent('tanaw:star-sky', { detail: snapshot }));
    }
  } finally { starFrameRunning = false; }
}
document.addEventListener('tanaw:stars-change', e => {
  starsEnabled = e.detail;
  if (starsEnabled) updateStarFrame();
  else { wantedStarFrame = null; document.dispatchEvent(new CustomEvent('tanaw:star-sky', { detail: null })); }
});
for (const name of ['tanaw:select', 'tanaw:time', 'tanaw:directions'])
  document.addEventListener(name, e => updateStarFrame(e.detail.instant));
let quickPanel, quickWindow, quickMode = false, quickUtc, quickEmission, quickGeneration = 0;
function cancelQuick() {
  ++quickGeneration; sceneSource.cancel();
  ring.setAttribute('aria-busy', 'false');
}
function initializeQuick() {
  const params = new URLSearchParams(location.search), requested = params.get('site');
  if (requested) { if (!state.sites.some(s => s.id === requested)) throw new Error('Unknown selected site.'); state.site = requested; }
  if (!requested && params.has('lat') && params.has('lon')) {
    const lat = Number(params.get('lat')), lon = Number(params.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) >= 90 || !params.get('lat') || !params.get('lon')) throw new Error('Invalid selected coordinates');
    const site = {id:`custom-${lat}-${lon}`,name:coordName(lat, lon),lat,lon}; state.sites.push(site); state.site = site.id;
  }
  // No date in the link: the current UTC hour, following the real clock (live).
  const utc = params.get('t') || nowHourUtc();
  if (!params.has('t')) live.on = true;
  quickPanel = createQuickEstimatePanel($('quick-estimate'), { initialUtc: utc, onSelect: pickInstant, onCancel: cancelQuick, published: PUBLISHED });
  if (Date.parse(utc) % 3600000 || !state.data[state.site] || params.get('estimate') === '1' || utc < '2026-12-01' || utc >= '2027-12-01') {
    quickMode = true; loadQuick(utc);
  } else {
    const day = state.data[state.site].forecast.days.findIndex(d => d.date === utc.slice(0, 10));
    if (day >= 0) { parseUtc(utc); if (Date.parse(utc) % 3600000) throw new Error('Select an exact UTC hour.'); state.day = day; state.hour = new Date(utc).getUTCHours(); }
  }
  if (live.on) startLive();
  $("estimate-date").setAttribute("form", "quick-estimate"); // it may sit in the site header, outside the form
  layout(); // the date field now exists: into the header on wider screens
}

// Live time: opened without a date, the instant follows the real clock. Once a minute (not every
// frame) the globe's Sun and Earth move to the current minute, from the computation module's
// interpolation (smoothAt, or the estimate's track); the hour and day step when they change, and
// an estimate is worked out again each hour. Play, the slider, a picked day or date and the Wait
// chip leave live time; confirming today's date in the date picker returns to it.
const live = { on: false, timer: 0 };
// The date button's instant: the live minute while live, else the instant shown.
const shownUtc = (utc) => (live.on ? new Date(Math.floor(Date.now() / 60000) * 60000).toISOString() : utc);
const nowHourUtc = () => new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString();
function startLive() {
  live.on = true;
  clearInterval(live.timer);
  live.timer = setInterval(liveTick, 60000);
  requestAnimationFrame(() => requestAnimationFrame(liveTick)); // once the first screen is drawn
}
function leaveLive() {
  if (!live.on) return;
  live.on = false;
  clearInterval(live.timer);
  // From here the link carries the instant shown (the next render or estimate may set it again).
  const url = new URL(location.href);
  if (!url.searchParams.has('t')) { url.searchParams.set('t', instant()); history.replaceState(null, '', url); }
}
function pickInstant(utc) {
  if (utc.slice(0, 10) === new Date().toISOString().slice(0, 10)) { startLive(); utc = nowHourUtc(); } else leaveLive();
  loadQuick(utc, false, true);
}
function liveTick() {
  if (!live.on || play.on) return;
  const ms = Math.floor(Date.now() / 60000) * 60000, utc = new Date(ms).toISOString(), hourUtc = nowHourUtc();
  const data = state.data[state.site], published = Boolean(data) && utc >= "2026-12-01" && utc < "2027-12-01";
  if (quickMode) {
    if (published && !state.site.startsWith("custom-")) { leaveQuick(hourUtc); return; }
    if (quickEmission && quickEmission.selection.instantUtc !== hourUtc) { loadQuick(hourUtc); return; }
    if (!quickEmission) return;
    try {
      const d = productMoonDirections(quickEmission.data, utc);
      document.dispatchEvent(new CustomEvent("tanaw:directions", { detail: { instant: utc, estimateScene: true, ...d } }));
    } catch { /* outside the estimate's track: the hour's positions stay */ }
    quickPanel?.setDate(utc); // the date button shows the live minute
    return;
  }
  if (!published) { loadQuick(hourUtc); return; }
  const days = data.forecast.days, day = days.findIndex((d) => d.date === utc.slice(0, 10)), hour = new Date(ms).getUTCHours();
  if (day !== state.day) { state.day = day; state.hour = hour; render(); }
  else if (hour !== state.hour) { state.hour = hour; tickHour(); }
  smoothAt(Math.round((ms - Date.parse(`${days[0].date}T00:00:00Z`)) / 60000));
  quickPanel?.setDate(utc); // the date button shows the live minute
}
function renderQuickTimeline() {
  const selected = quickWindow.state;
  slider.max = String(selected.length - 1); slider.step = '1'; slider.value = String(selected.offset);
  slider.style.removeProperty('--go-track');
  slider.setAttribute('aria-valuetext', `${dateLabel(selected.instantUtc.slice(0,10))}, ${selected.instantUtc.slice(11,16)} UTC`);
  const label = dateLabel(selected.instantUtc.slice(0, 10));
  dayOut.textContent = phone.matches ? `${label.split(' ').slice(1, 3).join(' ')}, ${selected.instantUtc.slice(11, 16)} UTC` : slider.getAttribute('aria-valuetext');
  quickPanel.setDate(shownUtc(selected.instantUtc));
}
// The published forecast's first and last days (the date picker marks them; Today stays inside).
const PUBLISHED = ['2026-12-01', '2027-11-30'];
// "1 Dec 2026 · 00:00 UTC", the bar's own format.
function instantText(utc) {
  const [date, time] = [utc.slice(0, 10), utc.slice(11, 16)], d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${time} UTC`;
}
// A date inside the published year at a listed site is the normal view, not an estimate.
function publishedDate(utc) {
  return !!state.data[state.site] && utc >= '2026-12-01' && utc < '2027-12-01';
}
function leaveQuick(utc, window = null) {
  cancelQuick(); quickMode = false; quickEmission = null;
  playBtn.hidden = false; timesBtn.disabled = compareBtn.disabled = false; ring.hidden = false;
  delete document.documentElement.dataset.forecastQuality;
  const days = state.data[state.site].forecast.days, day = days.findIndex(d => d.date === utc.slice(0, 10));
  if (day >= 0) {
    state.day = day; state.hour = new Date(parseUtc(utc)).getUTCHours();
    // A picked date starts the window (Wait and Move jumps place the day a third of the way in).
    if (window) state.len = window.days;
    state.ws = Math.max(0, Math.min(window ? days.findIndex(d => d.date === window.startUtc.slice(0, 10)) : day - (travelTrip?.site === state.site ? 7 : 0), days.length - state.len));
  }
  const form = $('quick-estimate'), site = state.sites.find(s => s.id === state.site);
  form.setAttribute('aria-busy', 'false'); form.classList.add('published');
  $('estimate-status').textContent = 'Accurate forecast loaded.';
  form.querySelector('[data-result]').textContent = `Accurate forecast · ${site.name} · ${utc.slice(0, 10)} UTC`;
  const url = new URL(location.href);
  for (const key of ['estimate', 'lat', 'lon']) url.searchParams.delete(key);
  url.searchParams.set('site', state.site); url.searchParams.set('t', new Date(parseUtc(utc)).toISOString());
  if (live.on) url.searchParams.delete('t'); // live time stays out of the link, so it reopens live
  history.replaceState(null, '', url);
  render();
}
async function loadQuick(utc, keepWindow = false, fromPicker = false, playback = false) {
  // A whole hour inside the published year at a listed site is the normal view: always from the
  // picker's Confirm (from the normal view or from an estimate), and from the slider while not
  // already in estimate mode.
  const tripCrossesCoverage = travelTrip?.site === state.site &&
    (Date.parse(travelTrip.startUtc) - 7 * 86400000 < Date.parse('2026-12-01T00:00:00Z') ||
     Date.parse(travelTrip.endUtc) + 7 * 86400000 > Date.parse('2027-12-01T00:00:00Z'));
  if ((fromPicker || !quickMode) && !tripCrossesCoverage && publishedDate(utc) && Date.parse(utc) % 3600000 === 0) { leaveQuick(utc); return; }
  const requestedRange = quickMode && quickWindow ? quickWindow.state.rangeDays : state.len;
  $('quick-estimate').classList.remove('published');
  cancelQuick(); const own = quickGeneration;
  if (!playback) pause(); ++ringRequest; quickMode = true; quickUtc = utc;
  if (!quickEmission) renderForecastPanel();
  playBtn.hidden = false; compareBtn.disabled = false;
  ring.setAttribute('aria-busy', 'true'); wait.replaceChildren(); move.replaceChildren();
  const site = state.sites.find(s => s.id === state.site);
  quickPanel.loading(utc, quickEmission?.selection.id !== site.id ? `Preparing forecast for ${site.name}…` : 'Updating forecast…');
  if (!state.tiles[site.id] && quickEmission?.selection.id !== site.id) {
    state.view = 'globe'; hud.classList.remove('site'); view3d.hidden = true;
    document.dispatchEvent(new CustomEvent('tanaw:preview-site', { detail: { site: site.id, sites: state.sites, focus: state.focus, view: 'globe' } }));
  }
  if (!quickEmission && !clock.firstElementChild) call.textContent = 'Updating forecast…';
  try {
    const at = parseUtc(utc);
    if (!keepWindow) {
      const length = requestedRange;
      const contextStart = travelTrip?.site === state.site && Date.parse(utc) === Date.parse(travelTrip.startUtc)
        ? new Date(Math.max(QUICK_RANGE.start, Date.parse(utc) - 7 * 86400000)).toISOString() : utc;
      quickWindow = createDateWindow(new Date(QUICK_RANGE.start).toISOString(), new Date(QUICK_RANGE.end).toISOString(), contextStart, {fromSelection:true});
      quickWindow.range(length);
      quickWindow.seek(utc);
    }
    const length = quickWindow.state.length;
    const end = Date.parse(quickWindow.state.endUtc) + 86400000;
    const start = Math.min(Date.parse(quickWindow.state.startUtc), QUICK_RANGE.end - RING_DAYS * 86400000);
    renderQuickTimeline();
    await sceneSource.load({id:site.id,name:site.name,lat:site.lat,lon:site.lon,instantUtc:new Date(at).toISOString(),
      startUtc:new Date(start).toISOString(),endUtc:new Date(end).toISOString()}, emission => {
      if (own !== quickGeneration) return;
      quickEmission = emission; renderQuick(); quickPanel.show(emission, emission.selection.instantUtc); quickPanel.setDate(shownUtc(emission.selection.instantUtc));
    });
  } catch (error) {
    if (own !== quickGeneration) return;
    quickPanel.error(error.message); if (!quickEmission) call.textContent = error.message;
    document.dispatchEvent(new CustomEvent('tanaw:preview-site', { detail: { failed: true } }));
  } finally {
    if (own === quickGeneration) ring.setAttribute('aria-busy', 'false');
  }
}
let quickRing = null; // { base, start }: the clock's hour index at its first day (setNow)
function renderQuickRing(snapshot, utc = quickEmission.selection.instantUtc) {
  const { data, quality, selection } = quickEmission;
  const dayStart = Date.parse(`${utc.slice(0, 10)}T00:00:00Z`);
  const start = Math.max(Date.parse(selection.startUtc), Math.min(dayStart - 14 * 86400000, Date.parse(selection.endUtc) - RING_DAYS * 86400000));
  const end = start + RING_DAYS * 86400000;
  const months = Object.values(data.monthly).filter(m => Date.parse(m.start) < end &&
    Date.parse(m.start) + m.sunAz.length * 3600000 > start).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const hourly = {};
  for (const b of Object.values(BODIES)) for (const f of [b.az, b.el, b.visible]) hourly[f] = months.flatMap(m => m[f]);
  const base = (start - Date.parse(months[0].start)) / 3600000;
  const day = data.index.days.find(d => d.date === utc.slice(0, 10));
  const dayIndex = (Date.parse(`${day.date}T00:00:00Z`) - start) / 86400000;
  quickRing = { base, start };
  const mark = { i: base + dayIndex * 24 + (Date.parse(utc) % 86400000) / 3600000, bodies: ['sun', 'earth'], positions: snapshot.bodies };
  sky = { site: data.index.id, mark };
  ring.hidden = false;
  ring.dataset.quality = quality;
  ring.dataset.instant = utc;
  ring.setAttribute('aria-busy', 'false');
  ring.querySelector('h2').textContent = quality === 'estimate' ? 'Sky from the site · Estimate' : 'Sky from the site';
  ring.setAttribute('aria-label', `Sky from the site · ${quality === 'estimate' ? 'Estimate' : 'Accurate forecast'} · ${utc}`);
  clock.replaceChildren(drawRing(hourly, base, 0, day, dayIndex, data.horizon));
  clock.firstElementChild.setNow(mark.i, mark.bodies, mark.positions);
  stripArgs = [hourly, base, 0, day, dayIndex, data.horizon];
  drawSide();
}
function renderQuick() {
  comparison?.sync();
  renderForecastPanel(); // the estimate's days, labelled "Estimate"
  if (!quickEmission || quickEmission.selection.id !== state.site) return;
  sendTrack();
  const {data,quality,selection} = quickEmission, utc = selection.instantUtc;
  const site = state.sites.find(s => s.id === selection.id), snapshot = productSnapshot(data,utc);
  const directions = productMoonDirections(data,utc);
  const inSite = state.view === 'site' && Boolean(state.tiles[site.id]);
  state.view = inSite ? 'site' : 'globe';
  hud.classList.toggle('site', inSite); hud.classList.remove('hour'); view3d.hidden = !inSite; $("show-spots").hidden = !state.grids.sites[site.id]; showSiteName(site.name);
  renderQuickDay(utc, snapshot);
  timesBtn.disabled = false;
  semBtn.hidden = inSite; semBox.hidden = !inSite; (inSite ? semBox : semBtn).append(semSvg);
  semLast = { instant: utc, directions };
  orbit.instant = utc;
  const sunCentre = semCentreBtns.find(b => b.dataset.centre === 'sun');
  sunCentre.disabled = false; sunCentre.title = ''; // the Sun centre works on every date (applyOrbit)
  renderPanel(site); spotsBox.hidden = true; layout();
  document.dispatchEvent(new CustomEvent('tanaw:select', {detail:{site:site.id,sites:state.sites,date:utc.slice(0,10),instant:utc,
    focus:state.focus,view:state.view,tile:state.tiles[site.id] || null,terrain:Object.keys(state.tiles),estimateScene:true,directions}}));
  quickSky(utc, snapshot);
  const url = new URL(location.href); if (site.id.startsWith('custom-')) { url.searchParams.delete('site'); url.searchParams.set('lat',site.lat); url.searchParams.set('lon',site.lon); } else { url.searchParams.set('site',site.id); url.searchParams.delete('lat'); url.searchParams.delete('lon'); } url.searchParams.set('t',utc); url.searchParams.set('estimate','1');
  if (live.on) { url.searchParams.delete('t'); url.searchParams.delete('estimate'); } // live time stays out of the link, so it reopens live
  history.replaceState(null,'',url);
}
// The estimate's call, clock, times and status line for one instant (renderQuick, and each day
// of smooth autoplay).
function renderQuickDay(utc, snapshot) {
  const { data, quality } = quickEmission;
  const label = quality === 'estimate' ? 'Estimate' : snapshot.interpolated ? 'Accurate forecast (interpolated)' : 'Accurate forecast';
  const qDay = data.index.days.find(d => d.date === utc.slice(0, 10));
  if (qDay && Number.isFinite(qDay.sunHours) && Number.isFinite(qDay.earthHours)) {
    // Keep the header focused on the call; forecast quality remains below the play bar.
    const go = isGo(qDay), dot = el('span', go ? 'dot' : 'dot no');
    dot.setAttribute('aria-hidden', 'true');
    call.replaceChildren(dot, el('span', 'verdict', go ? 'Go' : 'No-go'), el('span', 'why', ` · ${why(qDay)}`));
  } else call.textContent = 'Daily summary unavailable.';
  $('moon').setAttribute('aria-label', `Moon viewer · ${label} · ${call.textContent}`);
  document.documentElement.dataset.forecastQuality = quality;
  renderQuickRing(snapshot, utc);
  times.dataset.quality = sem.dataset.quality = quality;
  times.dataset.instant = sem.dataset.instant = utc;
  times.setAttribute('aria-label', `Rise and set times · ${label} · ${utc}`);
  renderTimes(qDay, data.index);
  atLine.hidden = false;
  atLine.textContent = `${label} · ${instantText(utc)}`;
}
// The site view's lighting and the globe's Earth contact at one instant. Away from the engine's
// own instant the snapshot has no local Sun vector; the site view then uses the azimuth and height.
function quickSky(utc, snapshot) {
  document.dispatchEvent(new CustomEvent('tanaw:sky', {detail:{site:quickEmission.selection.id,hour:utc,
    sunDirectionLocal:snapshot.lighting?.sunDirectionLocal,
    sunAz:snapshot.bodies.sun.azimuthDeg,sunEl:snapshot.bodies.sun.elevationDeg,sunVisible:snapshot.bodies.sun.centerVisible,
    earthAz:snapshot.bodies.earth.azimuthDeg,earthEl:snapshot.bodies.earth.elevationDeg,earthVisible:snapshot.bodies.earth.centerVisible,
    now:{instant:utc,earthVisible:snapshot.bodies.earth.centerVisible}}}));
  thumbFill(snapshot.bodies.sun.centerVisible, snapshot.bodies.earth.centerVisible);
}
window.addEventListener('pagehide', () => { cancelQuick(); sceneSource.dispose(); quickPanel?.dispose(); }, {once:true});
// Travel is an additive host-owned controller. The existing forecast remains the sole scene
// date/location owner; Travel's full-stay screening is separate from the example daily Go rule.
function compareTravelPoint(point) {
  return { ...point, id: point.id || `custom-${point.lat}-${point.lon}` };
}
function travelSelection() {
  return { point: state.sites.find(s => s.id === state.site), instantUtc: instant() };
}
async function selectTravelResult({ point, startUtc, endUtc }) {
  pause();
  leaveLive(); // a trip is a picked date
  const known = state.sites.find(s => Math.abs(s.lat - point.lat) < 1e-7 && Math.abs(((s.lon - point.lon + 540) % 360) - 180) < 1e-7);
  const selected = known || { ...point, id: `custom-${point.lat}-${point.lon}`, name: point.name || coordName(point.lat, point.lon) };
  if (!known) state.sites.push(selected);
  state.site = selected.id; state.focus = false; state.view = 'globe';
  travelTrip = { site: selected.id, startUtc, endUtc };
  // Calendar-day context surrounds the exact travel interval. The white selection remains
  // at arrival; the separate outline keeps the trip visible while scrubbing nearby days.
  state.len = Math.ceil(Date.parse(endUtc) / 86400000) - Math.floor(Date.parse(startUtc) / 86400000) + 14;
  // An explicit trip takes precedence over a previous quick range; ordinary range controls
  // retain their existing 30/91/365 options after this selection.
  quickWindow = null;
  fpOpen = !phone.matches;
  rangePicker.setValue(state.len);
  await loadQuick(startUtc, false, true);
  frame();
}
document.addEventListener('tanaw:select', event => {
  const point = event.detail.sites.find(s => s.id === event.detail.site);
  travel?.sync({ point, instantUtc: event.detail.instant });
});
document.addEventListener('tanaw:time', event => {
  if (!event.detail.smooth) travel?.sync({ point: state.sites.find(s => s.id === state.site), instantUtc: event.detail.instant });
});
load().then(() => {
  comparison = createComparePanel({ root: compare, selection: travelSelection, window: compareWindow,
    onChange: comparisonChanged, pickDay(date) {
      pause();
      if (quickMode) {
        quickWindow.select(Math.round((Date.parse(date) - Date.parse(quickWindow.state.startUtc)) / 86400000));
        loadQuick(quickWindow.state.instantUtc, true);
      } else {
        state.day = state.data[state.site].forecast.days.findIndex(d => d.date === date);
        state.hour = null; render();
      }
    } });
  window.addEventListener('pagehide', () => comparison.close(), { once: true });
  start();
  travel = createTravelPanel({
    selection: travelSelection, catalog: () => state.sites.filter(s => state.data[s.id]),
    select(result) {
      if (comparison?.fromTravel && comparison.picking) comparison.add(compareTravelPoint(result.point));
      return selectTravelResult(result);
    },
    frame,
    comparing: () => !!comparison?.fromTravel,
    compareAction: point => comparison?.fromTravel ? comparison.action(point) : 'Compare',
    resetComparison() { if (comparison?.fromTravel) setCompare(false); },
    compare(result) {
      const point = compareTravelPoint(result.point);
      if (!comparison.active) { setCompare(true, result); }
      else if (comparison.contains(point)) comparison.remove(point);
      else comparison.add(point);
    },
    wholeMoon() { wholeMoon(); document.dispatchEvent(new CustomEvent('tanaw:frame-moon')); },
    open() { pause(); setCompare(false); if (hud.classList.contains('picker')) closePicker(); wholeMoon(); }
  });
  // Travel's button as an icon (Tabler route), like the top bar's: in the top bar after Layers on
  // wider screens, in the bottom bar on phones, where the top bar has no room (layout).
  const travelBtn = $("travel-btn");
  if (travelBtn) {
    travelBtn.classList.add("icon");
    travelBtn.setAttribute("aria-label", "Travel");
    travelBtn.dataset.tip = "Travel";
    travelBtn.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 19a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M19 7a2 2 0 1 0 0 -4a2 2 0 0 0 0 4"/><path d="M11 19h5.5a3.5 3.5 0 0 0 0 -7h-8a3.5 3.5 0 0 1 0 -7h4.5"/></svg>`;
    layout();
  }
}).catch(fail);
