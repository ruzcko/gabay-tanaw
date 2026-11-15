import { createObserverView, createSnapshotLoader } from './index.js';
import { createStaticForecastProvider, toObserverViewSnapshot } from '../computation/dist/index.js';

/** Map callbacks and the host playback clock call update; no second clock is created. */
export function connectObserver({ container, computationProvider, terrainProvider, assetProvider, onSiteSelect, onTerrainStatus, onError, onStatusChange, onSnapshot }) {
  const ownedProvider = computationProvider ? null : createStaticForecastProvider();
  const provider = computationProvider || ownedProvider;
  const view = createObserverView({ container, terrainProvider, assetProvider, onSiteSelect, onTerrainStatus, onError });
  const loader = createSnapshotLoader({
    computationProvider: { observe: async request => toObserverViewSnapshot(await provider.observe(request)) },
    observer: { setSnapshot(snapshot) {
      const accepted = view.setSnapshot(snapshot);
      if (accepted !== false) onSnapshot?.(snapshot);
      return accepted;
    } }, onError, onStatusChange
  });
  return {
    view,
    update: (selectedSite, instantUtc) => loader.load(selectedSite, instantUtc),
    dispose() { loader.dispose(); ownedProvider?.dispose(); view.dispose(); }
  };
}
