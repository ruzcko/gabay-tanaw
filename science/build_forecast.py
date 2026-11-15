"""Combine cached Horizons ephemeris with terrain horizon masks into daily forecasts.

Usage: python3 science/build_forecast.py SITES_JSON CACHE_DIR HORIZONS_DIR OUT_DIR

Reads monthly or batched chunks CACHE_DIR/<id>/<sun|earth>-*.txt.gz made by fetch_ephemeris.py.
Writes OUT_DIR/<id>.json per site (header and daily summary) and OUT_DIR/<id>/<YYYY-MM>.json
(hourly sky positions for that month). "horizon" is "smooth" when the horizon file says
"terrain": "smooth", else "lola". Missing terrain or unsupported metadata is an error.
Go/No-go is left to the app.
"""
import gzip
import json
import hashlib
import math
import re
import sys
from datetime import timedelta
from pathlib import Path
from fetch_ephemeris import load_sites, months, parse_columns, require, validate_api, validate_response

STEP = timedelta(minutes=10)
HOUR = timedelta(hours=1)


def chunks(cache, site_id, body):
    """A site's cached responses for one body, ordered by window start."""
    return sorted((Path(cache) / site_id).glob(f"{body}-*.txt.gz"))


def read_columns(path):
    """Return (times, {column name: values}) from a cached, gzipped Horizons CSV response.

    Column names come from the header line printed just above the table.
    """
    with gzip.open(path, "rt") as f:
        text = f.read()
    validate_api(text)
    return parse_columns(text)


def cadence(times):
    require(len(times) >= 2, "Insufficient samples")
    step = times[1] - times[0]
    require(step in (timedelta(minutes=1), STEP, HOUR), "Unsupported cadence")
    require(all(b - a == step for a, b in zip(times, times[1:])), "Missing/duplicate/unordered sample")
    return step


def read_chunks(paths):
    """read_columns over consecutive chunks; each chunk's first row repeats the last one."""
    return join_columns(read_columns(path) for path in paths)


def join_columns(tables):
    """Join already parsed tables without dropping any seam/column/cadence checks."""
    times, cols = [], {}
    for t, c in tables:
        if times:
            require(t[0] == times[-1], "Chunks must share an endpoint")
            require(c.keys() == cols.keys(), "Chunk columns changed")
            require(all(c[n][0] == cols[n][-1] for n in c), "Conflicting chunk endpoint")
        skip = int(bool(times))
        times += t[skip:]
        for n, v in c.items():
            cols.setdefault(n, []).extend(v[skip:])
    cadence(times)
    return times, cols


def read_table(paths):
    """Return (times, azimuths, elevations, angular diameters in arcsec, ranges in km)."""
    times, c = read_chunks(paths)
    return times, c["Azimuth_(a-app)"], c["Elevation_(a-app)"], c["Ang-diam"], c["delta"]


def mask_at(mask, az):
    """Cyclic linear interpolation on a uniform scientific azimuth grid."""
    x = (az % 360) * len(mask) / 360
    i, f = int(x), x - int(x)
    return mask[i] + (mask[(i + 1) % len(mask)] - mask[i]) * f


def up_intervals(times, clearance):
    """[start, end) spans where clearance > 0, with crossings linearly interpolated."""
    spans, start = [], times[0] if clearance[0] > 0 else None
    for k in range(1, len(times)):
        a, b = clearance[k - 1], clearance[k]
        if (a > 0) == (b > 0):
            continue
        t = times[k - 1] + (times[k] - times[k - 1]) * (a / (a - b))
        if b > 0:
            start = t
        else:
            spans.append((start, t))
            start = None
    if start is not None:
        spans.append((start, times[-1]))
    return spans


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def events(spans, start, end):
    """Rises and sets in time order, the same crossings as the daily rise and set lists."""
    rises = [(s, "rise") for s, _ in spans if s > start]
    sets = [(e, "set") for _, e in spans if e < end]
    return sorted(rises + sets)


def next_event(evts, t):
    """First rise or set strictly after t, or None."""
    return next(({"kind": kind, "at": iso(at)} for at, kind in evts if at > t), None)


def hours_in(spans, d0, d1):
    return sum(max(0, (min(e, d1) - max(s, d0)).total_seconds()) for s, e in spans) / 3600


def build(site, cache, horizons):
    mask_file = horizons / f"{site['id']}.json"
    horizon = json.loads(mask_file.read_text())
    profile = horizon.get("calculation", horizon)
    mask = profile["elevations"]
    require(len(mask) >= 360 and math.isclose(len(mask) * profile["step"], 360)
            and all(math.isfinite(e) and abs(e) <= 90 for e in mask), "Invalid horizon grid")
    records, steps, tables = [], set(), {}
    for body in ("sun", "earth"):
        parsed = []
        for path in chunks(cache, site["id"], body):
            with gzip.open(path, "rt") as f:
                text = f.read()
            match = re.search(r"Step-size\s*:\s*(\d+) minutes", text)
            require(match, "Missing cadence")
            step_minutes = int(match[1])
            parsed.append(validate_response(text, body, site, horizon, step_minutes=step_minutes,
                                            return_columns=True))
            steps.add(step_minutes)
            records.append({"file": path.name, "sha256": hashlib.sha256(text.encode()).hexdigest(),
                            "header": text.split("$$SOE")[0]})
        times, columns = join_columns(parsed)
        tables[body] = (times, columns["Azimuth_(a-app)"], columns["Elevation_(a-app)"],
                        columns["Ang-diam"], columns["delta"])
    require(len(steps) == 1, "Mixed or missing ephemeris cadence")
    return build_tables(site, horizon, tables, records,
                        hashlib.sha256(mask_file.read_bytes().replace(b"\r\n", b"\n")).hexdigest())


