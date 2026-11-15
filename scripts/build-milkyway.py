"""Convert NASA SVS 4851's celestial Milky Way EXR to the local display texture.

Usage: python scripts/build-milkyway.py path/to/milkyway_2020_4k.exr
Offline-only dependencies: OpenEXR, NumPy and Pillow (see app/SOURCES.md).
Keeps NASA's celestial projection; exposure/tone mapping is for display only.
"""
import argparse
from pathlib import Path
import OpenEXR
import numpy as np
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("source", type=Path)
args = parser.parse_args()
with OpenEXR.File(str(args.source)) as source:
    rgb = source.channels()["RGB"].pixels.astype(np.float32)
if rgb.shape != (2048, 4096, 3) or not np.isfinite(rgb).all():
    raise ValueError("Expected finite NASA 4096 × 2048 RGB source")
# Fixed global exposure, preserving relative structure without a synthetic star field.
linear = np.maximum(rgb, 0)
linear = linear / (1 + linear)
srgb = np.where(linear <= .0031308, 12.92 * linear, 1.055 * linear ** (1 / 2.4) - .055)
output = Path(__file__).resolve().parents[1] / "app/assets/observer/milkyway-4k.webp"
Image.fromarray(np.round(srgb * 255).astype(np.uint8)).save(output, quality=90, method=6)
print(f"{output.name}: {output.stat().st_size:,} bytes")
