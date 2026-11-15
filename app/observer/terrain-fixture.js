/** Analytic test relief; deliberately not NASA data or a real landing site. */
export const syntheticTerrainProvider = {
  async loadTile({ site, level, signal }) {
    signal.throwIfAborted();
    const width = level === 0 ? 33 : 129, spacingM = 4096 / (width - 1), elevationsM = new Float32Array(width*width);
    for(let row=0;row<width;row++) for(let col=0;col<width;col++) {
      const x=(col-(width-1)/2)*spacingM, z=(row-(width-1)/2)*spacingM;
      const hill = (x,z) => 100*Math.exp(-((x-400)**2+(z+700)**2)/90000);
      elevationsM[row*width+col] = site.surfaceElevationM + hill(x,z)-hill(0,0);
    }
    return { width, height: width, spacingM, elevationsM, metadata: { projection: 'local-orthographic-east-south', latitudeDeg: site.latitudeDeg, longitudeEastDeg: site.longitudeEastDeg, referenceFrame: site.referenceFrame, elevationDatum: site.elevationDatum, radiusM: 1737400, noData: null, source: 'Synthetic analytic terrain fixture', license: 'Project-authored, Apache-2.0' } };
  }
};
