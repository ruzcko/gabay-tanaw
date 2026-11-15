"""Validate monthly static JSON schemas, coverage, identity and provenance links.

Usage: python science/validate_data.py [DATA_DIR]
Run after staging the complete dataset; no network or UI is involved.
"""
import argparse
import hashlib
import json
import math
import re
import struct
from datetime import datetime, timedelta, timezone
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

SCHEMAS = Path(__file__).with_name("schemas")


def read(path):
    def reject(value):
        raise ValueError(f"Nonfinite JSON value: {value}")
    return json.loads(path.read_bytes(), parse_constant=reject)


def sha(path):
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def png_header(path):
    """(width, height, colour type) of an 8-bit, non-interlaced PNG; None for anything else."""
    head = path.read_bytes()[:33]
    if len(head) < 33 or head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        return None
    width, height, depth, colour, _, _, interlace = struct.unpack(">IIBBBBB", head[16:29])
    return (width, height, colour) if depth == 8 and interlace == 0 else None


def validate_source_coverage(sources, start, end, step_minutes):
    """Raw requests may span months; prove full coverage for each body from headers."""
    require(len({s["file"] for s in sources}) == len(sources), "Duplicate source records")
    windows = {"sun": [], "earth": []}
    for source in sources:
        body = source["file"].split("-", 1)[0]
        require(body in windows, "Unknown source body")
        header = source["header"]
        number = "10" if body == "sun" else "399"
        require(re.search(rf"Target body name: {body.title()} \({number}\)", header), "Source body mismatch")
        require(re.search(rf"Step-size\s*:\s*{step_minutes} minutes\s*$", header, re.M), "Source cadence mismatch")
        bounds = []
        for label in ("Start time", "Stop  time"):
            match = re.search(rf"{label}\s*:\s*A.D. (\d{{4}}-[A-Za-z]{{3}}-\d{{2}} 00:00):00\.0000 UT[ \t]*$", header, re.M)
            require(match, "Missing source midnight window")
            bounds.append(datetime.strptime(match[1], "%Y-%b-%d %H:%M").replace(tzinfo=timezone.utc))
        windows[body].append(bounds)
    for body, spans in windows.items():
        cursor = start
        for a, b in sorted(spans):
            require(a == cursor and b > a, f"{body}: source coverage gap/overlap")
            cursor = b
        require(cursor == end and spans, f"{body}: incomplete source coverage")


