import type { ObserverConfig, ObserverView, ObserverSnapshot } from './contract';
import type { ForecastSelection } from '../computation/src/static-forecast';

/** Host coordinates are DE421 mean-Earth; no ID is required. Time must be explicit ISO UTC. */
export function connectObserver(config: Omit<ObserverConfig, 'onStatusChange'> & {
  computationProvider?: { observe(request: { site: ForecastSelection; instantUtc: string; signal: AbortSignal }): Promise<ObserverSnapshot> };
  onStatusChange?: (status: 'loading' | 'ready' | 'error') => void;
  onSnapshot?: (snapshot: ObserverSnapshot) => void;
}): {
  view: ObserverView;
  update(selectedSite: ForecastSelection, instantUtc: string): Promise<boolean>;
  dispose(): void;
};
