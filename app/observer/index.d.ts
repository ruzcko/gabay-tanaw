import type { ObserverConfig, ObserverView, ObserverSnapshot, LunarSite } from './contract.js';
import type { ForecastSelection } from '../computation/src/static-forecast';
export type * from './contract.js';
export function createObserverView(config: ObserverConfig): ObserverView;
export function createSnapshotLoader<Selection extends ForecastSelection = LunarSite>(config: {
  computationProvider: { observe(request: { site: Selection; instantUtc: string; signal: AbortSignal }): Promise<ObserverSnapshot> };
  observer: Pick<ObserverView, 'setSnapshot'>;
  onError?: (error: Error) => void;
  onStatusChange?: (status: 'loading' | 'ready' | 'error') => void;
}): { load(site: Selection, instantUtc: string): Promise<boolean>; dispose(): void };
