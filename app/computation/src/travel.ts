/** Travel: UI-independent lunar region screening and arrival-date planning. */
import { createLandingPlanner } from './landing.ts';
import type { LandingSource, LandingPlannerOptions } from './landing.ts';
import { createLandingSource } from './landing-source.ts';

export * from './landing.ts';
export { nearestLunarFeature } from './catalog.ts';
export { LANDING_DEFAULTS as TRAVEL_DEFAULTS } from './landing.ts';
export { createLandingSource as createTravelSource } from './landing-source.ts';

/** Provide a source for tests/offline data, or use the published/quick source policy. */
export function createTravelPlanner(source:LandingSource=createLandingSource(),options:LandingPlannerOptions={}) {
  return createLandingPlanner(source,options);
}