def build_tables(site, horizon, tables, records, horizon_sha256):
    """Shared forecast products from validated columns; no transport or file writes."""
    profile = horizon.get("calculation", horizon)
    mask = profile["elevations"]
    require(len(mask) >= 360 and math.isclose(len(mask) * profile["step"], 360)
            and all(math.isfinite(e) and abs(e) <= 90 for e in mask), "Invalid horizon grid")
    times, sun_az, sun_el, sun_diam, sun_range = tables["sun"]
    times_e, earth_az, earth_el, earth_diam, earth_range = tables["earth"]
    require(times == times_e, f"{site['id']}: Sun and Earth tables have different times")
    step = cadence(times)
    hourly_stride = int(HOUR / step)

    sun_clear = [e - mask_at(mask, a) for a, e in zip(sun_az, sun_el)]
    earth_clear = [e - mask_at(mask, a) for a, e in zip(earth_az, earth_el)]
    sun = up_intervals(times, sun_clear)
    earth = up_intervals(times, earth_clear)
    window_end = times[-1]
    sun_events = events(sun, times[0], window_end)
    earth_events = events(earth, times[0], window_end)

    days = []
    d0 = times[0]
    while d0 < window_end:
        d1 = d0 + timedelta(days=1)
        within = lambda t: d0 <= t < d1 and t < window_end  # noqa: E731
        k = int((d0 - times[0]) / step)
        days.append({
            "date": d0.strftime("%Y-%m-%d"),
            "sunHours": round(hours_in(sun, d0, d1), 2),
            "earthHours": round(hours_in(earth, d0, d1), 2),
            "sunrise": [iso(s) for s, _ in sun if within(s) and s > times[0]],
            "sunset": [iso(e) for _, e in sun if within(e)],
            "earthrise": [iso(s) for s, _ in earth if within(s) and s > times[0]],
            "earthset": [iso(e) for _, e in earth if within(e)],
            "sunUpAt0": sun_clear[k] > 0,
            "earthUpAt0": earth_clear[k] > 0,
            "nextSunEvent": next_event(sun_events, d0),
            "nextEarthEvent": next_event(earth_events, d0),
        })
        d0 = d1

    month_list = months(times[0], window_end)
    r = lambda xs: [round(x, 2) for x in xs[::hourly_stride]]  # noqa: E731
    km = lambda xs: [round(x) for x in xs[::hourly_stride]]  # noqa: E731
    deg = lambda xs: [round(x / 3600, 4) for x in xs[::hourly_stride]]  # noqa: E731  arcsec to degrees
    hourly = {
        "sunAz": r(sun_az), "sunEl": r(sun_el),
        "earthAz": r(earth_az), "earthEl": r(earth_el),
        "sunVisible": [int(c > 0) for c in sun_clear[::hourly_stride]],
        "earthVisible": [int(c > 0) for c in earth_clear[::hourly_stride]],
        "sunRangeKm": km(sun_range), "sunAngularDiameterDeg": deg(sun_diam),
        "earthRangeKm": km(earth_range), "earthAngularDiameterDeg": deg(earth_diam),
    }
    monthly = {}
    for label, a, b in month_list:
        i0, i1 = int((a - times[0]) / HOUR), int((b - times[0]) / HOUR)
        monthly[label] = {"start": iso(a), "stepMinutes": 60, **{k: v[i0:i1] for k, v in hourly.items()}}
    return {
        "id": site["id"],
        "name": site["name"],
        "lat": site["lat"],
        "lon": site["lon"],
        "horizon": "smooth" if horizon.get("terrain") == "smooth" else "lola",
        "ephemeris": f"JPL Horizons, airless apparent azimuth/elevation, {int(step.total_seconds()/60)}-minute steps; model in source headers",
        "science": {"visibility": "center", "referenceFrame": site["referenceFrame"],
                    "frameEvidence": site.get("frameEvidence"),
                    "coordinateFrameReview": site.get("coordinateFrameReview"),
                    **({"positionAccuracy": site["positionAccuracy"]} if "positionAccuracy" in site else {}),
                    "elevationDatum": horizon["datum"], "surfaceElevationM": horizon["surfaceElevation"],
                    "observerHeightM": horizon["observerHeight"], "stepMinutes": int(step.total_seconds()/60),
                    "horizonStepDeg": profile["step"],
                    "horizonSha256": horizon_sha256, "sources": records},
        "window": {"start": iso(times[0]), "end": iso(window_end)},
        "sunUpAtStart": sun_clear[0] > 0,
        "earthUpAtStart": earth_clear[0] > 0,
        "months": [label for label, _, _ in month_list],
        "days": days,
    }, monthly


def main(sites_path, cache_dir, horizons_dir, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for site in load_sites(sites_path):
        fc, monthly = build(site, Path(cache_dir), Path(horizons_dir))
        (out / f"{site['id']}.json").write_text(json.dumps(fc, separators=(",", ":")) + "\n")
        (out / site["id"]).mkdir(exist_ok=True)
        for label, month in monthly.items():
            (out / site["id"] / f"{label}.json").write_text(json.dumps(month, separators=(",", ":")) + "\n")
        sun = [d["sunHours"] for d in fc["days"]]
        earth = [d["earthHours"] for d in fc["days"]]
        print(f"{site['id']}: {fc['horizon']} horizon, {len(fc['days'])} days, "
              f"sun {min(sun)}-{max(sun)} h/day, Earth {min(earth)}-{max(earth)} h/day")


if __name__ == "__main__":
    main(*sys.argv[1:])
