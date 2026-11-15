"""Compare monthly forecast datasets without changing either directory.

Usage: python science/compare_forecasts.py OLD_DATA NEW_DATA OUTPUT_JSON
Reports signed daily/annual minute changes and changed saved hourly states.
"""
import argparse
import json
from pathlib import Path
from fetch_ephemeris import require


def read(path):
    return json.loads(path.read_bytes())


def compare(old, new, old_months, new_months):
    require(old["window"] == new["window"], "Baseline window mismatch")
    require([d["date"] for d in old["days"]] == [d["date"] for d in new["days"]], "Baseline dates mismatch")
    result = {}
    for body in ("sun", "earth"):
        require(set(old_months) == set(new_months) == set(new["months"]), "Baseline months mismatch")
        require(all(len(old_months[m][body+"Visible"]) == len(new_months[m][body+"Visible"])
                    for m in new["months"]), "Baseline hourly coverage mismatch")
        changes = [60 * (n[body + "Hours"] - o[body + "Hours"]) for o, n in zip(old["days"], new["days"])]
        worst = max(range(len(changes)), key=lambda k: abs(changes[k]))
        result[body] = {
            "yearHours": round(sum(d[body + "Hours"] for d in new["days"]), 2),
            "yearChangeMinutes": round(sum(changes), 6),
            "maxDailyChangeMinutes": round(changes[worst], 6), "maxDailyChangeDate": new["days"][worst]["date"],
            "changedDays": sum(abs(x) > 1e-8 for x in changes),
            "dailyChanges": [{"date": new["days"][k]["date"], "minutes": round(x, 6)}
                             for k, x in enumerate(changes) if abs(x) > 1e-8],
            "changedHourlyStates": sum(a != b for label in new["months"]
                                       for a, b in zip(old_months[label][body + "Visible"], new_months[label][body + "Visible"])),
        }
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("old", type=Path)
    ap.add_argument("new", type=Path)
    ap.add_argument("output", type=Path)
    args = ap.parse_args()
    results = []
    for site in read(args.new / "sites.json"):
        sid = site["id"]
        old = read(args.old / "forecast" / f"{sid}.json")
        new = read(args.new / "forecast" / f"{sid}.json")
        old_months = {m: read(args.old / "forecast" / sid / f"{m}.json") for m in new["months"]}
        new_months = {m: read(args.new / "forecast" / sid / f"{m}.json") for m in new["months"]}
        results.append({"id": sid,
                        "baselineCoordinates": {k: old[k] for k in ("lat", "lon")},
                        "rebuiltCoordinates": {k: new[k] for k in ("lat", "lon")},
                        "changes": compare(old, new, old_months, new_months)})
    args.output.write_text(json.dumps(results, indent=2)+"\n", encoding="utf-8")
    print(f"Compared {len(results)} sites; daily changes written to {args.output}")
