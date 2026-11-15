"""Download the four pinned NASA NAIF kernels for earth_accuracy.py, outside app/.

Usage: python science/fetch_validation_kernels.py science/cache/kernels
"""
import hashlib
import sys
import urllib.request
from pathlib import Path

BASE="https://naif.jpl.nasa.gov/pub/naif/generic_kernels/"
FILES={
    "lsk/naif0012.tls":"678e32bdb5a744117a467cd9601cd6b373f0e9bc9bbde1371d5eee39600a039b",
    "spk/planets/de440s.bsp":"c1c7feeab882263fc493a9d5a5b2ddd71b54826cdf65d8d17a76126b260a49f2",
    "pck/moon_pa_de440_200625.bpc":"60cd55aa401ea2ea97360636f567554bfe4e37bb829f901b4460a455dfaf783f",
    "fk/satellites/moon_de440_250416.tf":"a47c71e9c9f33796bdafb2c9d69a7ee447b6016ecad80f71cd6f3e479f9cf768",
}


def main(folder):
    out=Path(folder)
    out.mkdir(parents=True,exist_ok=True)
    for path,expected in FILES.items():
        target=out/Path(path).name
        if target.exists():
            data=target.read_bytes()
        else:
            with urllib.request.urlopen(BASE+path,timeout=120) as response:
                data=response.read()
        if hashlib.sha256(data).hexdigest()!=expected:
            raise ValueError(f"Kernel checksum changed: {path}; review before using")
        if not target.exists():
            temporary=target.with_suffix('.tmp')
            temporary.write_bytes(data)
            temporary.replace(target)
        print(f"verified {target}",flush=True)


if __name__=='__main__': main(*sys.argv[1:])
