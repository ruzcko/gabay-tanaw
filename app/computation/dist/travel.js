/** Travel: UI-independent lunar region screening and arrival-date planning. */
import { createLandingPlanner } from './landing.js';

import { createLandingSource } from './landing-source.js';

export * from './landing.js';
export { nearestLunarFeature } from './catalog.js';
export { LANDING_DEFAULTS as TRAVEL_DEFAULTS } from './landing.js';
export { createLandingSource as createTravelSource } from './landing-source.js';

/** Provide a source for tests/offline data, or use the published/quick source policy. */
export function createTravelPlanner(source              =createLandingSource(),options                      ={}) {
  return createLandingPlanner(source,options);
}
