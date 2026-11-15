"""Copy the audited complete 30-site rebuild into static data.

Usage: python science/publish_year.py REVIEW_DIR DATA_DIR
Run validate_year.py first. This copies data only; it does not commit or push.
"""
import argparse
import json
import shutil
from pathlib import Path

from fetch_ephemeris import require
from validate_year import read, sha, validate_days


def publish(review, data):
    report = read(review / "year-validation.json")
    sites = read(data / "sites.json")
    require(sites == read(review / "sites.json") and sha(data / "sites.json") == report["catalogSha256"], "Stale catalog/evidence")
    require(report["includedCount"] == len(sites) == 30 and not report["excluded"]
            and report["completeCatalog"] is True, "Expected complete 30-site audit")
    sun = read(review / "sun.json")
    expected = {"sun.json", *[f"sun/{month}.json" for month in sun["months"]]}
    for site in sites:
        sid = site["id"]
        index = read(review / "forecast" / f"{sid}.json")
        validate_days(index)
        expected.update([f"horizons/{sid}.json", f"forecast/{sid}.json",
                         *[f"forecast/{sid}/{month}.json" for month in index["months"]]])
    require(set(report["filesSha256"]) == expected, "Audit file set mismatch")
    # Check every artifact before the first write; stale output must not be published.
    for relative, digest in report["filesSha256"].items():
        require(sha(review / relative) == digest, f"Changed since audit: {relative}")
    manifest = {"schemaVersion": 1, "window": report["window"], "completeCatalog": True,
                "jsonHashConvention": report["jsonHashConvention"],
                "catalogSha256": sha(data / "sites.json"),
                "validationReportSha256": sha(review / "year-validation.json"),
                "included": [{"id": s["id"], "status": "rebuilt",
                              "frameSupport": "reviewed-catalog", "frameEvidence": s["frameEvidence"],
                              **({"positionAccuracy": s["positionAccuracy"]} if "positionAccuracy" in s else {})}
                             for s in sites],
                "excluded": [], "filesSha256": report["filesSha256"]}
    for relative in sorted(expected):
        target = data / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(review / relative, target)
    (data / "forecast-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Copied {len(expected)} audited files; all 30 catalog sites included.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("review", type=Path)
    ap.add_argument("data", type=Path)
    args = ap.parse_args()
    publish(args.review, args.data)
