# Validation: our horizons against published sunlight

**Summary.** With NASA's 5 m terrain near the site and 240 m terrain beyond, our sunlight
2 m above the ground matches Gläser et al. (2018) within 2 percentage points at all four of
their published south-pole points. The share of time the Sun is at least partly up matches
within 1.3 points. On 240 m terrain alone we reproduce the pattern of NASA's polar sunlight
map (correlation 0.90, mean absolute difference 4.0 points), and 240 m terrain misjudges
narrow ridges. The app's horizons use the 5 m terrain wherever NASA publishes it.

## What we compared

- **Gläser et al. (2018)**, 20 m LOLA terrain, hourly from 2017 to 2037. Their Tables 1 and 2
  give the best-lit points on Connecting Ridge and the Shackleton rim, at ground level and
  2 m up, with coordinates to four decimals.
- **NASA PGDA polar illumination maps** ([product 69](https://pgda.gsfc.nasa.gov/products/69),
  Mazarico et al. 2011, `AVGVISIB_65S_240M_201608` and `AVGVISIB_85S_060M_201608`): per pixel,
  the visible fraction of the Sun's disc, averaged hourly over 18.6 years, at ground level.
- **Mazarico et al. (2011)**, Table 3: the 240 m results that NASA's map is built on.

All three report the average visible fraction of the Sun's disc. We compute the same from our
horizons (`sunlight.py`). The Sun's latitude seen from the Moon swings ±1.54° over 346.6 days
while it circles the sky every 29.5 days. Over 18.6 years every combination is visited evenly,
so we average over that grid. The Sun is a disc 0.27° in radius, cut horizontally by the
horizon, without limb darkening.

Every table below is printed by:

```sh
python science/validate.py science/cache/raw/ldem_75s_240m.img app/data/sites.json science/cache/raw/pgda_5mpp
```

## 1. Against Gläser et al. 2018, at their published points

| Point | Height | Gläser 20 m | Ours 240 m | Ours 5 m + 240 m | Sun partly up: Gläser / ours 5 m |
| --- | --- | --- | --- | --- | --- |
| Connecting Ridge C1 (-89.4398, 222.83) | 2 m | 88.0% | 75.5% | 86.1% | 92.1% / 91.0% |
| Connecting Ridge C2 (-89.313, 245.98) | 2 m | 78.1% | 70.1% | 78.7% | 82.0% / 82.5% |
| Shackleton rim (-89.6866, 197.19) | 2 m | 85.5% | 61.3% | 84.2% | 89.4% / 88.9% |
| Shackleton rim (-89.7815, 204.7) | 2 m | 82.1% | 83.7% | 82.0% | 89.8% / 88.5% |
| Connecting Ridge C1 (-89.4505, 222.84) | 0 m | 76.0% | 48.8% | 40.0% | 81.3% / 47.2% |
| Connecting Ridge C2 (-89.3157, 245.94) | 0 m | 75.6% | 43.5% | 48.9% | 80.6% / 55.2% |
| Shackleton rim (-89.7849, 203.97) | 0 m | 81.0% | 45.9% | 51.2% | 85.5% / 57.9% |

At 2 m, the 5 m terrain closes the gap: differences of −1.9, +0.6, −1.3 and −0.1 points,
against −8.0 to −24.2 points on 240 m terrain alone at three of the four points.

At ground level (0 m) we disagree by 27–36 points. There, the horizon in the Sun's direction is
set by the slope of the ground within a few metres, so the answer depends on the grid: a
20 m pixel averages away the slopes that a 5 m grid resolves, and a point given to four
decimals (±5 m) can sit on either side of a crest. We don't use ground-level values; the app
uses 2 m, where results agree.

## 2. Against NASA's 240 m map, like for like

Here we use 240 m terrain only, put our observer on the ground at the centre of the PGDA
pixel that contains each site, and repeat for its 8 neighbours.

| Site | PGDA 240 m | Ours, same pixel | Diff | PGDA 60 m, mean (max) in that pixel | Ours at site, 2 m, 240 m only | Sun partly up, same |
| --- | --- | --- | --- | --- | --- | --- |
| Connecting Ridge | 74.7% | 67.6% | -7.2% | 52.3% (65.0%) | 75.5% | 81.7% |
| Connecting Ridge Extension | 77.1% | 78.0% | +0.9% | 52.0% (75.2%) | 70.1% | 76.2% |
| Shackleton rim | 89.2% | 85.2% | -4.0% | 56.3% (87.1%) | 61.3% | 66.4% |
| Peak near Shackleton | 88.2% | 85.6% | -2.6% | 61.6% (86.0%) | 82.2% | 86.5% |
| de Gerlache rim | 55.0% | 61.6% | +6.6% | 50.7% (76.2%) | 68.3% | 72.2% |
| Malapert massif | 74.1% | 77.0% | +2.9% | 55.5% (77.6%) | 73.8% | 80.9% |
| Mons Mouton | 61.6% | 68.8% | +7.1% | 50.3% (65.8%) | 72.6% | 76.8% |
| IM-2 Athena, Mons Mouton | 45.0% | 43.7% | -1.3% | - | 45.2% | 46.9% |
| IM-1 Odysseus, near Malapert A | 41.1% | 39.0% | -2.0% | - | 39.0% | 39.6% |
| Peak near Cabeus B | 70.8% | 69.1% | -1.6% | - | 69.3% | 71.5% |
| Haworth | 62.1% | 58.0% | -4.1% | 44.8% (54.6%) | 59.3% | 64.5% |
| Mons Mouton Plateau | 53.6% | 53.0% | -0.6% | - | 53.2% | 54.2% |
| Nobile Rim 1 | 78.8% | 79.4% | +0.6% | 59.2% (75.3%) | 84.4% | 88.9% |
| Nobile Rim 2 | 53.9% | 52.8% | -1.1% | - | 52.8% | 53.8% |

All 126 pixels of the 3 × 3 patches: mean difference −1.9 points, mean absolute difference
4.0 points, largest 31.7 points, correlation 0.90. The 60 m map covers only 85°S to the pole.

At Mazarico et al.'s own points (ground level, 240 m):

| Point | Mazarico 2011 | PGDA map 2016, that pixel | Ours, that pixel |
| --- | --- | --- | --- |
| Connecting Ridge (-89.45, 222.69) | 89.0% | 93.5% | 81.5% |
| Shackleton rim (-89.78, 204.27) | 86.7% | 90.8% | 86.6% |

Shackleton rim matches the 2011 paper to 0.1 points. NASA's 2016 map and the 2011 paper
differ from each other by about 4 points at both points.

## 3. What the app uses

Each site, 2 m above the ground, average visible fraction of the Sun's disc:

| Site | 240 m only | 5 m + 240 m | Sun partly up, 5 m + 240 m |
| --- | --- | --- | --- |
| Connecting Ridge | 75.5% | 86.1% | 91.0% |
| Connecting Ridge Extension | 70.1% | 78.7% | 82.5% |
| Shackleton rim | 61.3% | 84.2% | 88.9% |
| Peak near Shackleton | 82.2% | 85.2% | 88.5% |
| de Gerlache rim | 68.3% | 82.7% | 86.4% |
| Malapert massif | 73.8% | 82.3% | 85.5% |
| Mons Mouton | 72.6% | 77.8% | 81.3% |
| IM-2 Athena, Mons Mouton | 45.2% | 45.2% | 46.9% |
| Nobile Rim 1 | 84.4% | 84.1% | 88.7% |

IM-1, Peak near Cabeus B, Haworth, Mons Mouton Plateau and Nobile Rim 2 have no 5 m map
nearby and use 240 m terrain. IM-2 and Nobile Rim 1 sit outside the 5 m maps; only terrain
some kilometres away comes from one, so their values barely change.

## 4. Derived spots

De Rosa et al. (2012) publish Peak near Shackleton, de Gerlache rim, Malapert massif and
Leibnitz Beta plateau (now Mons Mouton) as centres of regions, not as spots to land. LROC's
image mosaics and NASA PGDA's Site06 map give centres for Peak near Cabeus B, Haworth, Mons
Mouton Plateau, Nobile Rim 1 and Nobile Rim 2. A region centre can sit in a hollow: the
Leibnitz Beta centre gets 6.3% sunlight. `best_spot.py` searches for the sunniest point 2 m up
whose slope over 100 m is under 10°, the landing limit in NASA's Human Landing System
overview. The first four are searched within 2 km of the centre. NASA's 2024 regions are
about 15 × 15 km, so the other five are searched within 7.5 km of the centre and inside the
region's published extent (the LROC mosaic for four of them, the Site06 map for Nobile Rim 1). The first four use NASA's 5 m terrain; the
other five lie outside the 5 m maps and use 240 m terrain. On 240 m terrain the 100 m slope
is smoothed, so true slopes at those five spots may be steeper. `sites.json` marks them
`"derived": true` and keeps the published centre in `regionCentre`.

`python science/best_spot.py science/cache/raw/ldem_75s_240m.img app/data/sites.json science/cache/raw/pgda_5mpp`

| Site | Centre: sunlight, slope | Best spot: sunlight, slope | Distance |
| --- | --- | --- | --- |
| Peak near Shackleton | 42.9%, 4.4° | 85.2%, 1.8° | 541 m |
| de Gerlache rim | 48.2%, 0.6° | 82.7%, 1.8° | 753 m |
| Malapert massif | 70.7%, 4.9° | 82.3%, 4.9° | 483 m |
| Mons Mouton | 6.3%, 7.1° | 77.8%, 2.6° | 1458 m |
| Peak near Cabeus B | 50.6%, 7.7° | 69.3%, 4.5° | 874 m |
| Haworth | 31.5%, 9.4° | 59.3%, 1.2° | 6999 m |
| Mons Mouton Plateau | 28.4%, 7.2° | 53.2%, 3.8° | 4869 m |
| Nobile Rim 1 | 30.2%, 15.7° | 84.1%, 5.0° | 4074 m |
| Nobile Rim 2 | 34.8%, 10.6° | 52.8%, 3.9° | 5016 m |

Picking the best of thousands of points can favour a single point where terrain errors happen
to help. Two checks say these spots are real:

| Site | Ours at spot, 2 m | Ours 20 m around it: min to max (8 points) | PGDA 60 m pixel, ground level |
| --- | --- | --- | --- |
| Peak near Shackleton | 85.2% | 77.4% to 85.0% | 70.2% |
| de Gerlache rim | 82.7% | 81.2% to 82.9% | 57.1% |
| Malapert massif | 82.3% | 75.4% to 82.4% | 73.8% |
| Mons Mouton | 77.8% | 77.3% to 77.8% | 65.4% |
| Peak near Cabeus B | 69.3% | 69.2% to 69.3% | - |
| Haworth | 59.3% | 57.6% to 59.2% | 46.1% |
| Mons Mouton Plateau | 53.2% | 53.2% to 53.2% | - |
| Nobile Rim 1 | 84.1% | 83.2% to 84.0% | 68.9% |
| Nobile Rim 2 | 52.8% | 52.8% to 52.8% | - |

Every spot sits in a patch of similar sunlight, not on a single point. NASA's own maps, built
independently, give similar values: 54–88% on the 240 m map (section 2) and 46–74% on the
60 m map at ground level, which reads lower for the reasons in section 1. The 60 m map covers
only 85°S to the pole, so three spots have no value there.

## 5. Sites north of 75°S

These 16 sites lie outside the 75°S map. They now use SLDEM2015 (LOLA + Kaguya Terrain
Camera, about 237 m) between 60°S and 60°N, and LOLA's 60°S map for Chandrayaan-3. Before,
they had a smooth horizon (−0.09°) and ground heights from LDEM_16. Sunlight is 2 m up, long-term
average: "disc" is the visible fraction of the Sun's disc, "up" the share of time any part of
it is above the horizon. This table is a one-off run, not part of `validate.py`.
It records the earlier one-degree profiles; the published data uses quarter-degree
profiles.

| Site | Terrain | Horizon max ° | Mean ° | Min ° | Disc, smooth | Disc, terrain | Up, smooth | Up, terrain | Ground, new m | Ground, LDEM_16 m | Ground, LROC m |
| --- | --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| Chandrayaan-3 | LOLA 240 m (60S map) | 2.45 | 1.34 | 0.39 | 50.1% | 47.9% | 50.6% | 48.3% | 529.5 | 535.6 | 532 |
| Apollo 11 | SLDEM2015 237 m | 1.28 | 0.17 | -0.69 | 50.0% | 49.8% | 50.2% | 49.9% | -1926.6 | -1921.6 | -1926 |
| Apollo 12 | SLDEM2015 237 m | 0.48 | -0.05 | -0.58 | 50.1% | 50.0% | 50.2% | 50.2% | -1423.3 | -1426.8 | -1422 |
| Apollo 14 | SLDEM2015 237 m | 3.91 | 1.64 | 0.12 | 50.1% | 49.1% | 50.2% | 49.3% | -1062.0 | -1047.8 | -1062 |
| Apollo 15 | SLDEM2015 237 m | 13.49 | 4.95 | 0.40 | 50.1% | 47.4% | 50.2% | 47.6% | -1926.3 | -1938.0 | -1931 |
| Apollo 16 | SLDEM2015 237 m | 5.38 | 2.01 | -0.04 | 50.1% | 49.6% | 50.2% | 49.8% | 12.2 | 7.1 | 8 |
| Apollo 17 | SLDEM2015 237 m | 14.13 | 6.53 | 0.32 | 50.1% | 47.8% | 50.2% | 48.0% | -2628.0 | -2617.2 | -2626 |
| Luna 24 | SLDEM2015 237 m | 2.16 | 0.83 | -0.25 | 50.1% | 49.8% | 50.2% | 50.0% | -3673.5 | -3669.4 | -3670 |
| Chang'e 3 | SLDEM2015 237 m | 0.27 | -0.08 | -0.47 | 50.1% | 50.1% | 50.3% | 50.3% | -2630.1 | -2631.3 | -2630 |
| Chang'e 4 | SLDEM2015 237 m | 2.99 | 1.15 | -0.13 | 50.1% | 49.4% | 50.3% | 49.6% | -5926.7 | -5929.8 | - |
| Chang'e 5 | SLDEM2015 237 m | 2.01 | 0.08 | -0.33 | 50.1% | 50.0% | 50.3% | 50.2% | -2546.7 | -2544.2 | -2570 |
| Chang'e 6 | SLDEM2015 237 m | 3.34 | 0.60 | -0.11 | 50.1% | 49.9% | 50.3% | 50.1% | -5255.6 | -5255.4 | -5256 |
| SLIM | SLDEM2015 237 m | 9.60 | 5.40 | 0.49 | 50.1% | 47.7% | 50.2% | 47.9% | -913.8 | -910.4 | -912 |
| Blue Ghost Mission 1 | SLDEM2015 237 m | 2.26 | 0.42 | -0.07 | 50.1% | 49.9% | 50.2% | 50.1% | -3652.0 | -3645.6 | -3650 |
| Reiner Gamma | SLDEM2015 237 m | 0.78 | 0.26 | -0.03 | 50.1% | 49.8% | 50.2% | 50.0% | -1763.3 | -1764.0 | - |
| Mons Gruithuisen Gamma | SLDEM2015 237 m | 4.56 | 0.40 | -2.49 | 50.1% | 49.8% | 50.3% | 50.0% | -514.5 | -625.6 | - |

**Ground height against LROC.** At the 13 sites where LROC publishes a landing-site
elevation, the new heights differ from LROC's by 3.6 m on average (largest 23.3 m, Chang'e 5);
LDEM_16 differed by 6.0 m on average.

