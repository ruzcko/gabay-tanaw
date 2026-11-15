"""Fetch the sub-solar and sub-Earth points on the Moon, hourly, from JPL Horizons.

Usage: python3 science/sun_points.py CACHE_DIR OUT_JSON [START] [DAYS]

Queries the Moon as target from Earth's centre: quantity 14 is the observer's (Earth's)
sub-point on the Moon, quantity 15 the Sun's. Longitudes are east-positive, in [0, 360).
Saves the gzipped raw response as CACHE_DIR/moon-subpoints.txt.gz and reuses it for the same
window. Writes OUT_JSON as an index (frame, source, window, month list) and the hourly points
for each calendar month to <OUT_JSON without .json>/<YYYY-MM>.json, e.g. app/data/sun/2026-12.json.
"""
import gzip
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

from fetch_ephemeris import request_text, require, validate_api
from build_forecast import HOUR, iso, months, read_columns

def query(start, stop):
    params = {
        "COMMAND": "301",  # the Moon as target
        "CENTER": "500@399",  # Earth's centre as observer
        "MAKE_EPHEM": "YES",
        "EPHEM_TYPE": "OBSERVER",
        "START_TIME": f"{start} 00:00",
        "STOP_TIME": f"{stop} 00:00",
        "STEP_SIZE": "1h",
        "QUANTITIES": "14,15",  # sub-observer (sub-Earth) and sub-solar longitude/latitude
        "ANG_FORMAT": "DEG",
        "TIME_TYPE": "UT",
        "CSV_FORMAT": "YES",
        "OBJ_DATA": "NO",
    }
    return request_text(params)


def validate_subpoints(text):
    validate_api(text)
    header = text.split("$$SOE")[0]
    require(re.search(r"Target body name: Moon \(301\)", header), "Wrong sub-point target")
    require(re.search(r"Center body name: Earth \(399\)", header), "Wrong sub-point observer")
    require(re.search(r"Target pole/equ\s*:\s*MOON_ME\s*\{", header), "Unsupported sub-point lunar frame")
    require(all(name in header for name in ("ObsSub-LON", "ObsSub-LAT", "SunSub-LON", "SunSub-LAT")),
            "Missing sub-point columns")

def main(cache_dir, out_json, start="2026-12-01", days="365"):
    start_d = date.fromisoformat(start)
    stop_d = start_d + timedelta(days=int(days))
    raw = Path(cache_dir) / "moon-subpoints.txt.gz"
    raw.parent.mkdir(parents=True, exist_ok=True)
    text = ""
    if raw.exists():
        with gzip.open(raw, "rt") as f:
            text = f.read()
    if f"Start time      : A.D. {start_d:%Y-%b-%d} 00:00" in text and f"Stop  time      : A.D. {stop_d:%Y-%b-%d} 00:00" in text:
        print(f"cached  {raw}")
    else:
        text = query(start_d, stop_d)
        if "$$SOE" not in text:
            sys.exit(f"Horizons returned no table:\n{text[:2000]}")
        validate_subpoints(text)
        with gzip.open(raw, "wt") as f:
            f.write(text)
        print(f"fetched {raw}")

    validate_subpoints(text)
    frame = re.search(r"Target pole/equ : (\S+)", text)[1]
    times, c = read_columns(raw)
    lon = lambda xs: [round(x, 4) % 360 for x in xs]  # noqa: E731
    lat = lambda xs: [round(x, 4) for x in xs]  # noqa: E731
    points = {
        "subsolarLat": lat(c["SunSub-LAT"]), "subsolarLon": lon(c["SunSub-LON"]),
        "subEarthLat": lat(c["ObsSub-LAT"]), "subEarthLon": lon(c["ObsSub-LON"]),
    }
    month_list = months(times[0], times[-1])
    month_dir = Path(out_json).with_suffix("")
    month_dir.mkdir(parents=True, exist_ok=True)
    for label, a, b in month_list:
        i0, i1 = int((a - times[0]) / HOUR), int((b - times[0]) / HOUR)
        month = {"start": iso(a), "stepMinutes": 60, **{k: v[i0:i1] for k, v in points.items()}}
        (month_dir / f"{label}.json").write_text(json.dumps(month, separators=(",", ":")) + "\n")
    index = {
        "frame": f"{frame} (Horizons): DE440 orientation in the DE421 mean-Earth frame, NAIF MOON_ME_DE440_ME421; within 0.1 arcsec of MOON_ME_DE421 used by sites.json",
        "source": "JPL Horizons (DE441), Moon target from Earth geocentre, quantities 14 and 15",
        "window": {"start": iso(times[0]), "end": iso(times[-1])},
        "stepMinutes": 60,
        "months": [label for label, _, _ in month_list],
    }
    Path(out_json).write_text(json.dumps(index, separators=(",", ":")) + "\n")
    print(f"{out_json}: {len(times)} hourly samples from {index['window']['start']} in {len(month_list)} monthly files in {month_dir}, frame {index['frame']}")


if __name__ == "__main__":
    main(*sys.argv[1:])
