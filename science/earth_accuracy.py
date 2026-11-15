"""Offline Earth validation with NASA CSPICE, not a production ephemeris provider.

Usage: python science/earth_accuracy.py KERNEL_DIR REVIEW_DIR [--data app/data]
REVIEW_DIR contains sites.json, horizons/, cache/ and forecast/ made by the documented
three-site December rebuild. Writes earth-validation.json there. Never changes app/data.
"""
import argparse
import hashlib
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import spiceypy as spice

from build_forecast import chunks, events, hours_in, mask_at, read_table, up_intervals

FRAME = "MOON_ME_DE440_ME421"
KERNELS = ("naif0012.tls", "de440s.bsp", "moon_pa_de440_200625.bpc", "moon_de440_250416.tf")


def earth(site, utc, altitude_km=0):
    """Independent observer-fixed topocentric state, converged light time + aberration.

    OBSERVER evaluates the rotating output frame at reception, not target emission.
    CSPICE CN+S does not reproduce Horizons gravitational light deflection.
    """
    lat, lon = np.radians([site["lat"], site["lon"]])
    up = np.array([math.cos(lat)*math.cos(lon), math.cos(lat)*math.sin(lon), math.sin(lat)])
    east = np.array([-math.sin(lon), math.cos(lon), 0])
    north = np.cross(up, east)
    et = spice.str2et(utc.strftime("%Y-%m-%dT%H:%M:%S.%f"))
    state, _ = spice.spkcpo("EARTH", et, FRAME, "OBSERVER", "CN+S",
                           up*(1737.4+altitude_km), "MOON", FRAME)
    vector = state[:3]
    distance = float(np.linalg.norm(vector))
    az = math.degrees(math.atan2(vector@east, vector@north)) % 360
    el = math.degrees(math.atan2(vector@up, math.hypot(vector@east, vector@north)))
    return az, el, distance


def separation(a, e, b, f):
    def unit(az, el):
        az, el = np.radians([az, el])
        return np.array([math.cos(el)*math.sin(az), math.cos(el)*math.cos(az), math.sin(el)])
    x, y = unit(a, e), unit(b, f)
    return math.degrees(math.atan2(np.linalg.norm(np.cross(x,y)), x@y))


def published_audit(data):
    sites = json.loads((data / "sites.json").read_text())
    results = []
    for site in sites:
        index = json.loads((data / "forecast" / f"{site['id']}.json").read_text())
        errors, distances, disagreements, ambiguous = [], [], 0, 0
        mask = json.loads((data / "horizons" / f"{site['id']}.json").read_text())["elevations"]
        for label in index["months"]:
            m = json.loads((data / "forecast" / site["id"] / f"{label}.json").read_text())
            start = datetime.fromisoformat(m["start"])
            # Daily noon spans all twelve months; compare legacy observer altitude zero.
            for k in range(12, len(m["earthAz"]), 24):
                az, el, distance = earth(site, start+timedelta(hours=k))
                errors.append(separation(az, el, m["earthAz"][k], m["earthEl"][k]))
                distances.append(abs(distance-m["earthRangeKm"][k]))
                clearance = el-mask_at(mask, az)
                ambiguous += abs(clearance) <= 0.01
                disagreements += (clearance > 0) != bool(m["earthVisible"][k])
        results.append({"id": site["id"], "referenceFrame": site["referenceFrame"],
                        "samples": len(errors), "maxDirectionErrorDeg": max(errors),
                        "maxRangeErrorKm": max(distances), "visibilityDisagreements": disagreements,
                        "within001DegOfSkyline": ambiguous})
    assert max(r["maxDirectionErrorDeg"] for r in results) < 0.01, "Published Earth direction regression"
    assert max(r["maxRangeErrorKm"] for r in results) < 1, "Published Earth range regression"
    return results


def refined_event(site, altitude, mask, left, right):
    def c(t):
        a, e, _ = earth(site, t, altitude)
        return e-mask_at(mask,a)
    sign = c(left)>0
    while (right-left).total_seconds()>0.01:
        middle = left+(right-left)/2
        if (c(middle)>0)==sign:
            left=middle
        else:
            right=middle
    return left+(right-left)/2


