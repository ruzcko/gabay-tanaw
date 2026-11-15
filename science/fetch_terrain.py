"""Download SLDEM2015 elevation around each landing site between 60 S and 60 N.

Usage: python science/fetch_terrain.py <sites.json> <out_dir>

SLDEM2015 (LOLA + Kaguya TC, 128 px/degree, about 237 m at the equator) is one
2.8 GB file, so this reads only a window per site with HTTP Range requests:
+-5.5 degrees of latitude and +-5.5 / cos(|lat| + 5.5) degrees of longitude, which
holds every 150 km horizon ray. Each window is saved as <out_dir>/<id>.npz:
  z        float32 heights above the 1,737,400 m sphere, metres; rows run south
  lat0     latitude of the first pixel centre (row 0), degrees
  lon0     longitude of the first pixel centre (column 0), degrees, may be < 0
  step     pixel size, degrees (latitude falls by step per row, longitude rises)
  url, ranges   the source file and the byte ranges read
Existing files are skipped.

File layout, from its PDS label: 46080 x 15360 little-endian float32 (PC_REAL),
kilometres above 1737.4 km, MEAN EARTH/POLAR AXIS OF DE421, pixel registered:
row i is centred on latitude 60 - (i + 0.5) / 128, column j on longitude
(j + 0.5) / 128 east.
"""
import http.client
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

import numpy as np

URL = ("https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/"
       "sldem2015/global/float_img/sldem2015_128_60s_60n_000_360_float.img")
PPD = 128
ROWS, COLS = 15360, 46080
ROW_BYTES = COLS * 4
HALF = 5.5             # window half-size, degrees of latitude
ROWS_PER_REQUEST = 64
MAX_BYTES = 400e6


def window(lat, lon):
    """Rows (first, last) and column indices (may wrap past 360) for a site."""
    r0 = max(int(np.floor((60 - lat - HALF) * PPD - 0.5)), 0)
    r1 = min(int(np.ceil((60 - lat + HALF) * PPD - 0.5)), ROWS - 1)
    w = HALF / np.cos(np.radians(abs(lat) + HALF))
    c0 = int(np.floor((lon - w) * PPD - 0.5))
    c1 = int(np.ceil((lon + w) * PPD - 0.5))
    return r0, r1, c0, c1


def row_ranges(row, c0, c1):
    """Byte ranges (first, last inclusive) for columns c0..c1 of one row, split at 360."""
    cols = np.arange(c0, c1 + 1) % COLS
    breaks = np.nonzero(np.diff(cols) != 1)[0] + 1
    return [(row * ROW_BYTES + seg[0] * 4, row * ROW_BYTES + seg[-1] * 4 + 3)
            for seg in np.split(cols, breaks)]


def fetch(conn, path, ranges):
    """Bytes for each range, using one multi-range request."""
    spec = ",".join(f"{a}-{b}" for a, b in ranges)
    conn.request("GET", path, headers={"Range": f"bytes={spec}"})
    resp = conn.getresponse()
    if resp.status != 206:
        resp.close()
        raise RuntimeError(f"HTTP {resp.status}")
    # Never read an ignored Range request's entire 2.8 GB product into memory.
    limit = sum(b - a + 1 for a, b in ranges) + 1024 * len(ranges)
    body = resp.read(limit + 1)
    if len(body) > limit:
        resp.close()
        raise ValueError("Oversized range response")
    ctype = resp.getheader("Content-Type", "")
    expected = {int(a): int(b) for a, b in ranges}
    parts = {}

    def add(header, data):
        match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", header.strip())
        if not match:
            raise ValueError("Missing/invalid Content-Range")
        a, b, total = map(int, match.groups())
        if total != ROWS * ROW_BYTES or expected.get(a) != b or a in parts or len(data) != b-a+1:
            raise ValueError("Unexpected, duplicate or short terrain range")
        parts[a] = data

    if len(ranges) == 1 and not ctype.startswith("multipart/"):
        add(resp.getheader("Content-Range", ""), body)
        return parts, len(body)
    match = re.search(r'boundary="?([^";\s]+)', ctype)
    if not match:
        raise ValueError("Missing multipart boundary")
    boundary = match[1].encode()
    for chunk in body.split(b"--" + boundary)[1:]:
        if chunk.startswith(b"--"):
            break
        head, _, rest = chunk.partition(b"\r\n\r\n")
        headers = [h for h in head.split(b"\r\n") if h.lower().startswith(b"content-range:")]
        if len(headers) != 1 or not rest.endswith(b"\r\n"):
            raise ValueError("Malformed terrain part")
        add(headers[0].split(b":", 1)[1].decode("ascii"), rest[:-2])
    if set(parts) != set(expected):
        raise ValueError("Missing terrain ranges")
    return parts, len(body)


def main():
    sites_path, out_dir = sys.argv[1:3]
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    todo = [s for s in json.loads(Path(sites_path).read_text(encoding="utf-8"))
            if -60 <= s["lat"] <= 60 and not (out / f"{s['id']}.npz").exists()]
    plans = {}
    for s in todo:
        r0, r1, c0, c1 = window(s["lat"], s["lon"])
        plans[s["id"]] = (r0, r1, c0, c1, [row_ranges(r, c0, c1) for r in range(r0, r1 + 1)])
    need = sum(4 * (p[1] - p[0] + 1) * (p[3] - p[2] + 1) for p in plans.values())
    print(f"{len(todo)} windows, {need / 1e6:.1f} MB of pixels")
    if need > MAX_BYTES:
        sys.exit(f"would read more than {MAX_BYTES / 1e6:.0f} MB; stopping")
    u = urlsplit(URL)
    conn = http.client.HTTPSConnection(u.netloc, timeout=120)
    total = 0
    for s in todo:
        r0, r1, c0, c1, rows = plans[s["id"]]
        flat = [rg for row in rows for rg in row]
        got = {}
        for i in range(0, len(flat), ROWS_PER_REQUEST):
            parts, n = fetch(conn, u.path, flat[i:i + ROWS_PER_REQUEST])
            got.update(parts)
            total += n
        data = b"".join(got[a][:b - a + 1] for a, b in flat)
        if len(data) != 4 * (r1 - r0 + 1) * (c1 - c0 + 1):
            raise RuntimeError(f"{s['id']}: short read")
        z = np.frombuffer(data, dtype="<f4").reshape(r1 - r0 + 1, c1 - c0 + 1) * np.float32(1000)
        if not np.isfinite(z).all():
            raise ValueError(f"{s['id']}: nonfinite terrain")
        np.savez_compressed(
            out / f"{s['id']}.npz", z=z.astype(np.float32),
            lat0=60 - (r0 + 0.5) / PPD, lon0=(c0 + 0.5) / PPD, step=1 / PPD,
            url=URL, ranges=np.array(flat, dtype=np.int64))
        print(f"{s['id']:20s} {z.shape[0]} x {z.shape[1]}  {z.min():8.1f} .. {z.max():8.1f} m")
    conn.close()
    print(f"downloaded {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
