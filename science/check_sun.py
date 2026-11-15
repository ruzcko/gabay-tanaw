"""Check one cached Sun elevation by hand, from the sub-solar point on the Moon.

Usage: python3 science/check_sun.py SITES_JSON CACHE_DIR SITE_ID [TIME]   (TIME like "2026-12-15 12:00")

Asks Horizons where the Sun is overhead on the Moon (quantity 15, sub-solar longitude and
latitude), then uses spherical trigonometry to get the Sun's azimuth and elevation at the site.
Prints that next to the cached topocentric value.
"""
import json
import math
import sys
from datetime import datetime

from fetch_ephemeris import request_text
from build_forecast import chunks, load_sites, read_table


def subsolar(time):
    params = {"COMMAND": "301", "CENTER": "500@399", "MAKE_EPHEM": "YES", "EPHEM_TYPE": "OBSERVER",
              "TLIST": time, "TLIST_TYPE": "CAL", "TIME_TYPE": "UT", "QUANTITIES": "15",
              "CSV_FORMAT": "YES", "OBJ_DATA": "NO"}
    text = request_text(params)
    row = text.split("$$SOE")[1].split("$$EOE")[0].strip().split(",")
    return float(row[3]), float(row[4])  # east longitude, latitude (degrees)


def sun_from_subpoint(site, lon_s, lat_s):
    """Independent spherical check; omits the <0.001 degree solar parallax."""
    p1, p2 = math.radians(site["lat"]), math.radians(lat_s)
    dl = math.radians(lon_s - site["lon"])
    # Angle from the zenith to the Sun; the Sun is far enough that the site's 1737 km offset
    # from the Moon's centre shifts it by under 0.001°.
    cos_z = math.sin(p1) * math.sin(p2) + math.cos(p1) * math.cos(p2) * math.cos(dl)
    el_hand = 90 - math.degrees(math.acos(max(-1, min(1, cos_z))))
    az_hand = math.degrees(math.atan2(math.sin(dl) * math.cos(p2),
                                      math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl))) % 360

    return az_hand, el_hand


def main(sites_path, cache_dir, site_id, time="2026-12-15 12:00"):
    site = next(s for s in load_sites(sites_path) if s["id"] == site_id)
    times, az, el, *_ = read_table(chunks(cache_dir, site_id, "sun"))
    k = times.index(datetime.strptime(time, "%Y-%m-%d %H:%M").replace(tzinfo=times[0].tzinfo))
    lon_s, lat_s = subsolar(time)
    az_hand, el_hand = sun_from_subpoint(site, lon_s, lat_s)
    print(f"{site['name']} ({site['lat']}, {site['lon']} E) at {time} UT")
    print(f"  sub-solar point (Horizons q15): lon {lon_s:.4f} E, lat {lat_s:.4f}")
    print(f"  by hand:          az {az_hand:9.4f}  el {el_hand:7.4f}")
    print(f"  Horizons (cache): az {az[k]:9.4f}  el {el[k]:7.4f}")
    print(f"  difference:       az {az_hand - az[k]:9.4f}  el {el_hand - el[k]:7.4f}  (degrees)")


if __name__ == "__main__":
    main(*sys.argv[1:])