**What changed.** Equatorial and mid-latitude sites lose a few points of sunlight where hills
or crater walls rise around them; Apollo 15, Apollo 17 and SLIM lose
the most. Sunrise and sunset times shift with them.

**Orientation check.** At Apollo 15 the horizon is lowest to the west, where Hadley Rille drops
away from the lunar module, and peaks at Hadley Delta to the south (13.5° at 180°) and Mons
Hadley to the northeast (11.1° at 45°).

## Checks that passed

- **Map orientation.** Our latitude/longitude to map conversion matches GDAL's projection
  exactly and reproduces De Rosa et al. (2012) Table 2 (Malapert peak X −4.48 km, Y 121.8 km;
  Connecting Ridge X −10.92 km, Y −11.88 km) to 0.02 km. Around Connecting Ridge and Malapert,
  shifting a 7 × 7 patch of our values by 1 or 2 pixels in any direction against PGDA's makes
  the match worse.
- **5 m maps fit the 240 m map.** Averaged over each 240 m pixel they cover, the seven 5 m maps
  differ from the 240 m heights by −0.04 to +0.27 m on average (spread about 2 m), so both use
  the same reference sphere and line up.
- **Ray range.** Extending rays from 150 km to 300 km changes sunlight by at most 0.8 points.

The orientation, patch-shift and 5 m fit checks were one-off runs, not part of
`validate.py`.

