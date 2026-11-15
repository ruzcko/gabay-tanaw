"""Fetch and validate the precompute pipeline's JPL Horizons responses.

Usage: python science/fetch_ephemeris.py SITES_JSON CACHE_DIR [START] [DAYS]
       [--horizons HORIZONS_DIR] [--force] [--step-minutes 1|10] [--batch]

Gzip responses (including model/EOP headers and warnings) remain in the cache.
Default chunks are monthly; --batch uses bounded longer windows in a separate cache.
The default window is 365 days; adjacent chunks share an identical endpoint.
"""
import argparse
import gzip
import json
import math
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
BODIES = {"sun": "10", "earth": "399"}
# Our own resource bound, not a claim about the upstream API's maximum.
MAX_BATCH_SAMPLES = 60000
_COVERAGE = json.loads((Path(__file__).resolve().parents[1] /
                       'app/assets/computation/quick/manifest.json').read_text(encoding='utf-8'))
# Published forecasts retain leap-second UTC coverage independently of browser estimates.
COVERAGE_START = max(datetime(1972, 1, 1, tzinfo=timezone.utc),
                     datetime.fromisoformat(_COVERAGE['start']))
COVERAGE_END = datetime.fromisoformat(_COVERAGE['end'])


def months(start, stop):
    """Calendar chunks, including a shared endpoint for adjacent raw tables."""
    out, a = [], start
    while a < stop:
        b = min(stop, (a.replace(day=1) + timedelta(days=32)).replace(day=1))
        out.append((f"{a:%Y-%m}", a, b))
        a = b
    return out


def batch_windows(start, stop, step_minutes):
    """Fewer serialized requests, with exactly the same sampling and shared endpoint."""
    require(step_minutes in (1, 10) and stop > start, "Invalid batch window/cadence")
    days = (MAX_BATCH_SAMPLES - 1) // (1440 // step_minutes)
    out, a = [], start
    while a < stop:
        b = min(stop, a + timedelta(days=days))
        out.append((f"{a:%Y-%m-%d}_{b:%Y-%m-%d}", a, b))
        a = b
    return out


def check_cache_layout(directory, windows, batch):
    """Never combine monthly and batched responses or unrelated batch windows."""
    existing = {p.name for body in BODIES for p in directory.glob(f"{body}-*.txt.gz")}
    if batch:
        expected = {f"{body}-{label}.txt.gz" for body in BODIES for label, _, _ in windows}
        require(existing <= expected, "Batch cache contains other windows/layouts; use a separate cache directory")
    else:
        require(all(re.fullmatch(r"(sun|earth)-\d{4}-\d{2}\.txt\.gz", name) for name in existing),
                "Monthly cache contains batched responses; use a separate cache directory")


def load_sites(path):
    data = json.loads(Path(path).read_bytes())
    return data["sites"] if isinstance(data, dict) else data


def require(condition, message):
    if not condition:
        raise ValueError(message)


def observer_altitude_km(site, horizon):
    """Use the site/height convention in app/computation/SCIENCE.md."""
    require(horizon["id"] == site["id"] and horizon["lat"] == site["lat"]
            and horizon["lon"] == site["lon"], "Horizon site mismatch; regenerate terrain")
    require(site["referenceFrame"] == "MOON_ME_DE421"
            and site["elevationDatum"] == "sphere-1737400m"
            and horizon["referenceFrame"] == "MOON_ME_DE421"
            and horizon["datum"] == "sphere-1737400m", "Unsupported terrain frame/datum")
    ground, height = horizon["surfaceElevation"], horizon["observerHeight"]
    require(all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
                for v in (ground, height, site["lat"], site["lon"])), "Nonfinite observer coordinates")
    require(-90 < site["lat"] < 90 and 0 <= height <= 100000 and abs(ground) <= 20000, "Unsupported observer location/height")
    require(horizon["terrain"] != "smooth" or ground == 0, "Smooth ground must be zero")
    return (ground + height) / 1000


def validate_api(text):
    require(re.search(r"^API VERSION: (1\.2|1\.3)\s*$", text, re.M), "Unreviewed Horizons API version")
    require(re.search(r"^API SOURCE: NASA/JPL Horizons API\s*$", text, re.M), "Unrecognized Horizons source")


