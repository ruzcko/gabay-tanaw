"""Convert NASA SVS CGI Moon Kit maps into web textures for the globe.

Usage: python -I make_moon_maps.py <raw_dir> <out_dir>
Writes moon-color-4k.webp (sRGB colour) and moon-normal-4k.webp (object-space
normals from LOLA heights, relief exaggerated by EXAG).
"""
import sys
import numpy as np
import tifffile
from PIL import Image

raw, out = sys.argv[1], sys.argv[2]
W, H = 4096, 2048
R = 1737400.0  # m, LOLA reference sphere
EXAG = 4.0

# Colour: 16-bit sRGB -> 8-bit
c = tifffile.imread(f"{raw}/lroc_color_16bit_srgb_4k.tif")
c8 = (c.astype(np.float32) / 257.0).round().clip(0, 255).astype(np.uint8)
Image.fromarray(c8, "RGB").save(f"{out}/moon-color-4k.webp", quality=85, method=6)

# Heights: uint16 half-metres offset by +20000 -> metres, resampled to W x H
h = (tifffile.imread(f"{raw}/ldem_16_uint.tif").astype(np.float32) - 20000.0) / 2.0
h = np.asarray(Image.fromarray(h, "F").resize((W, H), Image.BOX), dtype=np.float64)

lat = np.radians(90.0 - (np.arange(H) + 0.5) * 180.0 / H)[:, None]
lon = np.radians(-180.0 + (np.arange(W) + 0.5) * 360.0 / W)[None, :]
dlon = 2 * np.pi / W
dlat = np.pi / H

dh_dlon = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) / (2 * dlon)
hp = np.vstack([h[:1], h, h[-1:]])
dh_dlat = -(hp[2:] - hp[:-2]) / (2 * dlat)  # rows run north -> south

cos_lat = np.maximum(np.cos(lat), 1e-3)
s_e = EXAG * dh_dlon / (R * cos_lat)
s_n = EXAG * dh_dlat / R

# Local frame in the globe's object space: lon 0 on +x, east towards -z, north +y
up = np.stack([np.cos(lat) * np.cos(lon), np.sin(lat) * np.ones_like(lon), -np.cos(lat) * np.sin(lon)], -1)
east = np.stack([-np.sin(lon) * np.ones_like(lat), np.zeros_like(lat * lon), -np.cos(lon) * np.ones_like(lat)], -1)
north = np.stack([-np.sin(lat) * np.cos(lon), np.cos(lat) * np.ones_like(lon), np.sin(lat) * np.sin(lon)], -1)

n = up - s_e[..., None] * east - s_n[..., None] * north
n /= np.linalg.norm(n, axis=-1, keepdims=True)
n8 = ((n * 0.5 + 0.5) * 255).round().clip(0, 255).astype(np.uint8)
Image.fromarray(n8, "RGB").save(f"{out}/moon-normal-4k.webp", quality=90, method=6)

print("heights m:", float(h.min()), float(h.max()))
