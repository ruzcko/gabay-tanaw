/** Display approximation only: align relief to the authoritative ground height.
 * Neither the observation site nor its scientific horizon/visibility is changed. */
export function alignCoarseDisplayTerrain(tile, site, detailed = false) {
  const copy = structuredClone(tile), { metadata, elevationsM, width, height } = copy;
  if (metadata.referenceFrame !== site.referenceFrame || metadata.elevationDatum !== site.elevationDatum ||
      metadata.latitudeDeg !== site.latitudeDeg || metadata.longitudeEastDeg !== site.longitudeEastDeg ||
      width % 2 !== 1 || height % 2 !== 1 || elevationsM.length !== width * height ||
      !elevationsM.every(Number.isFinite) || !Number.isFinite(site.surfaceElevationM))
    throw new Error('Display terrain does not match the selected location.');
  const center = ((height - 1) / 2) * width + (width - 1) / 2;
  const offset = site.surfaceElevationM - elevationsM[center];
  for (let i = 0; i < elevationsM.length; i++) elevationsM[i] += offset;
  metadata.source += detailed ? ' · detailed display anchored to forecast ground' : ' · coarse display anchored to forecast ground';
  metadata.detailAvailable = detailed;
  metadata.displayGroundOffsetM = offset;
  return copy;
}
