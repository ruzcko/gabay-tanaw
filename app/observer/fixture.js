/** Synthetic rendering fixture, not ephemeris output or a real terrain site. */
export function fixture(overrides = {}) {
  return {
    site: { id: 'Synthetic equatorial site', latitudeDeg: 0, longitudeEastDeg: 0, surfaceElevationM: 0, observerHeightM: 1.7, referenceFrame: 'fixture-radial-moon', elevationDatum: 'fixture-sphere-1737400m' },
    instantUtc: '2026-11-14T00:00:00Z', directionKind: 'geometric',
    bodies: { sun: { azimuthDeg: 90, elevationDeg: 12, rangeKm: 149600000, angularDiameterDeg: 0.53 }, earth: { azimuthDeg: 0, elevationDeg: 20, rangeKm: 384400, angularDiameterDeg: 1.9 } },
    provenance: { source: 'Synthetic fixture', model: 'Hand-authored rendering checks; no scientific predictions' },
    ...overrides
  };
}
