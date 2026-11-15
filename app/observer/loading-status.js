import { formatLatLon } from './math.js';
/** Presentation only: callers report actual work, never elapsed-time progress. */
export function createLoadingStatus(element, region) {
  element.setAttribute('role', 'status');
  element.setAttribute('aria-atomic', 'true');
  const indicator = document.createElement('span');
  indicator.className = 'loading-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  element.replaceChildren(indicator, label);
  return {
    set(message, busy = false) {
      if (label.textContent !== message) label.textContent = message;
      element.classList.toggle('is-loading', busy);
      region?.setAttribute('aria-busy', String(busy));
    }
  };
}

export function displayedScene(snapshot) {
  if (!snapshot) return 'No observation displayed yet.';
  const { site, instantUtc } = snapshot;
  const name = site.name || site.id;
  const coordinates = site.id.startsWith('custom-')
    ? ` (${formatLatLon(site.latitudeDeg, site.longitudeEastDeg)})` : '';
  return `Still showing ${name}${coordinates} · ${instantUtc.slice(0, 16).replace('T', ' ')} UTC.`;
}
