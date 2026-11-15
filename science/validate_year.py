"""Audit a prepared full-year rebuild before publishing generated data.

Usage: python science/validate_year.py REVIEW_DIR KERNEL_DIR BASELINE_DATA_DIR
REVIEW_DIR contains the reviewed sites.json, horizons/, cache/, forecast/.
Writes year-validation.json only after structural, replay and SPICE checks pass.
"""
import argparse
import hashlib
import json
from datetime import datetime, timedelta
from pathlib import Path

import spiceypy as spice

from build_forecast import build, chunks, mask_at, read_table, read_columns
from compare_forecasts import compare
from check_sun import sun_from_subpoint
from earth_accuracy import FRAME, earth, refined_event, separation
from fetch_ephemeris import observer_altitude_km, require
from fetch_validation_kernels import FILES

START = datetime.fromisoformat("2026-12-01T00:00:00+00:00")
END = datetime.fromisoformat("2027-12-01T00:00:00+00:00")


def read(path):
    return json.loads(path.read_bytes())


def sha(path):
    raw = path.read_bytes()
    # Git may check JSON out as CRLF on Windows; hash the repository LF form.
    return hashlib.sha256(raw.replace(b"\r\n", b"\n") if path.suffix == ".json" else raw).hexdigest()


def validate_days(index):
    """Integrate exported events independently of the builder's interval functions."""
    require(index["window"] == {"start": "2026-12-01T00:00:00Z", "end": "2027-12-01T00:00:00Z"}, "Wrong year")
    days = index["days"]
    require(len(days) == 365, "Incomplete daily coverage")
    for body in ("sun", "earth"):
        all_events = sorted((datetime.fromisoformat(at), kind)
                            for d in days for kind in ("rise", "set") for at in d[body + kind])
        require(all(START < at < END for at, _ in all_events), "Event outside open window")
        state = index[body + "UpAtStart"]
        require(type(state) is bool, "Nonboolean starting state")
        for k, day in enumerate(days):
            left = START + timedelta(days=k)
            right = left + timedelta(days=1)
            require(day["date"] == left.date().isoformat(), "Missing/duplicate/reordered date")
            require(type(day[body + "UpAt0"]) is bool and day[body + "UpAt0"] == state, "Midnight state mismatch")
            duration, cursor = 0.0, left
            daily = sorted((datetime.fromisoformat(at), kind)
                           for kind in ("rise", "set") for at in day[body + kind])
            for at, kind in daily:
                require(left <= at < right and at >= cursor, "Event in wrong day")
                require((kind == "set") == state, "Nonalternating events")
                duration += (at - cursor).total_seconds() if state else 0
                state, cursor = kind == "rise", at
            duration += (right - cursor).total_seconds() if state else 0
            hours = day[body + "Hours"]
            # Daily hours round to .01 h; each exported crossing truncates <1 second.
            require(0 <= hours <= 24 and abs(hours * 3600 - duration) <= 18.000001 + len(daily), "Hours/event inconsistency")
            expected = next(({"kind": kind, "at": at.strftime("%Y-%m-%dT%H:%M:%SZ")}
                             for at, kind in all_events if at > left), None)
            require(day["next" + body.title() + "Event"] == expected, "Incorrect next event")