## Known gaps

- **Derived spots are ours, not NASA's.** They are a reasonable spot within each published
  region by one criterion (sunlight, with a slope limit). They ignore Earth visibility, rocks
  and how far a crew would walk, and they rest on 5 m terrain whose heights can be off by
  metres where LOLA tracks are sparse (Barker et al. 2021 publish error maps we haven't used).
- **On 240 m terrain we differ from NASA's map by 4.0 points on average**, up to 31.7 at single
  pixels next to the sites. Likely causes are a newer LOLA grid behind NASA's 2016 map and
  method details; we have not pinned it down. The app's numbers rest on the 5 m comparison in
  section 1, not on this one.
- **Independent terrain truth for Earth remains untested.** Numerical Earth directions and
  skyline crossings are checked against CSPICE in [EARTH_VALIDATION.md](EARTH_VALIDATION.md)
  with the same terrain profile. A comparison
  against PGDA Earth-visibility maps remains separate work.
- **Terrain finer than 237 m near the lander is missing.** No site uses a smooth horizon now,
  but outside NASA's 5 m maps the 237 m and 240 m grids miss small hills and crater rims
  close to the site. LROC NAC terrain models would add them.
- **Long-term average only.** This checks the horizons, not specific dates; the daily forecast
  takes real Sun and Earth positions from JPL Horizons.

## Sources

- Gläser, P. et al. 2018. Illumination conditions at the lunar poles: Implications for future
  exploration. Planetary and Space Science 162, 170–178. doi:10.1016/j.pss.2017.07.006
  ([NASA NTRS copy](https://ntrs.nasa.gov/citations/20170007365))
- Mazarico, E. et al. 2011. Illumination conditions of the lunar polar regions using LOLA
  topography. Icarus 211, 1066–1081. doi:10.1016/j.icarus.2010.10.030
- Barker, M.K. et al. 2021. Improved LOLA elevation maps for south pole landing sites: Error
  estimates and their impact on illumination conditions. Planetary and Space Science,
  article 105119. doi:10.1016/j.pss.2020.105119 (the 5 m maps)
- Barker, M.K. et al. 2016. A new lunar digital elevation model from the Lunar Orbiter Laser
  Altimeter and SELENE Terrain Camera. Icarus 273, 346–355. doi:10.1016/j.icarus.2015.07.039
  (SLDEM2015)
- De Rosa, D. et al. 2012. Characterisation of potential landing sites for the European Space
  Agency's Lunar Lander project. Planetary and Space Science 74, 224–246.
  doi:10.1016/j.pss.2012.08.002 ([arXiv:1208.5587](https://arxiv.org/abs/1208.5587))
- NASA (L. Ortiz), Artemis Human Landing System Overview, talk for the 2025 Space Apps
  Challenge, slide 21: "Surface slope for landing (100m): <10 deg"
  ([NASA NTRS](https://ntrs.nasa.gov/api/citations/20250009323/downloads/ArtemisOverview2025IntSPAPPSChallenge.pdf))
- NASA PGDA: [Lunar Polar Illumination](https://pgda.gsfc.nasa.gov/products/69),
  [High-Resolution LOLA Topography for Lunar South Pole Sites](https://pgda.gsfc.nasa.gov/products/78)
