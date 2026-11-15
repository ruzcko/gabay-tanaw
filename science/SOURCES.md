# Science validation sources

These are Python validation and optional local observer-service dependencies, not browser dependencies.
Existing terrain and Horizons sources remain credited in ../app/SOURCES.md.

| Item | Source | Licence / use |
| --- | --- | --- |
| SpiceyPy 8.4.0 | https://github.com/AndrewAnnex/SpiceyPy | MIT; validation, local observer geometric lighting/star rotation, and lossless browser coefficient preparation; no browser runtime dependency |
| jsonschema 4.26.0 | https://github.com/python-jsonschema/jsonschema | MIT; offline JSON Schema 2020-12 validation of published static data |
| NASA/JPL NAIF CSPICE bundled with SpiceyPy | https://naif.jpl.nasa.gov/naif/rules.html | NAIF toolkit terms; retain toolkit notices; no warranty |
| DE440s planetary ephemeris, lunar orientation/frame and leap-second kernels | https://naif.jpl.nasa.gov/pub/naif/generic_kernels/ | NASA/JPL NAIF data; credit NAIF and the named JPL ephemeris; local copies only, URLs and hashes recorded with results |

Observer appearance uses NAIF [pxform](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/pxform_c.html)
and the [DE440/DE421 lunar frame conventions](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/Tutorials/pdf/individual_docs/23_lunar-earth_pck-fk.pdf).
The coarse global terrain's product identity follows the [LDEM16 PDS label](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_16.lbl)
and the existing [NASA CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/) encoding.
The Hipparcos subset and its catalog epoch/magnitudes remain credited in `app/SOURCES.md`;
no generated random star positions or new media assets are added.
## Observer Earth appearance

The optional observer service additionally loads the pinned NASA NAIF
[pck00011.tpc](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc)
from `science/kernels/` (NASA/JPL public data with attribution; SHA-256
`3dff7b1dbeceaa01f25467767d3fa25816051c85d162d1edf04acb310ee28bb1`).
Its low-accuracy IAU_EARTH frame supplies display orientation only. Geometric
Sun-to-Earth directions remain DE440/NONE. Published observations are unchanged.

- US Naval Observatory, [TAI-UTC history](https://maia.usno.navy.mil/ser7/tai-utc.dat):
  published 1961–1971 UTC offset/rate segments used for browser TT/TDB conversion.
  US government factual time-standard data, public domain. TT = TAI + 32.184 s.
- NASA NSSDC [Apollo 11](https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo11info.html)
  and [Apollo 12](https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo12info.html):
  landing UTC instants used in regression checks (20:17:40 and 06:54:35 respectively).
  NASA/US government mission facts, public domain.

## Landing-screen criteria

- NASA, [candidate landing regions, 19 August 2022](https://www.nasa.gov/news-release/nasa-identifies-candidate-regions-for-landing-next-americans-on-moon/): historical 6.5-day continuous-sunlight planning basis; terrain and Earth communications considerations. NASA public information, attribution retained; no logos or imagery copied.
- NASA, [Artemis overview for Space Apps, 2025](https://ntrs.nasa.gov/api/citations/20250009323/downloads/ArtemisOverview2025IntSPAPPSChallenge.pdf): regional slope below 10 degrees over 100 m. NASA public information, attribution retained. Seven days and continuous Earth-centre visibility are adjustable application presets, not claimed NASA requirements.
- Landing terrain screens reuse the already credited LOLA LDEM_875S_20M and optional NASA PGDA fine DEMs. No new raster dataset or ephemeris dependency is introduced. NumPy retains its existing BSD licence.