def rebuilt_audit(data, review):
    results=[]
    for site in json.loads((review/"sites.json").read_text()):
        sid=site["id"]
        h=json.loads((review/"horizons"/f"{sid}.json").read_text())
        mask=h["calculation"]["elevations"]
        altitude=(h["surfaceElevation"]+h["observerHeight"])/1000
        times, az, el, _, ranges=read_table(chunks(review/"cache",sid,"earth"))
        direction_errors, range_errors=[],[]
        for k in range(0,len(times),6):
            a,e,r=earth(site,times[k],altitude)
            direction_errors.append(separation(a,e,az[k],el[k]))
            range_errors.append(abs(r-ranges[k]))
        # Continuous SPICE roots bracketed at one minute. Compare 10-minute and
        # 1-minute interpolation on the SAME terrain grid to isolate temporal error.
        t=[times[0]+timedelta(minutes=k) for k in range(int((times[-1]-times[0]).total_seconds()/60)+1)]
        c, any_c, full_c=[],[],[]
        for instant in t:
            a,e,r=earth(site,instant,altitude)
            value=e-mask_at(mask,a)
            radius=math.degrees(math.asin(6378.1366/r))
            c.append(value); any_c.append(value+radius); full_c.append(value-radius)
        roots=[refined_event(site,altitude,mask,t[k-1],t[k]) for k in range(1,len(t)) if (c[k-1]>0)!=(c[k]>0)]
        event_results={}
        for stride in (10,1):
            ev=events(up_intervals(t[::stride],c[::stride]),t[0],t[-1])
            errors=[abs((instant-root).total_seconds()) for (instant,_),root in zip(ev,roots)]
            event_results[str(stride)]={"events":len(ev), "referenceEvents":len(roots),
                                       "maxErrorSeconds":max(errors,default=0)}
            assert len(ev)==len(roots), "Missed Earth event in reference sampling"
        # Directly compare refetched Horizons crossings to independently solved roots.
        hc=[e-mask_at(mask,a) for a,e in zip(az,el)]
        he=events(up_intervals(times,hc),times[0],times[-1])
        assert len(he)==len(roots), "Horizons/SPICE event count mismatch"
        root_error=max((abs((at-root).total_seconds()) for (at,_),root in zip(he,roots)),default=0)
        old=json.loads((data/"forecast"/f"{sid}.json").read_text())["days"]
        new=json.loads((review/"forecast"/f"{sid}.json").read_text())["days"]
        delta={body:round(60*sum(n[body+"Hours"]-o[body+"Hours"] for n,o in zip(new,old)),6)
               for body in ("sun","earth")}
        totals={name:hours_in(up_intervals(t,values),t[0],t[-1]) for name,values in
                (("center",c),("sphericalAnyDisc",any_c),("sphericalFullDisc",full_c))}
        legacy_mask=json.loads((data/"horizons"/f"{sid}.json").read_text())["elevations"]
        # Separate height, rounding and azimuth-grid changes on one common 10-minute grid.
        variants={"legacy":[],"heightOnly":[],"unroundedOneDegree":[],"quarterDegree":[]}
        for instant in times:
            a0,e0,_=earth(site,instant,0)
            a,e,_=earth(site,instant,altitude)
            variants["legacy"].append(e0-mask_at(legacy_mask,a0))
            variants["heightOnly"].append(e-mask_at(legacy_mask,a))
            variants["unroundedOneDegree"].append(e-mask_at(mask[::4],a))
            variants["quarterDegree"].append(e-mask_at(mask,a))
        variant_hours={k:hours_in(up_intervals(times,v),times[0],times[-1]) for k,v in variants.items()}
        results.append({"id":sid,"altitudeKm":altitude,"fullPrecisionSamples":len(direction_errors),
                        "maxDirectionErrorDeg":max(direction_errors),"maxRangeErrorKm":max(range_errors),
                        "sampling":event_results,"horizonsEventMaxErrorSeconds":root_error,
                        "changeInRoundedDailyMinutes":delta,"earthHours":totals,
                        "earthVariantHours":variant_hours})
        assert max(direction_errors)<0.001, "Refetched Earth direction regression"
        assert max(range_errors)<0.1, "Refetched Earth range regression"
        print(sid, results[-1],flush=True)
    return results


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("kernels",type=Path); ap.add_argument("review",type=Path)
    ap.add_argument("--data",type=Path,default=Path("app/data"))
    args=ap.parse_args()
    records=[]
    for name in KERNELS:
        path=args.kernels/name
        spice.furnsh(str(path))
        records.append({"name":name,"sha256":hashlib.sha256(path.read_bytes()).hexdigest()})
    try:
        report={"spiceypy":spice.__version__,"kernels":records,"frame":FRAME,
                "correction":"CN+S; no gravitational deflection",
                "published":published_audit(args.data),"rebuilt":rebuilt_audit(args.data,args.review)}
        # Qualitative controls test near-side / far-side classification away from the limb.
        instant=datetime(2026,12,1,tzinfo=timezone.utc)
        near=earth({"lat":0,"lon":0},instant)[1]
        far=earth({"lat":0,"lon":180},instant)[1]
        assert near>80 and far < -80
        report["controls"]={"nearSideElevationDeg":near,"farSideElevationDeg":far}
        (args.review/"earth-validation.json").write_text(json.dumps(report,indent=2)+"\n")
    finally:
        spice.kclear()


if __name__=="__main__":
    main()
