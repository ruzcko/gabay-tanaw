"""Fetch Earth's orbit around the Sun and the Moon's around Earth, hourly, from JPL Horizons.

Usage: python3 science/make_orbit.py CACHE_DIR OUT_JSON [START] [DAYS]

Two vector tables, requested one after the other: Earth from the Sun's centre and the Moon
from Earth's centre. Both are geometric positions (no light-time) in the ecliptic and mean
equinox of J2000, in km, with UT time tags. Saves the gzipped raw responses as
CACHE_DIR/orbit-earth.txt.gz and CACHE_DIR/orbit-moon.txt.gz and reuses them for the same
window. Writes OUT_JSON as an index (start, month list) and the hourly longitudes and
latitude for each calendar month to <OUT_JSON without .json>/<YYYY-MM>.json, with the same
months as sun_points.py.
"""
import gzip
import json
import math
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from fetch_ephemeris import request_text, require, validate_api
from build_forecast import HOUR, iso, months

BODIES = {  # cache name: (target, centre, target header, centre header)
    "earth": ("399", "500@10", r"Earth \(399\)", r"Sun \(10\)"),
    "moon": ("301", "500@399", r"Moon \(301\)", r"Earth \(399\)"),
}


def query(target, centre, start, stop):
    params = {
        "COMMAND": target,
        "CENTER": centre,
        "MAKE_EPHEM": "YES",
        "EPHEM_TYPE": "VECTORS",
        "START_TIME": f"{start} 00:00",
        "STOP_TIME": f"{stop} 00:00",
        "STEP_SIZE": "1h",
        "REF_PLANE": "ECLIPTIC",
        "REF_SYSTEM": "ICRF",  # with REF_PLANE=ECLIPTIC: ecliptic and mean equinox of J2000
        "VEC_TABLE": "1",  # position only
        "VEC_CORR": "NONE",  # geometric
        "OUT_UNITS": "KM-S",
        "TIME_TYPE": "UT",
        "CSV_FORMAT": "YES",
        "OBJ_DATA": "NO",
    }
    return request_text(params)


def validate_vectors(text, body, start, stop):
    validate_api(text)
    require(text.count("$$SOE") == 1 and text.count("$$EOE") == 1, "Missing/duplicate table markers")
    _, _, target, centre = BODIES[body]
    header = text.split("$$SOE")[0]
    checks = [
        (rf"^Target body name: {target}\s+\{{source: DE441\}}", "Wrong target or ephemeris"),
        (rf"^Center body name: {centre}\s+\{{source: DE441\}}", "Wrong centre or ephemeris"),
        (r"^Center-site name: BODY CENTER\s*$", "Centre is not the body centre"),
        (rf"^Start time\s*: A\.D\. {start:%Y-%b-%d} 00:00:00\.0000 UT\s*$", "Wrong start time or time scale"),
        (rf"^Stop  time\s*: A\.D\. {stop:%Y-%b-%d} 00:00:00\.0000 UT\s*$", "Wrong stop time or time scale"),
        (r"^Step-size\s*: 60 minutes\s*$", "Wrong step"),
        (r"^Output units\s*: KM-S\s*$", "Wrong units"),
        (r"^Output type\s*: GEOMETRIC cartesian states\s*$", "Positions are not geometric"),
        (r"^Reference frame : Ecliptic of J2000\.0\s*$", "Wrong reference frame"),
        (r"^\s*JDUT\s*,\s*Calendar Date \(UT\s*\)\s*,\s*X\s*,\s*Y\s*,\s*Z\s*,\s*$", "Wrong vector columns"),
    ]
    for pattern, message in checks:
        require(re.search(pattern, header, re.M), f"{body}: {message}")


def parse_vectors(text, start, stop):
    """Return (times, [(x, y, z)]) from a CSV vector table with UT calendar dates."""
    table = text.split("$$SOE")[1].split("$$EOE")[0]
    times, xyz = [], []
    for line in table.strip().splitlines():
        row = [c.strip() for c in line.split(",")]
        require(len(row) == 6 and row[5] == "" and row[1].startswith("A.D. "), "Malformed vector row")
        times.append(datetime.strptime(row[1][5:], "%Y-%b-%d %H:%M:%S.%f").replace(tzinfo=timezone.utc))
        values = tuple(float(v) for v in row[2:5])
        require(all(math.isfinite(v) for v in values), "Nonfinite vector")
        xyz.append(values)
    first = datetime.combine(start, datetime.min.time(), timezone.utc)
    hours = int((stop - start) / timedelta(days=1)) * 24
    require(len(times) == hours + 1 and times[0] == first, "Incomplete vector table")
    require(all(b - a == HOUR for a, b in zip(times, times[1:])), "Missing, duplicate or unordered sample")
    return times, xyz


def load(cache_dir, body, start, stop):
    raw = Path(cache_dir) / f"orbit-{body}.txt.gz"
    raw.parent.mkdir(parents=True, exist_ok=True)
    if raw.exists():
        with gzip.open(raw, "rt") as f:
            text = f.read()
        try:
            validate_vectors(text, body, start, stop)
            print(f"cached  {raw}")
            return text
        except ValueError:
            pass
    target, centre, _, _ = BODIES[body]
    text = query(target, centre, start, stop)
    time.sleep(1)  # one request at a time, with a pause after each
    if "$$SOE" not in text:
        sys.exit(f"Horizons returned no table:\n{text[:2000]}")
    validate_vectors(text, body, start, stop)
    with gzip.open(raw, "wt") as f:
        f.write(text)
    print(f"fetched {raw}")
    return text


def lon(x, y):
    return round(math.degrees(math.atan2(y, x)) % 360, 2) % 360


def main(cache_dir, out_json, start="2026-12-01", days="365"):
    start_d = date.fromisoformat(start)
    stop_d = start_d + timedelta(days=int(days))
    tables = {body: parse_vectors(load(cache_dir, body, start_d, stop_d), start_d, stop_d) for body in BODIES}
    times, earth = tables["earth"]
    require(tables["moon"][0] == times, "Earth and Moon tables have different times")
    moon = tables["moon"][1]
    points = {
        "earthHelioLonDeg": [lon(x, y) for x, y, _ in earth],
        "moonGeoLonDeg": [lon(x, y) for x, y, _ in moon],
        "moonGeoLatDeg": [round(math.degrees(math.asin(z / math.hypot(x, y, z))), 2) + 0.0 for x, y, z in moon],  # no -0.0
    }
    month_list = months(times[0], times[-1])
    month_dir = Path(out_json).with_suffix("")
    month_dir.mkdir(parents=True, exist_ok=True)
    for label, a, b in month_list:
        i0, i1 = int((a - times[0]) / HOUR), int((b - times[0]) / HOUR)
        month = {"start": iso(a), "stepMinutes": 60, **{k: v[i0:i1] for k, v in points.items()}}
        (month_dir / f"{label}.json").write_text(json.dumps(month, separators=(",", ":")) + "\n")
    index = {"start": iso(times[0]), "months": [label for label, _, _ in month_list]}
    Path(out_json).write_text(json.dumps(index, separators=(",", ":")) + "\n")
    print(f"{out_json}: {len(times) - 1} hourly samples from {index['start']} in {len(month_list)} monthly files in {month_dir}")


if __name__ == "__main__":
    main(*sys.argv[1:])
