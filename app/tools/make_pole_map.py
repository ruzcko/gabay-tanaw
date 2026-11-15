"""Make the south-pole relief texture from LOLA polar stereographic elevation.

Usage: python -I make_pole_map.py <lola_img> <color_webp> <out_dir>
Output keeps the source projection (south polar stereographic, lon 0 towards the
top of the image, east to the right), resized to OUT x OUT, as object-space normals.
"""
import sys
import numpy as np
from PIL import Image

src, color_path, out = sys.argv[1:4]
N, S, R = 3812, 240.0, 1737400.0
OUT = 2048
EXAG = 3.0

h = np.fromfile(src, dtype="<i2").reshape(N, N).astype(np.float32) * 0.5
h = np.asarray(Image.fromarray(h, "F").resize((OUT, OUT), Image.BOX), dtype=np.float64)
px = N * S / OUT

idx = np.arange(OUT) + 0.5 - OUT / 2
x = idx[None, :] * px                  # east-ish, along image columns
y = -idx[:, None] * px                 # towards lon 0, up the image
r = np.hypot(x, y)
lon = np.arctan2(x, y)
lat = 2 * np.arctan(r / (2 * R)) - np.pi / 2

# Globe object space: lon 0 on +x, east towards -z, north pole +y
u = np.stack([np.cos(lat) * np.cos(lon), np.sin(lat), -np.cos(lat) * np.sin(lon)], -1)
P = (R + EXAG * h)[..., None] * u

dPx = np.zeros_like(P)
dPy = np.zeros_like(P)
dPx[:, 1:-1] = P[:, 2:] - P[:, :-2]
dPx[:, 0], dPx[:, -1] = P[:, 1] - P[:, 0], P[:, -1] - P[:, -2]
dPy[1:-1] = P[:-2] - P[2:]
dPy[0], dPy[-1] = P[0] - P[1], P[-2] - P[-1]
n = np.cross(dPx, dPy)
n /= np.linalg.norm(n, axis=-1, keepdims=True)
if np.mean(np.sum(n * u, -1)) < 0:
    n = -n

n8 = ((n * 0.5 + 0.5) * 255).round().clip(0, 255).astype(np.uint8)
Image.fromarray(n8, "RGB").save(f"{out}/moon-pole-normal-2k.webp", quality=90, method=6)

# Mean surface colour between 80 and 84 degrees south, for the pole's flat albedo
c = np.asarray(Image.open(color_path).convert("RGB"), dtype=np.float64)
H = c.shape[0]
band = c[int((90 + 80) / 180 * H):int((90 + 84) / 180 * H)]
print("half extent (unit radius):", N * S / 2 / R)
print("mean colour 80-84S (sRGB 0-255):", band.reshape(-1, 3).mean(0).round(1))