def validate(data):
    validators = {}
    for path in SCHEMAS.glob("*.schema.json"):
        schema = read(path)
        Draft202012Validator.check_schema(schema)
        validators[path.name.removesuffix(".schema.json")] = Draft202012Validator(schema, format_checker=FormatChecker())
    checked = set()

    def check(relative, name):
        value = read(data / relative)
        validators[name].validate(value)
        checked.add(relative)
        return value

    sites = check("sites.json", "sites")
    ids = {s["id"] for s in sites}
    require(len(ids) == len(sites), "Duplicate site IDs")
    if (data / "landing-terrain.json").exists():
        terrain = check("landing-terrain.json", "landing-terrain")["rows"]
        require(len(terrain) == len(ids) and {row["id"] for row in terrain} == ids,
                "Travel terrain: missing/duplicate/orphan site screens")
        points = {site["id"]: site for site in sites}
        require(all(row["lat"] == points[row["id"]]["lat"] and row["lon"] == points[row["id"]]["lon"] for row in terrain),
                "Travel terrain: stale site coordinates")
    for folder in ("horizons", "forecast"):
        require({p.stem for p in (data/folder).glob("*.json")} == ids, f"Missing/orphan {folder} indexes")
    sun = check("sun.json", "sun")
    year_start, year_end = (datetime.fromisoformat(sun["window"][k]) for k in ("start", "end"))
    require(year_end > year_start, "Invalid window")
    expected_hours = int((year_end-year_start).total_seconds()/3600)
    for site in sites:
        sid = site["id"]
        horizon = check(f"horizons/{sid}.json", "horizon")
        forecast = check(f"forecast/{sid}.json", "forecast")
        for value in (horizon, forecast):
            require(all(value[k] == site[k] for k in ("id", "lat", "lon")), f"{sid}: site mismatch")
        require(forecast["window"] == sun["window"] and forecast["months"] == sun["months"], f"{sid}: window mismatch")
        require(len(horizon["calculation"]["elevations"]) * horizon["calculation"]["step"] == 360, f"{sid}: incomplete horizon")
        stride = int(1/horizon["calculation"]["step"])
        require(horizon["elevations"] == [round(x, 2) for x in horizon["calculation"]["elevations"][::stride]], f"{sid}: display/calculation mismatch")
        require(horizon["terrain"] != "smooth" or horizon["surfaceElevation"] == 0, f"{sid}: nonzero smooth ground")
        info = forecast["science"]
        require(info["horizonSha256"] == sha(data/f"horizons/{sid}.json"), f"{sid}: stale horizon hash")
        require(info["horizonStepDeg"] == horizon["calculation"]["step"], f"{sid}: grid step mismatch")
        require(info["surfaceElevationM"] == horizon["surfaceElevation"] and info["observerHeightM"] == horizon["observerHeight"], f"{sid}: height mismatch")
        require(info["frameEvidence"] == site["frameEvidence"] and info.get("positionAccuracy") == site.get("positionAccuracy"), f"{sid}: lost coordinate evidence")
        validate_source_coverage(info["sources"], year_start, year_end, info["stepMinutes"])
        require(len(forecast["days"])*24 == expected_hours, f"{sid}: incomplete days")
        for k, day in enumerate(forecast["days"]):
            require(day["date"] == (year_start + timedelta(days=k)).date().isoformat(), f"{sid}: discontinuous days")
        region = site.get("regionCentre", {})
        if "searchRadiusKm" in region:
            p, q = math.radians(site["lat"]), math.radians(region["lat"])
            dl = math.radians(site["lon"]-region["lon"])
            distance = 2*1737.4*math.asin(math.sqrt(min(1, math.sin((p-q)/2)**2+math.cos(p)*math.cos(q)*math.sin(dl/2)**2)))
            require(distance <= region["searchRadiusKm"]+0.01, f"{sid}: outside search radius")  # Catalog rounds coordinates.
            box = region["extent"]
            require(box["latMin"] <= site["lat"] <= box["latMax"] and box["lonMin"] <= site["lon"] <= box["lonMax"], f"{sid}: outside region extent")

    for folder, schema in [("sun", "sun-month"), *[(f"forecast/{s['id']}", "forecast-month") for s in sites]]:
        require({p.stem for p in (data/folder).glob("*.json")} == set(sun["months"]), f"{folder}: missing/orphan month")
        cursor, count = year_start, 0
        for label in sun["months"]:
            month = check(f"{folder}/{label}.json", schema)
            require(month["start"] == cursor.strftime("%Y-%m-%dT%H:%M:%SZ") and label == cursor.strftime("%Y-%m"), f"{folder}: discontinuous months")
            lengths = {len(v) for k, v in month.items() if k not in ("start", "stepMinutes", "geometric")}
            require(len(lengths) == 1, f"{folder}: unequal arrays")
            n = lengths.pop()
            if 'geometric' in month:
                from fetch_validation_kernels import FILES
                pins = {Path(k).name: v for k, v in FILES.items()}
                pins['pck00011.tpc'] = '3dff7b1dbeceaa01f25467767d3fa25816051c85d162d1edf04acb310ee28bb1'
                g = month['geometric']
                require({k['file']: k['sha256'] for k in g['kernels']} == pins, f'{folder}: unverified geometry kernels')
                require(all(len(g[b]) == n for b in ('sun', 'earth')), f'{folder}: incomplete geometric states')
                if 'sky' in g:
                    rotations = g['sky']['rotations']
                    require(len(rotations) == n and all(abs(sum(x*x for x in q)-1) < 2e-10 for q in rotations),
                            f'{folder}: invalid sky rotation coverage/norm')
            cursor += timedelta(hours=n)
            require(cursor == year_end or cursor.day == 1 and cursor.hour == 0, f"{folder}: incomplete month")
            count += n
        require(cursor == year_end and count == expected_hours, f"{folder}: incomplete window")

    manifest = check("forecast-manifest.json", "manifest")
    require(all(datetime.fromisoformat(manifest["window"][k]) == datetime.fromisoformat(sun["window"][k]) for k in ("start", "end")), "Manifest window mismatch")
    require(manifest["catalogSha256"] == sha(data/"sites.json"), "Stale manifest catalog")
    require({s["id"] for s in manifest["included"]} == ids and len(manifest["included"]) == len(ids), "Incomplete manifest")
    expected = {p for p in checked if p.startswith(("horizons/", "forecast/", "sun/")) or p == "sun.json"}
    require(set(manifest["filesSha256"]) == expected, "Incomplete manifest artifact list")
    for relative, digest in manifest["filesSha256"].items():
        require(sha(data/relative) == digest, f"Changed since audit: {relative}")
    if (data/"terrain/index.json").exists():
        tiles = check("terrain/index.json", "terrain-index")["sites"]
        by_id = {s["id"]: s for s in sites}
        require(set(tiles) <= ids, "Terrain tiles for unknown sites")
        require({p.name for p in (data/"terrain").glob("*.bin")} == {t["file"] for t in tiles.values()}, "Missing/orphan terrain tiles")
        for sid, tile in tiles.items():
            site, meta = by_id[sid], tile["metadata"]
            lon = site["lon"] - 360 if site["lon"] > 180 else site["lon"]
            require(tile["file"] == f"{sid}.bin", f"{sid}: terrain file name")
            require(meta["latitudeDeg"] == site["lat"] and meta["longitudeEastDeg"] == lon, f"{sid}: terrain not centred on site")
            require(meta["referenceFrame"] == site["referenceFrame"] and meta["elevationDatum"] == site["elevationDatum"], f"{sid}: terrain frame/datum")
            require((data/"terrain"/tile["file"]).stat().st_size == tile["width"]*tile["height"]*4, f"{sid}: terrain tile size")

    if (data/"layers/index.json").exists():
        layers = check("layers/index.json", "layers-index")
        textures, tiles, folder = layers["textures"], layers["sites"]["tiles"], data/"layers"
        require(all(t["file"] == f"{name}.png" for name, t in textures.items()), "layers: texture file name")
        for name, layer in layers["layers"].items():
            globe = layer["globe"]
            require({globe[k] for k in ("global", "south", "north") if k in globe}
                    == {t["file"] for t in textures.values() if t["layer"] == name}, f"layers: {name} texture list mismatch")
            for pole in ("south", "north"):
                if pole in globe:
                    t = textures[globe[pole].removesuffix(".png")]
                    require(t["projection"]["name"] == f"{pole} polar stereographic"
                            and globe[f"{pole}Half"] == t["projection"]["halfExtentRadii"], f"layers: {name} {pole} extent mismatch")
            if "global" in globe:
                require(textures[globe["global"].removesuffix(".png")]["projection"]["name"] == "equirectangular",
                        f"layers: {name} global texture must be equirectangular")
        require(set(tiles) == ids, f"layers: site tiles must match sites.json {sorted(set(tiles) ^ ids)}")
        grids = {}
        for sid, tile in tiles.items():
            require(tile["file"] == f"sites/{sid}.png", f"layers: {sid} tile file name")
            if tile["grid"] not in grids:
                grids[tile["grid"]] = read((folder/tile["grid"]).resolve())["sites"]
            grid = grids[tile["grid"]].get(sid)
            require(grid and (grid["width"], grid["height"], grid["spacingM"]) == (257, 257, 78.125),
                    f"layers: {sid} has no 257 x 257 terrain grid in {tile['grid']}")
        named = {t["file"] for t in textures.values()} | {t["file"] for t in tiles.values()}
        actual = {p.relative_to(folder).as_posix() for p in folder.rglob("*") if p.is_file()} - {"index.json"}
        require(actual == named, f"layers: missing {sorted(named - actual)}, orphan {sorted(actual - named)}")
        for t in textures.values():
            require(png_header(folder/t["file"]) == (t["width"], t["height"], 0),
                    f"layers/{t['file']}: must be an 8-bit grey PNG of {t['width']} x {t['height']}")
        grid = layers["sites"]["grid"]
        for t in tiles.values():
            require(png_header(folder/t["file"]) == (grid["width"], grid["height"], 2),
                    f"layers/{t['file']}: must be an 8-bit RGB PNG of {grid['width']} x {grid['height']}")

    if (data/"grid").exists():
        index = check("grid/index.json", "grid-index")
        require(index["start"] == year_start.date().isoformat(), "grid: window start mismatch")
        polar = {s["id"]: s for s in sites if s["lat"] <= -75}
        require(set(index["sites"]) == set(polar), "grid: sites must be those at or south of 75 S")
        for sid, name in index["sites"].items():
            grid, site = check(f"grid/{name}", "grid"), polar[sid]
            points = grid["points"]
            require(grid["id"] == sid and len(points) == index["n"]**2, f"grid/{name}: identity or size mismatch")
            centre = next((p for p in points if p["i"] == p["j"] == 0), None)
            require(centre and centre["lat"] == site["lat"] and centre["lon"] == site["lon"]
                    and centre["groundM"] == round(site["surfaceElevationM"], 1), f"grid/{name}: centre is not the site")
            require(all(len(p[k]) == index["days"] for p in points for k in ("sunHours", "earthHours")), f"grid/{name}: incomplete days")

    if (data/"orbit.json").exists():
        orbit = check("orbit.json", "orbit")
        require(datetime.fromisoformat(orbit["start"]) == year_start and orbit["months"] == sun["months"], "orbit: window mismatch")
        require({p.stem for p in (data/"orbit").glob("*.json")} == set(orbit["months"]), "orbit: missing/orphan month")
        cursor = year_start
        for label in orbit["months"]:
            month, sun_month = check(f"orbit/{label}.json", "orbit-month"), read(data/f"sun/{label}.json")
            lengths = {len(month[k]) for k in ("earthHelioLonDeg", "moonGeoLonDeg", "moonGeoLatDeg")}
            require(len(lengths) == 1, f"orbit/{label}: unequal arrays")
            n = lengths.pop()
            require(month["start"] == sun_month["start"] == cursor.strftime("%Y-%m-%dT%H:%M:%SZ")
                    and n == len(sun_month["subsolarLat"]), f"orbit/{label}: does not match sun/{label}")
            cursor += timedelta(hours=n)
        require(cursor == year_end, "orbit: incomplete window")

    if (data/"landings.json").exists():
        landings = check("landings.json", "landings")
        require(set(landings) == {s["id"] for s in sites if s["category"] == "visited"},
                "landings: ids must be exactly the visited sites")

    actual = {p.relative_to(data).as_posix() for p in data.rglob("*.json")}
    require(actual == checked, f"Unvalidated files: {actual-checked}")
    return len(checked)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data", type=Path, nargs="?", default=Path("app/data"))
    args = parser.parse_args()
    print(f"Validated {validate(args.data)} JSON files, monthly coverage and provenance links.")
