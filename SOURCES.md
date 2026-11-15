# Sources

Everything Tanaw uses that we did not make, with its licence. The full tables, with
where each item is used, are in two files:

- [app/SOURCES.md](app/SOURCES.md): NASA data (LOLA, LROC, PGDA, SLDEM2015, JPL Horizons,
  NAIF kernels, Scientific Visualization Studio, Hipparcos), landing-site coordinates and
  the papers they come from, three.js, fonts, and the ERFA formulas.
- [science/SOURCES.md](science/SOURCES.md): the Python libraries and NAIF data used to
  compute and check the forecasts.

## Also used

Tools used to prepare data or test the app. None of them ships with the site.

| What | Use | Source | Licence |
|---|---|---|---|
| NumPy | Terrain, horizon and forecast scripts | https://numpy.org | BSD-3-Clause |
| Pillow | Texture and image scripts | https://python-pillow.org | MIT-CMU |
| tifffile | Reading NASA GeoTIFF elevation and colour maps | https://github.com/cgohlke/tifffile | BSD-3-Clause |
| imagecodecs | Decoding compressed TIFF data | https://github.com/cgohlke/imagecodecs | BSD-3-Clause |
| Playwright | Browser checks of the app (`verify-*.mjs`) | https://github.com/microsoft/playwright | Apache-2.0 |