def accuracy(site, review):
    sid = site["id"]
    horizon = read(review / "horizons" / f"{sid}.json")
    mask = horizon["calculation"]["elevations"]
    altitude = observer_altitude_km(site, horizon)
    times, az, el, _, ranges = read_table(chunks(review / "cache", sid, "earth"))
    require(times[0] == START and times[-1] == END and len(times) == 52561, "Incomplete ten-minute year")
    clear = [e - mask_at(mask, a) for a, e in zip(az, el)]
    direction, distance, rounded_direction, rounded_distance, disagreements = [], [], [], [], 0
    for k in range(0, len(times), 6):
        a, e, r = earth(site, times[k], altitude)
        direction.append(separation(a, e, az[k], el[k]))
        distance.append(abs(r - ranges[k]))
        rounded_direction.append(separation(a, e, round(az[k], 2), round(el[k], 2)))
        rounded_distance.append(abs(r - round(ranges[k])))
        disagreements += (e - mask_at(mask, a) > 0) != (clear[k] > 0)
    # A targeted one-minute scan includes every crossing bracket and near-limb
    # bracket. It can expose missed short windows, but is not an all-year dense scan.
    sampled, roots, errors, missed, extra = 0, 0, [], 0, 0
    for k in range(1, len(times)):
        crossing = (clear[k-1] > 0) != (clear[k] > 0)
        if not crossing and min(abs(clear[k-1]), abs(clear[k])) > 0.02:
            continue
        t = [times[k-1] + timedelta(minutes=m) for m in range(11)]
        c = []
        for instant in t:
            a, e, _ = earth(site, instant, altitude)
            c.append(e - mask_at(mask, a))
        found = [refined_event(site, altitude, mask, t[j-1], t[j])
                 for j in range(1, 11) if (c[j-1] > 0) != (c[j] > 0)]
        sampled += 1
        roots += len(found)
        missed += max(0, len(found) - int(crossing))
        extra += max(0, int(crossing) - len(found))
        if crossing and len(found) == 1:
            interpolated = times[k-1] + (times[k] - times[k-1]) * (clear[k-1] / (clear[k-1] - clear[k]))
            errors.append(abs((interpolated - found[0]).total_seconds()))
    require(max(direction) < 0.001 and max(distance) < 0.1, f"{sid}: Earth direction/range regression")
    require(max(rounded_direction) < 0.01 and max(rounded_distance) < 1, f"{sid}: Rounded Earth output regression")
    require(disagreements == 0, f"{sid}: Hourly Earth visibility disagreement")
    require(missed == extra == 0, f"{sid}: Near-limb reference crossing count mismatch")
    return {"hourlySamplesIncludingEndpoint": len(direction), "maxDirectionErrorDeg": max(direction),
            "maxRangeErrorKm": max(distance), "hourlyVisibilityDisagreements": disagreements,
            "maxRoundedDirectionErrorDeg": max(rounded_direction), "maxRoundedRangeErrorKm": max(rounded_distance),
            "nearLimbTenMinuteBrackets": sampled, "referenceCrossings": roots,
            "matchedCrossings": len(errors), "missedCrossings": missed, "extraCrossings": extra,
            "maxCrossingErrorSeconds": max(errors, default=0)}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("review", type=Path)
    ap.add_argument("kernels", type=Path)
    ap.add_argument("baseline", type=Path)
    args = ap.parse_args()
    sites = read(args.review / "sites.json")
    require(sites == read(args.baseline / "sites.json"), "Catalog differs from reviewed baseline")
    require(len(sites) == 30 and len({s['id'] for s in sites}) == 30, "Expected all 30 reviewed sites")
    require(all(s.get("referenceFrame") == "MOON_ME_DE421" and s.get("frameEvidence") for s in sites),
            "Missing accepted frame/evidence")
    comparisons = read(args.review / "forecast-changes.json")
    require(len(comparisons) == len(sites) and {s["id"] for s in comparisons} == {s["id"] for s in sites}, "Incomplete comparison report")
    comparisons = {s["id"]: s for s in comparisons}
    kernels = []
    for path, digest in FILES.items():
        local = args.kernels / Path(path).name
        require(sha(local) == digest, "Unreviewed SPICE kernel")
        spice.furnsh(str(local))
        kernels.append({"name": local.name, "sha256": digest})
    results, files = [], {}
    try:
        sun = read(args.review / "sun.json")
        require(sun["window"] == {"start": "2026-12-01T00:00:00Z", "end": "2027-12-01T00:00:00Z"}, "Sub-point window mismatch")
        times, columns = read_columns(args.review / "cache" / "moon-subpoints.txt.gz")
        require(len(times) == 8761 and times[0] == START and times[-1] == END
                and all(b-a == timedelta(hours=1) for a, b in zip(times, times[1:])), "Incomplete sub-point cadence")
        arrays = {k: [] for k in ("subsolarLat", "subsolarLon", "subEarthLat", "subEarthLon")}
        for label in sun["months"]:
            relative = f"sun/{label}.json"
            month = read(args.review / relative)
            for key in arrays:
                arrays[key].extend(month[key])
            files[relative] = sha(args.review / relative)
        for key, column in [("subsolarLat", "SunSub-LAT"), ("subsolarLon", "SunSub-LON"),
                            ("subEarthLat", "ObsSub-LAT"), ("subEarthLon", "ObsSub-LON")]:
            expected = [round(x, 4) % 360 if key.endswith("Lon") else round(x, 4) for x in columns[column][:-1]]
            require(arrays[key] == expected, f"{key}: sub-points differ from cached source")
        files["sun.json"] = sha(args.review / "sun.json")
        for site in sites:
            sid = site["id"]
            index = read(args.review / "forecast" / f"{sid}.json")
            validate_days(index)
            replay, monthly = build(site, args.review / "cache", args.review / "horizons")
            require(index == replay, f"{sid}: Index differs from validated raw rebuild")
            require(len(monthly) == 12 and sum(len(m["earthAz"]) for m in monthly.values()) == 8760, "Incomplete monthly year")
            old_months = {}
            for label, month in monthly.items():
                require(read(args.review / "forecast" / sid / f"{label}.json") == month, f"{sid}: Month differs from raw rebuild")
                old_months[label] = read(args.baseline / "forecast" / sid / f"{label}.json")
            for relative in [f"horizons/{sid}.json", f"forecast/{sid}.json",
                             *[f"forecast/{sid}/{label}.json" for label in monthly]]:
                files[relative] = sha(args.review / relative)
            delta = compare(read(args.baseline / "forecast" / f"{sid}.json"), index, old_months, monthly)
            require(comparisons[sid]["changes"] == delta, f"{sid}: stale comparison report")
            # Detailed per-day deltas live once in forecast-changes.json; retain
            # compact aggregate changes here and bind that report by its hash.
            delta = {body: {k: v for k, v in values.items() if k != "dailyChanges"}
                     for body, values in delta.items()}
            sun_az = [a for month in monthly.values() for a in month["sunAz"]]
            sun_el = [e for month in monthly.values() for e in month["sunEl"]]
            sun_error = max(separation(*sun_from_subpoint(site, lon, lat), a, e)
                            for lon, lat, a, e in zip(arrays["subsolarLon"], arrays["subsolarLat"], sun_az, sun_el))
            require(sun_error < 0.01, f"{sid}: Sun/sub-point direction mismatch")
            if sid in ("apollo-11", "change-4", "change-6"):
                known = 24 if sid == "apollo-11" else 0
                require(all(d["earthHours"] == known for d in index["days"]), f"{sid}: near/far-side control failed")
            result = {"id": sid, "terrain": index["horizon"], "changes": delta,
                      "sunSubpointMaxDirectionDifferenceDeg": sun_error,
                      "earthAccuracy": accuracy(site, args.review)}
            results.append(result)
            print(f"{sid}: 365 days / 12 months validated; Earth hourly disagreements "
                  f"{result['earthAccuracy']['hourlyVisibilityDisagreements']}; "
                  f"max crossing difference {result['earthAccuracy']['maxCrossingErrorSeconds']:.6f} s", flush=True)
        report = {"window": {"start": START.isoformat(), "end": END.isoformat()},
                  "includedCount": len(sites), "excluded": [], "completeCatalog": True,
                  "catalogSha256": sha(args.review / "sites.json"),
                  "changesReportSha256": sha(args.review / "forecast-changes.json"),
                  "baselineRevision": "79bf18a",
                  "monthFiles": 12*len(sites), "hourlyInstants": 8760*len(sites), "dailySummaries": 365*len(sites),
                  "spiceypy": spice.__version__, "kernels": kernels, "frame": FRAME,
                  "reference": "CSPICE CN+S, related JPL model; no gravitational deflection or independent terrain truth",
                  "eventScan": "One-minute SPICE samples within 10-minute brackets crossing zero or having an endpoint within 0.02 degrees of the skyline; roots bisected to 0.01 seconds. Narrower or unselected events can be missed.",
                  "jsonHashConvention": "SHA-256 of UTF-8 JSON bytes with CRLF normalized to LF",
                  "filesSha256": files, "sites": results}
        (args.review / "year-validation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    finally:
        spice.kclear()


if __name__ == "__main__":
    main()
