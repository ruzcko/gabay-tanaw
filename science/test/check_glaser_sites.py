"""Recheck the accepted Gläser points and eight 100 m offsets using the 0.25 degree grid.

Usage: python science/test/check_glaser_sites.py REVIEW_DIR LDEM_75S FINE_DIR OUTPUT_JSON
This is an offline terrain consistency experiment, not a coordinate-frame transform.
Published visible-disc means: Gläser et al. 2018, Tables 1/2,
https://ntrs.nasa.gov/citations/20170007365 .
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import horizon as hz
from sunlight import illumination, sun_directions

POINTS = {"connecting-ridge": (-89.4398, 222.83, 88.0),
          "connecting-ridge-extension": (-89.313, 245.98, 78.1),
          "shackleton-rim": (-89.6866, 197.19, 85.5)}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("review", type=Path)
    ap.add_argument("ldem", type=Path)
    ap.add_argument("fine", type=Path)
    ap.add_argument("output", type=Path)
    args = ap.parse_args()
    sites = {s["id"]: s for s in json.loads((args.review/"sites.json").read_bytes())}
    dem, sun, results = hz.load_ldem(args.ldem), sun_directions(), []
    for sid, (lat, lon, published) in POINTS.items():
        site = sites[sid]
        if (site["lat"], site["lon"]) != (lat, lon):
            raise ValueError(f"{sid}: changed published test location")
        horizon = json.loads((args.review/"horizons"/f"{sid}.json").read_bytes())
        if horizon["observerHeight"] != 2 or horizon["calculation"]["step"] != 0.25:
            raise ValueError("Expected the 2 m / quarter-degree rebuild")
        exact = 100*illumination(horizon["calculation"]["elevations"], lat, lon, sun)[0]
        ring = []
        # Spherical destinations keep the perturbation exactly 100 m, independently
        # of projection scale. Eight offsets test sensitivity, not all possible shifts.
        p, l, d = np.radians(lat), np.radians(lon), 100/hz.R
        for az in np.radians(np.arange(0, 360, 45)):
            q = np.arcsin(np.sin(p)*np.cos(d)+np.cos(p)*np.sin(d)*np.cos(az))
            m = l+np.arctan2(np.sin(az)*np.sin(d)*np.cos(p), np.cos(d)-np.sin(p)*np.sin(q))
            la, lo = float(np.degrees(q)), float(np.degrees(m) % 360)
            fine = hz.fine_maps_near(args.fine, la, lo)
            profile = hz.horizon(dem, la, lo, height=2, step=0.25, fine=fine)
            ring.append(100*illumination(profile, la, lo, sun)[0])
        result = {"id": sid, "publishedDiscPercent": published, "rebuiltDiscPercent": exact,
                  "differencePercentagePoints": exact-published, "offsetDistanceM": 100,
                  "offsetDiscPercentsNorthClockwise": ring,
                  "offsetMedianDiscPercent": float(np.median(ring)),
                  "exactMinusOffsetMedianPoints": exact-float(np.median(ring))}
        results.append(result)
        print(json.dumps(result), flush=True)
    report = {"method": "Synthetic long-term Sun-direction grid, visible disc at 2 m; not daily centre visibility",
              "horizonStepDeg": 0.25,
              "limitation": "Empirical consistency/sensitivity only; no measured frame registration or positional error bound",
              "sites": results}
    args.output.write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")


if __name__ == "__main__":
    main()
