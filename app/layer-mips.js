// A flag layer's texture (data/layers/shadow-south.png and shadow-north.png) with its mip chain built by maximum instead of
// average, so a shadowed crater a few pixels wide still shows when the map is zoomed out, where
// averaging (and 8-bit rounding) would lose it. No data (255) counts only where a texel has no
// flag value at all. Rows are stored bottom-up, so the texture reads like an image with flipY.
import * as THREE from 'three';

// global: an equirectangular map, which wraps round in longitude and need not be square.
export async function loadMaxMipTexture(url, global = false) {
  const img = await new THREE.ImageLoader().loadAsync(url);
  const W = img.width, H = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const rgba = g.getImageData(0, 0, W, H).data;
  let level = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) level[(H - 1 - y) * W + x] = rgba[(y * W + x) * 4];
  const mipmaps = [{ data: level, width: W, height: H }];
  for (let w = W, h = H; w > 1 || h > 1;) {
    const w2 = Math.max(1, w >> 1), h2 = Math.max(1, h >> 1), next = new Uint8Array(w2 * h2);
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
      let best = 255;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const v = level[Math.min(h - 1, y * 2 + dy) * w + Math.min(w - 1, x * 2 + dx)];
        if (v !== 255) best = best === 255 ? v : Math.max(best, v);
      }
      next[y * w2 + x] = best;
    }
    mipmaps.push({ data: next, width: w2, height: h2 });
    level = next; w = w2; h = h2;
  }
  const t = new THREE.DataTexture(mipmaps[0].data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  if (global) t.wrapS = THREE.RepeatWrapping;
  t.mipmaps = mipmaps;
  t.generateMipmaps = false;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
