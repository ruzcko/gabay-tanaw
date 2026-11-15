/** Local orthographic elevation patch: +X east, +Z south; heights above datum sphere. */
import { sameLongitude } from '../computation/dist/core.js';

export function buildTerrainGrid(tile, site, exaggeration = 1) {
  const { width, height, spacingM, elevationsM, metadata } = tile;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3 || width > 513 || height > 513 || width % 2 !== 1 || height % 2 !== 1) throw new Error('Terrain grids must have odd dimensions from 3 to 513');
  if (!Number.isFinite(spacingM) || spacingM <= 0 || elevationsM.length !== width * height) throw new Error('Invalid terrain spacing or samples');
  if(tile.axisM && (width!==height || tile.axisM.length!==width || tile.axisM[(width-1)/2]!==0 || !tile.axisM.every((v,i,a)=>Number.isFinite(v)&&(!i||v>a[i-1])))) throw new Error('Invalid terrain axis');
  if (metadata.referenceFrame !== site.referenceFrame || metadata.elevationDatum !== site.elevationDatum) throw new Error('Terrain frame/datum does not match the observer');
  if (metadata.projection !== 'local-orthographic-east-south' || metadata.latitudeDeg !== site.latitudeDeg || !sameLongitude(metadata.longitudeEastDeg, site.longitudeEastDeg)) throw new Error('Terrain must be resampled around the requested site');
  const radius = metadata.radiusM;
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(exaggeration) || exaggeration < 1 || exaggeration > 10) throw new Error('Invalid radius or exaggeration');
  const center = ((height - 1) / 2) * width + (width - 1) / 2;
  const valid = value => Number.isFinite(value) && value !== metadata.noData;
  if (!valid(elevationsM[center])) throw new Error('Terrain has no elevation at observer position');
  const groundElevationM = elevationsM[center];
  // Never silently move the observer used by the computation system.
  if (Math.abs(groundElevationM - site.surfaceElevationM) > 0.01) throw new Error(`Terrain ground is ${groundElevationM} m; host must recompute snapshot at this surface elevation`);
  const positions = new Float32Array(width * height * 3), normals = new Float32Array(positions.length), uv = new Float32Array(width * height * 2), indices = [];
  let validCount = 0;
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const i = row * width + col, x = tile.axisM?.[col] ?? (col - (width - 1) / 2) * spacingM, z = tile.axisM?.[row] ?? (row - (height - 1) / 2) * spacingM;
    if (x*x + z*z >= radius*radius) throw new Error('Terrain patch exceeds local projection hemisphere');
    const elevation = valid(elevationsM[i]) ? elevationsM[i] : groundElevationM;
    if (valid(elevationsM[i])) validCount++;
    const surfaceRadius = radius + groundElevationM + (elevation - groundElevationM) * exaggeration;
    const scale = surfaceRadius / radius;
    positions.set([x * scale, Math.sqrt(radius*radius - x*x - z*z) * scale - radius - groundElevationM, z * scale], i * 3);
    uv.set(tile.uv ? [tile.uv[i*2],tile.uv[i*2+1]] : [col / (width - 1), 1 - row / (height - 1)], i * 2);
  }
  const triangle = (a, b, c) => {
    if (![a,b,c].every(i => valid(elevationsM[i]))) return;
    indices.push(a,b,c);
    const u = [0,1,2].map(k => positions[b*3+k] - positions[a*3+k]), v = [0,1,2].map(k => positions[c*3+k] - positions[a*3+k]);
    const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    for (const i of [a,b,c]) for (let k=0;k<3;k++) normals[i*3+k] += n[k];
  };
  for (let row=0;row<height-1;row++) for (let col=0;col<width-1;col++) { const a=row*width+col; triangle(a,a+width,a+1); triangle(a+1,a+width,a+width+1); }
  for (let i=0;i<normals.length;i+=3) { const length=Math.hypot(...normals.subarray(i,i+3)); if (length) for(let k=0;k<3;k++) normals[i+k]/=length; else normals[i+1]=1; }
  return { positions, normals, uv, indices: new Uint32Array(indices), coverage: validCount/(width*height), resolutionM: spacingM, groundElevationM };
}