def request_text(params):
    """One serialized HTTP path, also used by the independent subsolar check."""
    url = API + "?" + urllib.parse.urlencode({"format": "text", **{k: f"'{v}'" for k, v in params.items()}})
    request = urllib.request.Request(url, headers={"User-Agent": "Tanaw-precompute/1.0 (+https://github.com/ruzcko)"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                text = response.read().decode()
            validate_api(text)
            return text
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
        time.sleep(2 ** (attempt + 1))


def parse_columns(text, step_minutes=None):
    """Parse every named numeric column once, retaining Horizons' original units."""
    require(text.count("$$SOE") == 1 and text.count("$$EOE") == 1, "Missing/duplicate table markers")
    header, rest = text.split("$$SOE")
    table, _ = rest.split("$$EOE")
    lines = [line for line in header.splitlines() if line.strip().startswith("Date__(UT)__HR:MN,")]
    require(len(lines) == 1, "Missing/duplicate UT timestamp header")
    columns = [c.strip() for c in lines[0].split(",")]
    named = [(i, name) for i, name in enumerate(columns) if i > 0 and name]
    require(len(set(name for _, name in named)) == len(named), "Duplicate columns")
    stamps, values = [], {name: [] for _, name in named}
    for line in table.strip().splitlines():
        row = [c.strip() for c in line.split(",")]
        require(len(row) == len(columns), "Malformed row width")
        stamps.append(row[0])
        for i, name in named:
            value = float(row[i])
            require(math.isfinite(value), "Nonfinite observation")
            values[name].append(value)
    require(len(stamps) >= 2, "Insufficient samples")
    first = parse_stamp(stamps[0])
    step = timedelta(minutes=step_minutes) if step_minutes is not None else parse_stamp(stamps[1]) - first
    require(step in (timedelta(minutes=1), timedelta(minutes=10), timedelta(hours=1)), "Unsupported cadence")
    times = [first + k * step for k in range(len(stamps))]
    # Every row must print exactly its expected instant, so gaps, repeats and reordering still fail.
    require(all(s == format_stamp(t) for s, t in zip(stamps, times)), "Missing, duplicate or unordered sample")
    return times, values


MONTH_NAMES = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def parse_stamp(stamp):
    return datetime.strptime(stamp, "%Y-%b-%d %H:%M").replace(tzinfo=timezone.utc)


def format_stamp(t):
    """Horizons' UT timestamp text, without strptime's per-row cost."""
    return f"{t.year:04d}-{MONTH_NAMES[t.month - 1]}-{t.day:02d} {t.hour:02d}:{t.minute:02d}"


def parse_table(text, observer=False, step_minutes=10, return_columns=False):
    times, columns = parse_columns(text, step_minutes)
    az_name, el_name = "Azimuth_(a-app)", "Elevation_(a-app)"
    require(az_name in columns and el_name in columns, "Missing azimuth/elevation columns")
    azimuths, elevations = columns[az_name], columns[el_name]
    require(all(0 <= a <= 360 and abs(e) <= 90 for a, e in zip(azimuths, elevations)),
            "Invalid observation values")
    if observer:
        require("delta" in columns and "Ang-diam" in columns, "Missing observer range/diameter columns")
        require("Units: KM and KM/S" in text and "Units: ARCSECONDS" in text, "Invalid observer units")
        ranges = columns["delta"]
        diameters = [d / 3600 for d in columns["Ang-diam"]]
        require(all(r > 0 and 0 < d < 180 for r, d in zip(ranges, diameters)), "Invalid observer range/diameter")
    require(COVERAGE_START <= times[0] < COVERAGE_END and times[-1] <= COVERAGE_END, "Unsupported time window")
    if return_columns:
        return times, columns
    return (times, azimuths, elevations, ranges, diameters) if observer else (times, azimuths, elevations)


def validate_response(text, body, site, horizon, start=None, stop=None, observer=False, step_minutes=10,
                      return_columns=False):
    """Fail closed before cache reuse, cache writes, or forecast construction."""
    altitude = observer_altitude_km(site, horizon)
    validate_api(text)
    require(step_minutes in (1, 10), "Supported sampling steps are 1 or 10 minutes")
    samples = parse_table(text, observer=True, step_minutes=step_minutes, return_columns=return_columns)
    times = samples[0]
    header = text.split("$$SOE")[0]
    checks = {
        rf"Target body name: {body.title()} \({BODIES[body]}\)\s+\{{source: [^}}]+\}}": "Wrong target/missing model",
        r"Center body name: Moon \(301\)\s+\{source: [^}]+\}": "Wrong center/missing model",
        r"Center-site name: \(user defined site below\)": "Not a surface observer",
        r"Center pole/equ\s*:\s*MEAN_ME \(high precision\)\s*\{East-longitude positive\}": "Unsupported lunar orientation (MEAN_ME required)",
        r"Center radii\s*:\s*1737\.4,\s*1737\.4,\s*1737\.4 km": "Unexpected lunar reference shape",
        r"Atmos refraction:\s*NO \(AIRLESS\)": "Not airless",
        r"Calendar mode\s*:\s*Gregorian\s*$": "Unexpected calendar",
        r"EOP file[ \t]*:[ \t]*[^\s]+[ \t]*$": "Missing EOP file",
        r"EOP coverage[ \t]*:[ \t]*\S[^\r\n]*$": "Missing EOP coverage",
        rf"Step-size\s*:\s*{step_minutes} minutes\s*$": "Unexpected sample step",
    }
    for pattern, message in checks.items():
        require(re.search(pattern, header, re.M), message)
    match = re.search(r"Center geodetic\s*:\s*([^\n{]+)", header)
    require(match, "Missing site coordinates")
    actual = [float(c.strip()) for c in match[1].split(",")]
    require(len(actual) == 3 and all(math.isfinite(v) for v in actual), "Invalid site coordinates")
    require(abs((actual[0] - site["lon"] + 180) % 360 - 180) <= 0.00001
            and abs(actual[1] - site["lat"]) <= 0.00001
            and abs(actual[2] - altitude) <= 0.00001, "Observer location mismatch")
    for label, instant, expected in (("Start time", times[0], start), ("Stop  time", times[-1], stop)):
        require(re.search(rf"{label}\s*:\s*A.D. {instant:%Y-%b-%d %H:%M}:00\.0000 UT[ \t]*$", header, re.M), "Window/header mismatch")
        require(instant.hour == 0 and instant.minute == 0, "Window must start/end at UTC midnight")
        require(expected is None or instant.date() == expected, "Requested window mismatch")
    return samples if observer or return_columns else samples[:3]


def cached_for(text, body, site, horizon, start, stop, step_minutes=10):
    try:
        validate_response(text, body, site, horizon, start, stop, step_minutes=step_minutes)
        return True
    except (ValueError, KeyError):
        return False


def query(body, site, horizon, start, stop, step_minutes=10):
    altitude = observer_altitude_km(site, horizon)
    require(COVERAGE_START.date() <= start < stop <= COVERAGE_END.date(), "Unsupported time window")
    params = {
        "COMMAND": BODIES[body], "CENTER": "coord@301", "COORD_TYPE": "GEODETIC",
        "SITE_COORD": f"{site['lon'] % 360:.8f},{site['lat']:.8f},{altitude:.9f}",
        "MAKE_EPHEM": "YES", "EPHEM_TYPE": "OBSERVER",
        "START_TIME": f"{start} 00:00", "STOP_TIME": f"{stop} 00:00",
        "STEP_SIZE": f"{step_minutes}m", "QUANTITIES": "4,13,20", "RANGE_UNITS": "KM", "APPARENT": "AIRLESS",
        "ANG_FORMAT": "DEG", "TIME_TYPE": "UT", "CAL_TYPE": "GREGORIAN",
        "CSV_FORMAT": "YES", "EXTRA_PREC": "YES", "OBJ_DATA": "NO",
        "ELEV_CUT": "-90", "SKIP_DAYLT": "NO",
    }
    text = request_text(params)
    validate_response(text, body, site, horizon, start, stop, step_minutes=step_minutes)
    return text


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("sites")
    ap.add_argument("cache")
    ap.add_argument("start", nargs="?", default="2026-12-01")
    ap.add_argument("days", nargs="?", type=int, default=365)
    ap.add_argument("--horizons", default="app/data/horizons")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--step-minutes", type=int, choices=(1, 10), default=10)
    ap.add_argument("--batch", action="store_true", help="Fetch larger windows into a separate cache; preserve sampling")
    args = ap.parse_args()
    require(args.days > 0, "Days must be positive")
    cache = Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)
    start = date.fromisoformat(args.start)
    stop = start + timedelta(days=args.days)
    require(COVERAGE_START.date() <= start < stop <= COVERAGE_END.date(), "Unsupported time window")
    windows = batch_windows(start, stop, args.step_minutes) if args.batch else months(start, stop)
    sites = load_sites(args.sites)
    # Validate the entire selection before making any network requests.
    for site in sites:
        observer_altitude_km(site, json.loads((Path(args.horizons) / f"{site['id']}.json").read_text()))
        check_cache_layout(cache / site["id"], windows, args.batch)
    fetched = False
    for site in sites:
        horizon = json.loads((Path(args.horizons) / f"{site['id']}.json").read_text())
        observer_altitude_km(site, horizon)
        for body in BODIES:
            for label, a, b in windows:
                out = cache / site["id"] / f"{body}-{label}.txt.gz"
                out.parent.mkdir(parents=True, exist_ok=True)
                if not args.force and out.exists():
                    with gzip.open(out, "rt") as f:
                        if cached_for(f.read(), body, site, horizon, a, b, args.step_minutes):
                            print(f"cached  {out}", flush=True)
                            continue
                if fetched:
                    time.sleep(1)  # Pause between requests, not after the last one.
                text = query(body, site, horizon, a, b, args.step_minutes)
                temporary = out.with_suffix(".tmp")
                # Level 6 is lossless like 9 and roughly ten times faster on a year-long response.
                with gzip.open(temporary, "wt", compresslevel=6) as f:
                    f.write(text)
                temporary.replace(out)
                print(f"fetched {out}", flush=True)
                fetched = True


if __name__ == "__main__":
    main()
