"""Measure cold fetch, build and warm rebuild for one site, without touching app data.

python science/benchmark_forecast.py SITES_JSON HORIZONS_DIR NEW_OUTPUT_DIR [--batch]

Requires an existing scientific horizon. Makes sequential live Horizons requests;
the output directory must not exist, so each window starts with an empty local cache.
This measures data preparation, not terrain downloads, browser transfer or rendering.
"""
import argparse
import json
import platform
import statistics
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from fetch_ephemeris import load_sites
from validate_data import validate_source_coverage

SCIENCE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sites", type=Path)
    parser.add_argument("horizons", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--start", default="2026-12-01")
    parser.add_argument("--days", type=int, nargs="+", default=[7, 14, 28, 90, 182, 365])
    parser.add_argument("--batch", action="store_true")
    args = parser.parse_args()
    sites = load_sites(args.sites)
    if len(sites) != 1 or any(d <= 0 for d in args.days) or len(set(args.days)) != len(args.days):
        parser.error("Select exactly one site and distinct positive durations")
    args.output.mkdir(parents=True, exist_ok=False)
    validators = {name: Draft202012Validator(json.loads((SCIENCE/"schemas"/f"{name}.schema.json").read_bytes()),
                                            format_checker=FormatChecker())
                  for name in ("forecast", "forecast-month")}
    report = {"python": platform.python_version(), "platform": platform.platform(),
              "site": sites[0], "start": args.start, "stepMinutes": 10,
              "batch": args.batch, "runs": []}

    def run(log, script, arguments):
        start = time.perf_counter()
        with log.open("w") as stream:
            subprocess.run([sys.executable, "-B", str(SCIENCE/script), *map(str, arguments)],
                           stdout=stream, stderr=subprocess.STDOUT, check=True)
        return time.perf_counter() - start

    for days in args.days:
        folder = args.output/f"{days}d"
        folder.mkdir()
        fetch_args = [args.sites, folder/"cache", args.start, days, "--horizons", args.horizons]
        if args.batch:
            fetch_args.append("--batch")
        fetch = run(folder/"fetch.log", "fetch_ephemeris.py", fetch_args)
        build_args = [args.sites, folder/"cache", args.horizons, folder/"forecast"]
        build = run(folder/"build.log", "build_forecast.py", build_args)
        warm_fetch = run(folder/"cache-hit.log", "fetch_ephemeris.py", fetch_args)
        warm_builds = [run(folder/f"warm-build-{i}.log", "build_forecast.py", build_args) for i in range(3)]
        sid = sites[0]["id"]
        index = json.loads((folder/"forecast"/f"{sid}.json").read_bytes())
        validators["forecast"].validate(index)
        validate_source_coverage(index["science"]["sources"], datetime.fromisoformat(index["window"]["start"]),
                                 datetime.fromisoformat(index["window"]["end"]), 10)
        hours = 0
        for label in index["months"]:
            month = json.loads((folder/"forecast"/sid/f"{label}.json").read_bytes())
            validators["forecast-month"].validate(month)
            lengths = {len(v) for k, v in month.items() if k not in ("start", "stepMinutes")}
            if len(lengths) != 1:
                raise ValueError("Unequal monthly array lengths")
            hours += lengths.pop()
        if len(index["days"]) != days or hours != days*24:
            raise ValueError("Incomplete forecast coverage")
        row = {"days": days, "fetchSeconds": fetch, "buildSeconds": build,
               "cacheValidationSeconds": warm_fetch, "warmBuildSeconds": warm_builds,
               "warmBuildMedianSeconds": statistics.median(warm_builds),
               "rawResponseFiles": len(list((folder/"cache").rglob("*.gz"))),
               "forecastBytes": sum(p.stat().st_size for p in (folder/"forecast").rglob("*.json"))}
        report["runs"].append(row)
        (args.output/"results.json").write_text(json.dumps(report, indent=2)+"\n")
        print(json.dumps(row), flush=True)


if __name__ == "__main__":
    main()
