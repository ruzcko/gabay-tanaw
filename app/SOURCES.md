# Sources

Everything Tanaw uses that we did not make, with its licence.

## Browser quick estimate

| What | Use | Source and licence |
| --- | --- | --- |
| JPL DE440 planetary coefficients; DE440 lunar binary PCK; ME421-aligned fixed frame; naif0012 time constants | `assets/computation/quick/`: lossless yearly record subsets, prepared by Team Gabay / Tanaw. These are Tanaw data packs, not original NAIF kernels. Full source SHA-256 hashes are in the manifest. | [DE440](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440.bsp), [lunar orientation](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/moon_pa_de440_200625.bpc), [frame](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_de440_250416.tf), [time](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls). Public NASA/JPL data under [NAIF terms](https://naif.jpl.nasa.gov/naif/rules.html); credit NASA/JPL-Caltech and NAIF. No SPICE toolkit is bundled. |
| ERFA light deflection and aberration formulas (`eraLd`, `eraAb`, revision 2021-02-24) | Adapted to caller-owned arrays in `computation/src/quick/ephemeris.ts`; no new runtime package | [ERFA source](https://github.com/liberfa/erfa/tree/v2.0.1/src), BSD 3-clause terms, Copyright 2013–2021 NumFOCUS Foundation; derived with permission from SOFA, not SOFA itself. Notice: `computation/ERFA-LICENSE.txt`. |
| Shipped LOLA 16 px/degree and LDEM_875S_20M tiles | Scientific estimate skyline only, using the existing attributed products below; no smooth fallback | NASA SVS/GSFC/LOLA, public NASA data. Pinned manifests identify products and datum; frame provenance and resolution limits are in `computation/QUICK.md`. |

The local-basis and interval-sweep helpers are team-authored source, ported fresh into
Tanaw's computation module and aligned with its Python forecast semantics.

## Tanaw Computation Engine

| What | Where used | Source | Licence / terms |
| --- | --- | --- | --- |
| NASA/JPL Horizons ephemerides and raw observation/geometric fixtures | `computation/fixtures/`, server adapter | [Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html), [manual](https://ssd.jpl.nasa.gov/horizons/manual.html) | Publicly provided NASA/JPL scientific data; credit Solar System Dynamics Group, JPL. No third-party implementation code copied. [SSD fair-use terms](https://ssd-api.jpl.nasa.gov/) govern live access: serialized requests, caching, backoff and application/contact User-Agent. |
| TypeScript 5.9.3 (development type checker only) | `computation` development tooling | [Microsoft TypeScript](https://github.com/microsoft/TypeScript), [npm](https://www.npmjs.com/package/typescript/v/5.9.3) | Apache-2.0; no runtime dependency or compiler code bundled in the browser module |

## Data

| What | Where it's used | Source | Licence |
| --- | --- | --- | --- |
| CGI Moon Kit colour map, 2025 version (`lroc_color_16bit_srgb_4k.tif`), from the LRO camera's WAC mosaic | `assets/moon-color-4k.webp`, converted to WebP | [NASA Scientific Visualization Studio, item 4720](https://svs.gsfc.nasa.gov/4720) | NASA media, free to use with credit to NASA's Scientific Visualization Studio |
| CGI Moon Kit displacement map (`ldem_16_uint.tif`), LOLA elevation at 16 pixels per degree | `assets/moon-normal-4k.webp`, turned into surface normals with relief exaggerated 4× | [NASA Scientific Visualization Studio, item 4720](https://svs.gsfc.nasa.gov/4720) | NASA media, free to use with credit to NASA's Scientific Visualization Studio |
| LRO LOLA polar gridded elevation, 75°S to the pole at 240 m per pixel (`ldem_75s_240m.img` and `.lbl`) | `assets/moon-pole-normal-2k.webp`, turned into surface normals with relief exaggerated 3×; `data/horizons/`, the terrain skyline at each polar site; `data/sites.json`, ground elevation; `data/terrain/`, display terrain tiles around the polar sites; `data/grid/`, ground, slope and skyline at points around the polar sites; `data/layers/`, slope on the globe south of 75°S and around the polar sites | [NASA Planetary Data System, Geosciences Node](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/) | NASA PDS data, public domain; credit LRO LOLA (NASA GSFC) |
| The three Moon maps above, downscaled to 1024×512 and 512×512 so the globe shows before the full maps arrive | `assets/moon-color-1k.webp`, `assets/moon-normal-1k.webp`, `assets/moon-pole-normal-512.webp` | Same as the full-size maps above | Same as the full-size maps above |
| NASA PGDA high-resolution LOLA topography for south-pole sites, 5 m per pixel (`Site01`, `SL3`, `Site04`, `Site07`, `Site11`, `Site20`, `Site23` `_final_adj_5mpp_surf.tif`), Barker et al. 2021 | `data/horizons/`, the terrain within about 20 km of the polar sites; `data/sites.json`, ground elevation; `data/terrain/`, display terrain tiles around the polar sites; `data/grid/`, the same for points around the polar sites; `data/layers/`, slope around the polar sites | [NASA PGDA, product 78](https://pgda.gsfc.nasa.gov/products/78) | NASA data, public domain; cite Barker et al. 2021, Planetary and Space Science, doi:10.1016/j.pss.2020.105119 |
| SLDEM2015, LOLA and SELENE (Kaguya) Terrain Camera elevation, 60°S to 60°N at 128 pixels per degree (`sldem2015_128_60s_60n_000_360_float.img`), read as a ±5.5° window around each site; Barker et al. 2016 | `data/horizons/`, the terrain skyline at the 15 sites between 60°S and 60°N; `data/sites.json`, their ground elevation; `data/layers/`, slope around those sites (from their observer terrain tiles) | [NASA Planetary Data System, Geosciences Node](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/sldem2015/global/float_img/) | NASA PDS data, public domain; cite Barker et al. 2016, Icarus 273, 346–355, doi:10.1016/j.icarus.2015.07.039 |
| LRO LOLA polar gridded elevation, 60°S to the pole at 240 m per pixel (`ldem_60s_240m.img` and `.lbl`) | `data/horizons/` and `data/sites.json`, the terrain skyline and ground elevation at Chandrayaan-3; `data/layers/`, slope around Chandrayaan-3 (from its observer terrain tile) | [NASA Planetary Data System, Geosciences Node](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_60s_240m.img) | NASA PDS data, public domain; credit LRO LOLA (NASA GSFC) |
| LROC catalogue of human-made objects on the Moon (`ANTHROPOGENIC_OBJECTS_360`, updated 2026-08-14), Wagner et al. 2017 | Only to check the frame of the lander coordinates in `data/sites.json`; not shipped | [LROC PDS archive](https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/EXTRAS/SHAPEFILE/ANTHROPOGENIC_OBJECTS/) | LROC PDS data, public domain; credit NASA/GSFC/Arizona State University; cite Wagner et al. 2017, Icarus 283, 92–103 |
| NASA PGDA lunar polar illumination maps, 240 m and 60 m (`AVGVISIB_65S_240M_201608`, `AVGVISIB_65N_240M_201608`, `AVGVISIB_85S_060M_201608`), Mazarico et al. 2011 | `data/layers/`, the sunlight and permanent shadow textures on the globe from 65° to each pole, and around the polar sites and Chandrayaan-3; also to check our horizons (`science/VALIDATION.md`) | [NASA PGDA, product 69](https://pgda.gsfc.nasa.gov/products/69) | NASA data, public domain; cite Mazarico et al. 2011, Icarus 211, 1066–1081 |
| JPL Horizons ephemeris (DE441): Sun and Earth azimuth and elevation from each site, every 10 minutes | `data/forecast/`, `data/sun/`, `data/sun.json`, `data/grid/`; the raw responses are cached locally in `science/cache/` and not shipped | [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html), Solar System Dynamics Group, NASA JPL | Publicly released NASA/JPL data, free to use; credit NASA/JPL-Caltech Solar System Dynamics Group, Horizons |
| JPL Horizons ephemeris (DE441): Earth's position from the Sun and the Moon's from Earth, geometric vectors in the ecliptic of J2000, every hour | `data/orbit.json`, `data/orbit/`; the raw responses are cached locally in `science/cache/` and not shipped | [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html), Solar System Dynamics Group, NASA JPL | Publicly released NASA/JPL data, free to use; credit NASA/JPL-Caltech Solar System Dynamics Group, Horizons |
| LROC NAC controlled region mosaics, browse images (`NAC_ROI_CABEUSPKLO1_P836S2912`, `NAC_ROI_HAWORTH_LO1_P867S3363`, `NAC_ROI_MALAPERTLO1_P860S0003`, `NAC_ROI_MOUTNPLTLO1_P843S0306`, `NAC_ROI_MTMOUTONLO1_P854S0353`, `NAC_ROI_NOBILE02LO1_P839S0587`, `NAC_ROI_DEGERRIMLO1_P885S2933`) | `assets/sites/`, one photo per base-candidate site (`assets/sites/<id>.webp`; the Mons Mouton mosaic also serves `leibnitz-beta-plateau` and `nobile-rim-1`), converted to WebP | [LROC PDS archive, NAC_ROI browse images](https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/EXTRAS/BROWSE/NAC_ROI/) | LROC PDS data, public domain; credit NASA/GSFC/Arizona State University |
| LROC featured image “Apollo 11: Second look” (`2xenlarge.png`) | `assets/sites/apollo-11.webp`, converted to grayscale WebP | [LROC, Apollo 11: Second look](https://lroc.im-ldi.com/images/22) | NASA-funded LROC image, free to use with credit; credit NASA/GSFC/Arizona State University |
| LROC featured image “Pinpoint Landing on the Ocean of Storms” (`M175428601RE_25cm_AP12_area.png`) | `assets/sites/apollo-12.webp`, converted to grayscale WebP | [LROC, Pinpoint Landing on the Ocean of Storms](https://lroc.im-ldi.com/images/401) | NASA-funded LROC image, free to use with credit; credit NASA/GSFC/Arizona State University |
| LROC featured image “New View of Apollo 14” (`M150633128LR_close.png`) | `assets/sites/apollo-14.webp`, converted to grayscale WebP | [LROC, New View of Apollo 14](https://lroc.im-ldi.com/images/285) | NASA-funded LROC image, free to use with credit; credit NASA/GSFC/Arizona State University |
| LROC featured image “Follow the Tracks” (`a15_tracks.png`) | `assets/sites/apollo-15.webp`, converted to grayscale WebP | [LROC, Follow the Tracks](https://lroc.im-ldi.com/images/491) | NASA-funded LROC image, free to use with credit; credit NASA/GSFC/Arizona State University |
| LROC featured image “Apollo 16, Footsteps Under High Sun” (`M116215423ME.bwmos.png`) | `assets/sites/apollo-16.webp`, converted to grayscale WebP | [LROC, Apollo 16, Footsteps Under High Sun](https://lroc.im-ldi.com/images/199) | NASA-funded LROC image, free to use with credit; credit NASA/GSFC/Arizona State University |
| LROC featured image “Exploring the Apollo 17 Site” (`ap17_1st50km_4release.png`) | `assets/sites/apollo-17.webp`, converted to grayscale WebP | [LROC, Exploring the Apollo 17 Site](https://lroc.im-ldi.com/images/72) | NASA-funded LROC image, free to use with credit; credit NASA/GSFC/Arizona State University |
| LROC featured image “Mare Crisium: Failure then Success” (`luna23_24_regional.png`) | `assets/sites/luna-24.webp`, converted to grayscale WebP | [LROC, Mare Crisium: Failure then Success](https://lroc.im-ldi.com/images/461) | NASA-funded LROC image, free to use with credit; credit NASA/GSFC/Arizona State University |
| LROC featured image “Chang'e 3 Lander and Rover From Above” (`chang_e3_FI_opening.png`) | `assets/sites/change-3.webp`, converted to grayscale WebP | [LROC, Chang'e 3 Lander and Rover From Above](https://lroc.im-ldi.com/images/637) | NASA-funded LROC image, free to use with credit; credit NASA/GSFC/Arizona State University |
| LROC featured image “Topographic Map of the Chang'e 4 Site” (`content_NAC_DTM_Change4_eq_disc_CLRSHADE_1100p_Crop.png`) | `assets/sites/change-4.webp`, converted to grayscale WebP | [LROC, Topographic Map of the Chang'e 4 Site](https://lroc.im-ldi.com/images/1100) | NASA-funded LROC image, free to use with credit; credit NASA/GSFC/Arizona State University |
| LROC featured image “First Look: Chang'e 5” (`content_CE5_1100p_Image_version2.png`) | `assets/sites/change-5.webp`, converted to grayscale WebP | [LROC, First Look: Chang'e 5](https://lroc.im-ldi.com/images/1172) | NASA-funded LROC image, free to use with credit; credit NASA/GSFC/Arizona State University |
| LROC featured image “First Look: Chang'e 6” (`content_CE6_FI_Header_425mmpp.png`) | `assets/sites/change-6.webp`, converted to grayscale WebP | [LROC, First Look: Chang'e 6](https://lroc.im-ldi.com/images/1374) | NASA-funded LROC image, free to use with credit; credit NASA/GSFC/Arizona State University |
| LROC featured image “Chandrayaan-3 Landing Site” (`content_M1447750764_LRmos.warp.1100px1100p.clean.png`) | `assets/sites/chandrayaan-3.webp`, converted to grayscale WebP | [LROC, Chandrayaan-3 Landing Site](https://lroc.im-ldi.com/images/1314) | NASA-funded LROC image, free to use with credit; credit NASA/GSFC/Arizona State University |
| LROC featured image “JAXA SLIM Landing” (`content_ALIGN_aligned_M1460739214L.1100x1100.png`) | `assets/sites/slim.webp`, converted to grayscale WebP | [LROC, JAXA SLIM Landing](https://lroc.im-ldi.com/images/1358) | NASA-funded LROC image, free to use with credit; credit NASA/GSFC/Arizona State University |
| LROC featured image “Intuitive Machines IM-1 On The Moon!” (`content_Nova_C_no_arrow_1100x1100_crop.png`) | `assets/sites/im1-malapert-a.webp`, converted to grayscale WebP | [LROC, Intuitive Machines IM-1 On The Moon!](https://lroc.im-ldi.com/images/1360) | NASA-funded LROC image, free to use with credit; credit NASA/GSFC/Arizona State University |
| LROC featured image “IM-2 Athena Seen Obliquely” (`content_M1495922531_LRmos.warp.str01_str02.3xdecimated.1300p.png`) | `assets/sites/im2-mons-mouton.webp`, converted to grayscale WebP | [LROC, IM-2 Athena Seen Obliquely](https://lroc.im-ldi.com/images/1408) | NASA-funded LROC image, free to use with credit; credit NASA/GSFC/Arizona State University |
| LROC featured image “Blue Ghost Lunar Lander Seen From Above” (`content_M1495619099LR_mos.str01.320cm.1300p.png`) | `assets/sites/blue-ghost-1.webp`, converted to grayscale WebP | [LROC, Blue Ghost Lunar Lander Seen From Above](https://lroc.im-ldi.com/images/1407) | NASA-funded LROC image, free to use with credit; credit NASA/GSFC/Arizona State University |
| LROC featured image “Reiner Gamma: Swirling in Mystery” (`content_ReinerGamma.jpg`) | `assets/sites/im3-reiner-gamma.webp`, converted to grayscale WebP | [LROC, Reiner Gamma: Swirling in Mystery](https://lroc.im-ldi.com/images/1195) | NASA-funded LROC image, free to use with credit; credit NASA/GSFC/Arizona State University |
| LROC featured image “Gruithuisen Domes: A Lunar Mystery” (`content_NAC_ROI_GRUITHSNLOB_E362N3197_20M_Recrop.png`) | `assets/sites/blue-ghost-3.webp`, converted to grayscale WebP | [LROC, Gruithuisen Domes: A Lunar Mystery](https://lroc.im-ldi.com/images/1133) | NASA-funded LROC image, free to use with credit; credit NASA/GSFC/Arizona State University |
| LROC featured image “Traversing the Shackleton de Gerlache Ridge” (`content_M1348682369_LRmos.warp.str01.shrunk6x.1100x1100.png`) | `assets/sites/connecting-ridge.webp`, `assets/sites/connecting-ridge-extension.webp`, `assets/sites/shackleton-rim.webp`, converted to grayscale WebP | [LROC, Traversing the Shackleton de Gerlache Ridge](https://lroc.im-ldi.com/images/1247) | NASA-funded LROC image, free to use with credit; credit NASA/GSFC/Arizona State University |
| LROC featured image “Lunar South Pole - Out of the Shadows” (`shack_spole_v2.png`) | `assets/sites/peak-near-shackleton.webp`, converted to grayscale WebP | [LROC, Lunar South Pole - Out of the Shadows](https://lroc.im-ldi.com/images/98) | NASA-funded LROC image, free to use with credit; credit NASA/GSFC/Arizona State University |
| Landing times: touchdown time in UTC of each visited site | `data/landings.json` | NASA NSSDCA spacecraft pages (some via the Internet Archive, as the live pages return errors), NASA's Beyond Earth (SP-2018-4041), a NASA news release, LROC and JAXA, each listed per site in that file | Facts (times) cited from public pages; no text or images copied |

### Landing site coordinates (`data/sites.json`)

Coordinates are published facts or derived by us from NASA data, cited per site in `sites.json`.

| Sites | Source |
| --- | --- |
| Connecting Ridge, Connecting Ridge Extension, Shackleton rim | Gläser et al. 2018, Planetary and Space Science 162, 170–178, Table 2, best points 2 m above ground ([NASA NTRS](https://ntrs.nasa.gov/citations/20170007365)) |
| Peak near Shackleton, de Gerlache rim, Malapert massif, Mons Mouton (formerly Leibnitz Beta plateau) | Derived by us (`"derived": true`): the sunniest spot 2 m up within 2 km of each region centre, slope under 10° over 100 m, on NASA PGDA 5 m terrain (`science/best_spot.py`). Region centres (`regionCentre`): De Rosa et al. 2012, Planetary and Space Science 74, 224–246, Table 2 ([arXiv:1208.5587](https://arxiv.org/abs/1208.5587)). Slope limit: NASA, Artemis Human Landing System Overview, 2025 Space Apps Challenge talk, slide 21 ([NASA NTRS](https://ntrs.nasa.gov/citations/20250009323)) |
| IM-2 Athena, Mons Mouton | [LROC, "IM-2 Athena Seen Obliquely", 10 March 2025](https://lroc.im-ldi.com/images/1408) |
| IM-1 Odysseus, near Malapert A | [LROC, "Intuitive Machines IM-1 On The Moon!", 26 February 2024](https://lroc.im-ldi.com/images/1360) |
| Chandrayaan-3 | [LROC, "Chandrayaan-3 Landing Site", 5 September 2023](https://lroc.im-ldi.com/images/1314) |
| Apollo 11, Apollo 12, Apollo 14, Apollo 15, Apollo 16, Apollo 17, Luna 24, Chang'e 3 | [LROC, Coordinates of Lunar Anthropogenic Targets, 28 July 2016](https://lroc.im-ldi.com/data/support/downloads/2016_LROC_Coordinates_of_Human_Features.pdf), lunar module or lander rows; Wagner et al. 2017, Icarus 283, 92–103 |
| Chang'e 4 | [LROC, "Topographic Map of the Chang'e 4 Site", 30 April 2019](https://lroc.im-ldi.com/images/1100) |
| Chang'e 5 | [LROC, "First Look: Chang'e 5", 4 December 2020](https://lroc.im-ldi.com/images/1172) |
| Chang'e 6 | [LROC, "First Look: Chang'e 6", 14 June 2024](https://lroc.im-ldi.com/images/1374) |
| SLIM | [LROC, "JAXA SLIM Landing", 26 January 2024](https://lroc.im-ldi.com/images/1358) |
| Blue Ghost Mission 1 | [LROC, "Blue Ghost Lunar Lander Seen From Above", 7 March 2025](https://lroc.im-ldi.com/images/1407) |
| Peak near Cabeus B, Haworth, Mons Mouton Plateau, Nobile Rim 2 | Derived by us (`"derived": true`) with `science/best_spot.py` as above, but searched within 7.5 km of each region centre and inside the mosaic's published latitude/longitude extent, on LOLA LDEM_75S_240M terrain. Region centres and extents (`regionCentre`): centres of LROC's controlled NAC mosaics of each region, rounded to 0.1°, and their minimum/maximum latitude and longitude (LROC PDS RDR READMEs: [Peak near Cabeus B](https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/BDR/NAC_ROI/CABEUSPKLO1/NAC_ROI_CABEUSPKLO1_P836S2912_README.TXT), [Haworth](https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/BDR/NAC_ROI/HAWORTH_LO1/NAC_ROI_HAWORTH_LO1_P867S3363_README.TXT), [Mons Mouton Plateau](https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/BDR/NAC_ROI/MOUTNPLTLO1/NAC_ROI_MOUTNPLTLO1_P843S0306_README.TXT), [Nobile Rim 2](https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/BDR/NAC_ROI/NOBILE02LO1/NAC_ROI_NOBILE02LO1_P839S0587_README.TXT)); for Peak near Cabeus B, Haworth and Nobile Rim 2 also Henriksen et al. 2023, Optimized Illuminated Terrain Coverage of the Candidate Artemis III Landing Sites with LROC NAC Controlled Mosaics, European Lunar Symposium |
| Nobile Rim 1 | Derived by us (`"derived": true`) with `science/best_spot.py` as above, but searched within 7.5 km of the region centre and inside the latitude/longitude box around map Site06's footprint, on LOLA LDEM_75S_240M terrain. Region centre (`regionCentre`): centre of map Site06 ("Nobile rim 1") in [NASA PGDA product 78](https://pgda.gsfc.nasa.gov/products/78), High-Resolution LOLA Topography for Lunar South Pole Sites (Barker et al.) |
| Reiner Gamma (IM-3) | Blewett et al., Lunar Vertex CP-11 landing site, LPSC 2023 abstract #1780 ([NASA NTRS 20230000531](https://ntrs.nasa.gov/api/citations/20230000531/downloads/Blewett_LVx-CP11_landingsite_LPSC2023_abstr1780.pdf)) |
| Mons Gruithuisen Gamma (Blue Ghost Mission 3) | Williams, Landis, Bennett et al. 2026, "Lunar-VISE landing site selection and characterization at Mons Gruithuisen Gamma", Planetary Science Journal, doi:10.3847/PSJ/ae7d2c ([USGS](https://www.usgs.gov/publications/lunar-vise-landing-site-selection-and-characterization-mons-gruithuisen-gamma)) |

Frames: every coordinate is labelled `MOON_ME_DE421`; each site's `frameEvidence` gives the basis. The eight landers from LROC posts match LROC's object catalogue above to within 75 m, and LROC gives coordinates in the mean Earth/polar axis system with DE421 ([LROC 2016 table](https://lroc.im-ldi.com/data/support/downloads/2016_LROC_Coordinates_of_Human_Features.pdf)). Planned landing targets carry `positionAccuracy: "approximate"`.

Artemis region names: [NASA, 28 October 2024](https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/). NASA's [Artemis IV page](https://www.nasa.gov/mission/artemis-iv/) refers to the same nine regions.

## Code

| What | Where it's used | Source | Licence |
| --- | --- | --- | --- |
| three.js 0.187.0 (`three.module.js`, `three.core.js`, `TrackballControls.js`) | `vendor/three/` | [threejs.org](https://threejs.org), [npm](https://www.npmjs.com/package/three) | MIT, see `vendor/three/LICENSE` |

## Fonts

| What | Where it's used | Source | Licence |
| --- | --- | --- | --- |
| Atkinson Hyperlegible Next, by the Braille Institute | All text | [Google Fonts](https://fonts.google.com/specimen/Atkinson+Hyperlegible+Next) | SIL Open Font License 1.1 |
| Atkinson Hyperlegible Mono, by the Braille Institute | Countdowns and other numbers | [Google Fonts](https://fonts.google.com/specimen/Atkinson+Hyperlegible+Mono) | SIL Open Font License 1.1 |
| Michroma, by Vernon Adams | The "TANAW" wordmark in the top bar (loaded for those letters only) | [Google Fonts](https://fonts.google.com/specimen/Michroma) | SIL Open Font License 1.1 |

## Icons

| What | Where it's used | Source | Licence |
| --- | --- | --- | --- |
| Tabler Icons: chevron-left, chevron-right, chevron-down, check, arrow-up, player-play, player-pause, info-circle, search, telescope, planet, eye, zoom-out, angle, sun and shadow (outline), inline SVG | Previous and next site buttons in `index.html`; Sun and Earth edge markers in `globe.js`; the Play / Pause button, the range button and its menu, the top bar's icon buttons and the site view's map layer buttons in `index.html`; directional arrows in `observer/index.js` | [tabler.io/icons](https://tabler.io/icons) | MIT |

## Observer module assets

Stage 2 observer assets (locally cached; replaceable through provider APIs):

The observer's dim Milky Way texture derives from the celestial-coordinate layer of
[NASA SVS Deep Star Maps 2020](https://svs.gsfc.nasa.gov/4851/),
[original 4K OpenEXR](https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_4k.exr).
Credit: NASA/Goddard Space Flight Center Scientific Visualization Studio, Ernie Wright;
Gaia DR2: ESA/Gaia/DPAC. Used under [NASA media usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/).
The celestial map is centered at RA 0, increasing left, with north at the top.
It omits the bright Hipparcos/Tycho foreground; existing catalog stars supply that layer.
Display exposure is illustrative; this is not precision astrometry or a camera exposure model.
`scripts/build-milkyway.py` converts the original linear HDR image to sRGB WebP with
a fixed global tone curve. Offline conversion uses [OpenEXR](https://openexr.com/) (BSD-3-Clause),
[NumPy](https://numpy.org/) (BSD-3-Clause), and [Pillow](https://python-pillow.github.io/) (MIT-CMU);
none is a browser dependency.

| What | Source | Licence / credit |
| --- | --- | --- |
| LOLA 16 pixels/degree unsigned height map, converted to compact local tiles; the tiles also give the slope on the whole globe in `data/layers/` | [NASA CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/) | NASA media, free to use with credit to NASA SVS and LRO LOLA; heights decoded as half-metres minus 10,000 m relative to 1,737,400 m |
| Blue Marble 2048×1024 Earth color mosaic | [NASA SVS 2915](https://svs.gsfc.nasa.gov/2915/) | NASA media, free to use with credit to NASA/Goddard Space Flight Center Scientific Visualization Studio; NASA Earth Observatory; includes baked topographic shading |
| Compact bright-star subset of Hipparcos | [NASA Open Data metadata](https://data.nasa.gov/dataset/hipparcos-main-catalog), [HEASARC](https://heasarc.gsfc.nasa.gov/W3Browse/star-catalog/hipparcos.html) | NASA metadata links government-works/public-domain terms; credit ESA Hipparcos, Perryman et al. (1997), CDS I/239 and NASA HEASARC. ICRS positions at epoch J1991.25; display catalog, not precision astrometry |

The Stage 1 observer reuses this vendored Three.js. Its synthetic fixtures and neutral
body discs add no external datasets, imagery or fonts.

The observer/overview material pass reuses `moon-normal-4k.webp` and
`moon-pole-normal-2k.webp` from the attributed LOLA products above. Their baked 4×/3×
normal slopes are reduced in shading; they do not displace geometry. Ground grain is
project-authored procedural display detail, not a measured dataset. Earth rim/glint
are display approximations using the already-attributed Blue Marble texture.

Earth display orientation uses NASA NAIF's [generic PCK 00011](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc),
NASA/JPL public data with attribution; SHA-256 `3dff7b1dbeceaa01f25467767d3fa25816051c85d162d1edf04acb310ee28bb1`.
IAU_EARTH is a low-accuracy visualization model, not a precision Earth-orientation result;
see [NAIF Earth/Moon guidance](https://naif.jpl.nasa.gov/pub/naif/self_training/individual_docs/A6_lunar-earth_pck-fk.pdf).
Sun limb shading and procedural granulation are project-authored display effects, informed
by [NASA Sun facts](https://science.nasa.gov/sun/facts/); they do not represent dated sunspots or solar activity.

## High-resolution observer terrain

- The already-attributed **LDEM_60S_240M** source also supplies lossless tiles in
  `assets/observer/terrain/polar240/` and the Chandrayaan-3 display mesh. NASA PDS
  public-domain data; credit NASA/GSFC/LOLA. The source and per-tile SHA-256 and sizes
  are recorded in its manifest. Coverage is south of 60°S; display samples blend
  to coarse relief between 60.1°S and 60.3°S at the coverage edge. No new ephemeris
  or horizon calculation is introduced.
- The Moon page's site view (`far-ground.js`) draws its far ground from the same shipped
  tiles: `polar240/` within about 60 km of the site and the 4 pixels-per-degree CGI Moon Kit
  LOLA tiles (`assets/observer/terrain/4/`) out to 500 km. Display only, with heights
  exaggerated 1.5× like the site's own terrain.
- The already-attributed **SLDEM2015** 128-pixels/degree windows supply the other
  15 meshes in `assets/observer/terrain/catalog/`. NASA PDS public-domain data;
  credit LOLA/SELENE and Barker et al. 2016. The index records pinned source and
  mesh hashes. Mesh spacing is finer than the ~237 m source sampling and does not
  imply added measurement detail. Display alignment preserves forecast ground height.

- NASA/GSFC LOLA **LDEM_875S_20M V2.0**, [PDS label](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_875s_20m.lbl).
  NASA public-domain data; credit NASA/GSFC/LOLA. 20 m polar-stereographic grid,
  south of 87.5 degrees S, DE421 mean-Earth/polar-axis frame, height above the
  1,737,400 m sphere. Signed little-endian int16, 0.5 m per DN. Grid spacing is
  not measurement accuracy: laser tracks were interpolated by the source team.
  Local lossless 512-square gzip tiles are prepared by `tools/prepare_polar_terrain.py`;
  the manifest records the source SHA-256. No additional imagery licence or runtime service.
  Horizon transport copies in `assets/observer/terrain/polar20-delta-v1/` use
  reversible row differences and byte planes, prepared by `tools/pack_horizon_terrain.py`.
  The preparation verifies the reconstructed NASA source hash; decoded tile checksums
  preserve every original height value. Same source and licence as the tiles above.
  `polar20-bounds-v1.bin`, generated by the same tool, stores exact 64×64-block
  maxima from those verified samples. These conservative bounds skip downloads
  only when the terrain cannot raise the calculated horizon; source resolution stays 20 m.

- US Naval Observatory, [TAI-UTC history](https://maia.usno.navy.mil/ser7/tai-utc.dat):
  published 1961–1971 UTC offset/rate segments used for browser TT/TDB conversion.
  US government factual time-standard data, public domain. TT = TAI + 32.184 s.
- NASA NSSDC [Apollo 11](https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo11info.html)
  and [Apollo 12](https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo12info.html):
  landing UTC instants used in regression checks (20:17:40 and 06:54:35 respectively).
  NASA/US government mission facts, public domain.

## Landing screening references

- NASA [candidate-region announcement (2022)](https://www.nasa.gov/news-release/nasa-identifies-candidate-regions-for-landing-next-americans-on-moon/) and [Artemis overview (2025)](https://ntrs.nasa.gov/api/citations/20250009323/downloads/ArtemisOverview2025IntSPAPPSChallenge.pdf): historical continuous-sunlight duration and regional 100 m slope screening basis. NASA public information with attribution; no images or logos copied. Seven days and continuous Earth-centre visibility are adjustable application presets. Terrain screens reuse the NASA LOLA products already credited in this file.

## Isolated NASA terrain comparison (not shipped)

- NASA/GSFC [South Pole LOLA DEM Mosaic](https://pgda.gsfc.nasa.gov/products/81),
  `ldem_87s_5mpp.tif`, 5 m grid, 87–90 S, MOON_ME/DE421.
  NASA public data with attribution; credit Barker et al. (2021),
  https://doi.org/10.1016/j.pss.2020.105119. Pixel spacing is not an accuracy bound.
- NASA/GSFC [Adjusted regional LOLA terrain](https://pgda.gsfc.nasa.gov/products/90),
  `LDEM_80S_20MPP_ADJ.TIF`, 20 m grid, MOON_ME/DE421; associated
  `LDEM_80S_20MPP_ADJ_ERR.TIF` and `LDEM_80S_20MPP_ADJ_EFFRES.TIF` quality maps.
  NASA public data with attribution; credit Barker et al. (2023),
  https://doi.org/10.3847/PSJ/acf3e1. Source hashes and acquisition timings are
  recorded in the isolated experiment results; raw maps remain untracked.
