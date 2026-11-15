# Tanaw design system

The rules for how Tanaw looks and sounds. Read this before you change `style.css`,
`index.html` or `forecast.js`, and update it when a rule changes.

The values below come from `style.css` as of 2026-11-14. Rows marked **Proposed** are not in
the code yet.

**Contrast rule:** text needs at least **4.5:1** against its background (3:1 for text 24 px
and up, or 19 px bold and up). Icons and the Go / No-go day marks need **3:1**. Text sits
on black space, so check it against black. Pin labels sit on the Moon, so check them
against their `--glass-solid` backing.

## 1. The idea

**Checking the forecast for a place you're going, and the place happens to be the Moon.**
Travel there is ordinary, so the screen feels like an everyday forecast app, not a
spacecraft console. The Moon sits in black space, and the forecast is written straight
onto the space around it. It should not feel like sci-fi: no targeting marks, no glowing
edges, no terminal fonts.

Travel extends this shell with a right sidebar and a side-opening filter sheet; on phones
it becomes a bottom sheet. The forecast fits beside it without changing its normal layout.
Travel-only destination markers are diamonds with a restrained glow, explicitly requested
for this mode. Opening/closing surfaces use short, interruptible fades and slides; reduced
motion removes them. Results show matching destinations only, with arrival-lit renders of
the existing Moon model and science details behind an accessible information tooltip.
Filters follow booking-site conventions: stay length, known sites first, sunlight hours,
Earth visibility hours, then terrain. Changes debounce before recalculation; pending work
has a loading indicator and stale results are removed.

**Moon first, answer first, details on demand.** The answer comes first: Go or No-go, and
if No-go, when to go instead or where. The Moon is always fully visible. Everything else
opens when you ask for it.

On first load, the loading cover stays until the textured Moon's first rendered frame, which
is drawn only once the free band is known, so it is already framed (never the whole window).
The Moon glides in from 1.3 times further out to its framed pose (1 s, eased in and out) as it
fades in first, followed by the heading, sky details and forecast; date and range
controls arrive last. The sequence finishes within 560 ms, preserves layout space, and
never replays for date or forecast updates. Reduced motion shows the scene immediately.

- **The Moon is the page.** No page background, no panels and no boxes around the globe.
  The camera frames the Moon in the free space between the top bar and the bottom bar, left
  of the site panel when it is open and right of the sky clock's column while it holds the
  Times content, so no text ever sits on it.
- **Text sits directly on black space.** No boxes, fills or shading behind the sky clock,
  the planning bar or any other text. This works because the Moon is framed clear of the
  text, so black is always behind it. The site view's ground and sky are masked to the
  free band, so text beside them still sits on black.
- **Overlays hide the Moon.** A full overlay (the site picker or the enlarged sky clock) hides the globe and its pins while it is open, so its text sits on
  pure black. Compare keeps the Moon visible above its lower tray.
- **Controls are outlines.** Buttons and chips are drawn with a thin outline, never a
  fill, except selected calendar cells and the observer's range buttons: these use a light
  `--sel` fill with dark `--space` text. Other pressed or expanded controls get a brighter outline.
  The day control's own buttons (Play, the date, the range) are ghosts: no outline at rest,
  a `--line` outline on hover.
- Moon and observer action buttons retain their existing geometry. On hover or keyboard
  focus, a wide ellipse rises over 494 ms, filling the button and inverting its contents.
  Dropdown options sweep in from the left; other buttons keep the rising ellipse.
  Toggle dots are opt-in (`data-toggle-dot`), only for actual display switches: horizon,
  5 km ring, spots, lat/lon grid and map layers. Icons, information buttons, disclosures,
  pickers, navigation and mode selections have no dot. The Sun/Earth/Moon selector also
  retains its original colours without the inversion sweep. Eligible controls show a
  small centred `--sun` dot below the label when on; it gently pulses while hovered or
  keyboard-focused. Reduced motion removes
  the sweep and pulse. Calendar cells, scroll wheels and scene markers retain their own
  selection styles; native selects and sliders retain their existing controls.
- **Colour is rationed to the Sun and Earth.** Gold means the Sun (and a Go day or control toggle), blue means
  Earth. Nothing else is coloured.
- **A year ahead.** The forecast covers a full year, Tue 1 Dec 2026 to Tue 30 Nov 2027, so
  the planned date can be any day in it. A range selector picks how much of the year the
  slider and Compare show at once.
- **The screen carries the Tanaw name,** top left at every width; the globe itself shows
  which body it is.
- **Deliberate exceptions:** dark only. Space is black, and the light theme existed only
  for the glass panels, which are gone. The screen has one theme.

- The scene leads; controls remain compact. Clearly distinguish fixtures, display effects
  and scientific results.

## 2. Colour

Design tokens are the CSS variables in `:root`. Always use a token, never a raw hex, so a
change in one place reaches the whole screen. The screen is dark only (see section 1).

### Base

| Token | Value | Use for |
|---|---|---|
| `--space` | `#000000` | Behind the globe |
| `--glass-solid` | `#0d121c` | Backing of the pin labels and pin lists (small labels and menus drawn on the Moon need one); the Earth label, the edge markers and the halo of the overhead rings; placeholder hero tiles in the site picker; the About sheet |
| `--line` | `rgba(255,255,255,.5)` | 1 px outline of every button and chip; the non-Go part of the slider track. About 5:1 on black |
| `--edge` | `rgba(255,255,255,.16)` | Decorative hairlines only (not controls) |
| `--scrim` | `rgba(0,0,0,.6)` | Dims the page behind the About sheet |
| `--text` | `#f2f4f8` | Main text; outline of a pressed, expanded or selected control |
| `--muted` | `#b8c1d0` | Secondary text and labels; the skyline in the sky clock |
| `--terrain` | `rgba(255,255,255,.18)` | Ground band in the sky clock, between the skyline and the outer ring |
| `--regolith` | `#9a9a96` | Surface colour of the terrain disc in the site view (a material colour, lit by the scene; never text) |

### Meaning colours

| Token | Value | Means |
|---|---|---|
| `--sun` | `#ffc861` | The Sun: sunset countdown, sunlight hours, the Sun's path; the Sun disc on the globe, the "Sun" edge marker's text, the Sun's overhead ring |
| `--earth` | `#8cc4ff` | Earth: Earthset countdown, Earth hours, Earth's path; the "Earth" edge marker's text, Earth's overhead ring |
| `--go` | `#ffc861` | The Go dot on the selected day, the day slider |
| `--go-text` | `#1a1204` | Text on a `--go` fill |
| `--nogo-edge` | `rgba(255,255,255,.45)` | The 1 px track line of an empty lane and the hollow No-go dot, so they stay visible |
| `--sel` | `#f2f4f8` | Selected-day outline in charts; selected calendar and observer range fill; the pressed row of a menu |
| `--layer-0` … `--layer-3` | `#7fd6a4` `#d9e87a` `#f59b5c` `#e8566c` | Slope layer bands: under 5°, 5–10°, 10–20°, 20° and over (green to red, flat to steep; each at least 7:1 on black, 5:1 for `--layer-3`) |
| `--layer-shadow` | `#8c9bff` | Permanent shadow layer |
| `--pin` | `#ff3b30` | Head of the pin in the 3D site view, ringed in `--sel` so it stands out from the ground and from Slope's `--layer-3` band (about 5.9:1 on black) |

In the lanes the Sun lane is gold and the Earth lane is blue; the Go mark under a
day is `--text`, a neutral bar, because it means "both", not either body. Empty days are a
thin track line, so the lanes read by filled and empty as well as by colour, and the
lanes are told apart by position (Sun on top) as well as by hue.

On the globe, `--sun` and `--earth` also mark the bodies themselves: the Sun disc, the
edge markers' text and the overhead rings. Both stay at least 3:1 on black (about 13:1
and 10:1) and on `--glass-solid`, so they read as text and as marks.

- Use Sun gold and Earth blue only for their established meanings.

## 3. Type

**Fonts (chosen 2026-11-14):** **Atkinson Hyperlegible Next** for words and **Atkinson
Hyperlegible Mono** for numbers. Both were designed for easy reading, which matters on a
phone outdoors. Licence: OFL (Google Fonts). Loaded from Google Fonts for now; **Proposed:**
self-host the woff2 files in `fonts/`.

| Token | Use for |
|---|---|
| `--font` | Everything by default |
| `--mono` | Countdowns and hour counts |

Countdowns use `font-variant-numeric: tabular-nums` (and the mono font), so the digits don't
jump as they tick.

**Logo (working, not final):** the full Tanaw logo is TANAW in **Michroma** with Earth and
the Sun as `--earth` and `--sun` discs in the two A's, under a thin `--text` arc (the Sun's
path) that fades out at both ends. It is used wherever the app shows the brand: the top bar
at every width and the loading screen. The SVG is inline, with every colour a token
(gradient stops through `style="stop-color: var(--text)"`) and its own gradient id per copy.
Michroma is loaded for the five letters only, with `display=block`: while the font arrives,
T, N and W stay invisible for up to about 3 s rather than showing in a fallback font beside
the drawn A's; on a connection slower than that, the fallback letters show until it lands. The small icon (a tapered arc with the
Sun near its top and Earth under it, on a rounded `--glass-solid` tile) is used only as the
favicon, `assets/brand/tanaw-favicon.svg`, a standalone file with its own colours and a
slightly thicker arc for 16–32 px. The page title is "Tanaw".
- Top bar: the page heading (h1, read as "Tanaw") is the logo (`role="img"`), 40 px tall
  (204 px wide) on screens wider than 760 px. On phones it is at most 26 px tall (132 px
  wide) and shrinks to the room the top bar's buttons leave, 8 px clear of the first one,
  so the bar stays one row down to 320 px: its full 26 px from 375 px, and about 17 px
  (86 px wide) at 320 px, where four icon buttons share the row. Under 375 px the top bar's buttons sit 6 px apart. The brand is never the thing that hides. It is not a
  control and takes no taps.
- Loading screen: while "Loading the Moon" shows, the status element is a full-screen
  `--space` cover above everything else, with only the logo centred on it, 64 px tall
  (44 px on phones), and the line in `--muted` under it. The top bar and every control are
  hidden under it and take no taps, and everything behind it is `inert`, so Tab can't
  reach them either. It goes when the status empties once the Moon is in;
  if the Moon fails, the error text replaces the logo on the cover.

### Sizes

A **type scale** is a short, fixed list of sizes, so the screen looks planned.

| Role | Size | Weight |
|---|---|---|
| Logo ("TANAW", Michroma, drawn as one SVG) | 40 px tall (26 on phones, shrinking under 375 px; 64 on the loading screen, 44 on phones) | 400 |
| Go / No-go call | 18 | 600 |
| Countdowns | 18 (16 under 400 px) | 600, mono |
| Planned date | 14 | 600 |
| Month labels under the Compare heading | 12 | 400, `--muted` |
| Site picker: initials on a placeholder hero | 32 | 600 |
| Site picker: site name in the detail view | 22 | 600 |
| Site picker: site name on a card, the site switcher name | 16 | 600 |
| Body | 14 | 400 |
| Labels | 13 | 400 |
| About: heading | 22 | 600 |
| About: text, key and credits | 14 | 400 |

**Weights:** sans 400 and 600, mono 500 and 600.

## 4. Shape and space

| | Value |
|---|---|
| Corner radius | 14 buttons · 0 the ends of lane runs (square) · 3 the selected-day outline · 4 pin labels |
| Spacing | 4, 8, 10, 12, 16 |
| Layout | Edges: everything at a screen edge sits `--pad` in from it: 16 px on phones, 24 px from 768 px, 32 px from 1280 px, and never inside the device's safe area (notch, home bar) · Top bar: the full Tanaw logo left (40 px tall, 26 px or less on phones), icon buttons right: Observer view (from 768 px; on phones it is in the site panel), Earth & Sun, View (Whole Moon while a site is focused) and About · sky clock top left beside the Moon, about 160 px, no box (on wide screens, with the Times content under its key while a site is focused) · the Moon centred in the free band above the bottom bar, left of the open site panel and 16 px right of the clock's column while it holds Times (the camera's field of view and a horizontal and vertical view offset frame it; the canvas itself stays full screen) · site panel on wide screens: a right-hand column, 320 px (360 px from 1440 px wide; `--panel-w`) · planning bar along the bottom, full width · the site picker is a sheet from under the top bar to the bottom, content up to 1120 px wide |
| Breakpoints | 1024 px and wider: the site panel is a right-hand column; narrower, it is a sheet opened from the bar · 760 px and narrower: the bar stacks (the switcher; the clock, 88 px, beside the call; Wait and Move; Site info (while a site is focused), Forecast, Times and Compare; the forecast panel when open; then the day control in two rows: Play, the date-and-time button and the range button; the timeline full width below), Compare is a scrollable lower tray with the Moon above it, and the site picker's cards become one row that scrolls sideways and snaps (a grid on desktop) · 400 px and narrower: tighter buttons and smaller countdowns |
| Shadow | None |

### Observer layout

The observer uses a place title and persistent calculation/visibility status at the top, a flexible
scene in the middle, and presentation, look-direction and View options controls at the
bottom. Readouts sit on black below the scene. View options is a scrollable 340 px column
beside the scene on desktop; at 760 px and below it replaces the scene with a scrollable
settings sheet. Close or Escape returns focus to its trigger.

The upper-right Moon navigator uses a 200 px canvas, reduced to 140 px on phones.
Its neutral marker and coordinates follow the accepted site. It initially faces that
site and supports direct orbit, zoom and location selection. A persistent header button
hides or shows it. It hides in lunar overview mode. Site/coordinate data, body readouts
and a UTC date line sit below the scene, above the presentation controls. The observer range
uses one outlined dropdown with two scroll wheels (number and day/week/month/year),
bounded to 365 days, 52 weeks, 12 calendar months or 1 year, at most 365 days. Confirm
applies the draft. Small date labels sit beneath the gold-thumb timeline.

Both timelines place a native date picker immediately before the slider. Selecting a date
updates the scene automatically; the picker has an accessible UTC label but no visible
label or calculate button. Its limits come from the coefficient manifest. Status and
availability remain inline below the timeline; estimates are identified in the readout.

No glass, blur, panel fills or decorative shadows behind general controls and text.
Whitespace and outlined states establish hierarchy. Actual terrain and Moon rendering carry
the scene's depth. Small labels drawn over imagery use the existing solid dark backing;
the `glass-solid` token name is historical and does not authorize translucent panels.

Controls use gently rounded corners through the shared control radius. Small map labels
use the label radius; selected days use the selected-day radius. Forecast lane ends stay
square so continuous runs read clearly. Geographic markers are circles, not decorative badges.

Keep text on black and leave the scene clear of controls. Do not add glass panels,
glowing edges or terminal-style typography.

## 5. Components

- **Site header (wider screens, above 760 px):** place, time and verdict read as one header
  at the top of the left column, above the sky clock: the site switcher (name and arrows;
  tapping the name opens the site picker and its search), then the date-and-time button, then
  the call. The bar keeps Play, the speed, the timeline, the range and the panel buttons. On
  phones all three stay in the bar (below), near the thumb.
- **Time bubble:** while the timeline is dragged, a small bubble rides on the playhead with the
  day and hour the thumb is on ("Tue 22 Dec · 00:00", 600, 13 px, tabular figures, `--go-text`
  on `--sun`, 4 px corners), 8 px above the track, kept on screen; it hides when the drag ends.
  Hidden from screen readers, since the slider's own value says the same.
- **Planning bar (bottom, full width):** two rows.
  - Row 1: the site switcher, the call with its reason, the Wait and Move chips, and on
    the right "Site info" (narrower screens, while a site is focused) and the Forecast and Compare icons. The switcher has previous and next buttons
    (44 × 44, Tabler chevron-left and chevron-right outline icons, 1.5 stroke, inline SVG
    in `currentColor`, no outline) either side of the site name: one line at 16 px,
    shrinking to no less than 14 px to fit; a longer name ("Connecting Ridge Extension")
    wraps to two lines at 15 px, never under 12 px, inside the same 44 px row. The arrows
    step through the sites and wrap round; tapping the name opens the site picker. The call is a
    dot and "Go" or "No-go" (600, 18 px; Go has a gold dot, No-go a hollow dot outlined in
    `--nogo-edge`), with its reason on the same line: "No-go · Earth hidden all day, needs
    8 h", or on a Go day "Go · Sun up 24 h, Earth in view 18 h".
  - Row 2, the day control: one calm row, in the manner of NASA Eyes' time controls, so
    the date reads first and nothing in the row competes with it. Play / Pause, the
    date-and-time button, the timeline, then the range button. On phones Play, the date
    and the range share the first row and the timeline takes the full width below.
  - The date-and-time button ("1 Dec 2026 · 00:00 UTC", 600, 16 px, tabular figures) is
    the row's main text: it shows the instant the globe shows and opens the date and time
    picker. It is a ghost button with a fixed width (226 px, the widest label), so the
    timeline never moves while autoplay ticks the hour. On phones it takes the room
    between Play and the range; up to 400 px wide its label always takes two lines, breaking
    after the "·", so it never jumps between one line and two as the date changes.
  - In the picker the published forecast's days (1 Dec 2026 to 30 Nov 2027) are bright and
    600, the other days `--muted`, with one 12 px `--muted` line under the grid: "Bright
    days: published forecast, 1 Dec 2026 – 30 Nov 2027". Today is the current UTC date, also
    outside the published year (then an estimate); confirming it returns to live time (below).
    The observer's picker has no published range.
  - Estimate mode: the call keeps its form, by the same rule, labelled with its quality
    ("Estimate · No-go · Sun up 3 h, needs 18 h"), from the estimate's Sun and Earth hours.
    Under the bar one status line remains, cut with an ellipsis, starting with what
    matters ("Showing the estimate on coarse terrain; …"); the long readout is for screen
    readers only.
  - The timeline is the day slider: a thin 4 px track (radius 2 px) with a 14 px thumb;
    the input stays 44 px tall, so the whole strip takes taps. The thumb shows what is in
    view at the instant the bar shows, from the published hourly visibility (or the
    estimate's): `--sun` for the Sun only, `--earth` for the Earth only, left half `--sun`
    and right half `--earth` for both, `--sel` for neither. A 2 px `--space` ring keeps it
    apart from the track's segments. Until that hour's data has loaded it keeps its last fill. It covers the window
    the range chooses, not the whole year. The track is `--line` and shows the selected
    site's Go days in that window as `--text` segments, each centred under the thumb
    position for its day, so you can see where Go starts before you drag.
  One site at a time is the point: the screen shows one forecast, and the globe flies to
  each site as you step.
- **Range:** a ghost button at the end of the day control names the window ("30 days",
  14 px, with a Tabler chevron-down) and opens a small menu above it with the three
  choices, "30 days", "3 months" and "1 year", as full-width 44 px rows; the chosen one
  has a check and an outline. Choosing closes the menu; Escape closes it too and returns
  to the button. The range is set rarely, so it sits folded away rather than as three
  boxes beside the date. It sets the window that the slider, the Go segments on its track
  and Compare show. A short window is for picking a day; a year shows the seasons. Changing the range
  keeps the planned date, and the window moves so the planned date sits about a third of
  the way in, with more of the future than the past in view; so do Wait and Move jumps. A
  date picked in the date picker starts the window instead (inside the published year it
  is back in the normal view, with the picked day first). The observer uses number/unit
  wheels in its range dropdown, with `--sel` fill and `--space` text on selected values.
- **Forecast panel:** the shown window as a table, one column per day, read like a weather
  forecast table, between the site row (switcher, call, Wait and Move, Site info, Times and
  Compare, which stay in view) and the play bar. The site row's "Forecast" button (44 px,
  `aria-expanded`) opens and folds it; folded, the button is all that shows.
  - Rows, under a sticky label column on black: the day (weekday initial, or the month at a
    1st and at the start, over the date in mono 600), Go (a filled Go dot or a hollow No-go
    dot), Sun hours and Earth hours (whole hours on a fill from black at 0 h to 40% of
    `--sun` or `--earth` at 24 h, and a faint diagonal `--edge` hatch at 0 h), then the
    height chart: each body's height across the columns, solid where seen, thin dashed
    `--muted` where hidden, a faint level line and a `--sel` line at the current instant
    (hourly at 30 days, each day's highest at longer ranges). A dot marks each body's highest
    point in the window, labelled in its colour with tabular figures and a true minus sign
    ("Highest Sun 2.0° · Fri 4 Dec"): the Sun's label in a strip along the chart's top,
    Earth's along its bottom, so no line crosses them. Go, Sun hours and Earth hours are all
    30 px tall, the day row 44 px and the chart 80 px; labels are centred on their rows and
    numbers in their columns. The label column is at least 96 px, so "Earth hours" fits. 1 px `--edge`
    rules between days, `--line` where a month starts. The planned day has one 2 px `--sel`
    outline down the whole column.
  - Columns: at 30 days on screens wider than 760 px they sit exactly over the timeline,
    column i centred over the slider's position i (about 27 px), so the table reads as the
    timeline's forecast. At 3 months and 1 year they are 28 px and the table scrolls
    sideways (no visible scrollbar); phones always use 44 px columns. The planned day is
    centred whenever it or the window changes, and a sideways scroll by hand stays put.
  - Picking a day: the slider stays the control. Each column's day cell is also a button
    that picks its day, a 44 × 44 px target on phones; on wider screens its width is the
    column's, so it is an extra, not counted as a control. Only the planned day's button is
    a tab stop; Left and Right step the day. Its label reads the day's call and hours.
  - Opening: it opens by itself when a site is chosen only on screens wider than 760 px and
    at least 950 px tall; shorter screens and phones start folded, because open it would
    leave the clock's column, the site panel and the Moon too little room (at 1280 × 800 the
    countdowns, the spot readout and the terrain would be cut). Once the user opens or folds
    it, that choice is kept (local storage) on every screen. The Moon reframes into the
    smaller band above it.
  - Hidden while Compare, the enlarged clock, the site picker or Times
    above the bar is open.
  - Estimates (other dates, typed or clicked points): the same table for the estimate's
    window, from the estimate's own per-day hours and hourly heights (no new calculation in
    the view), with "Estimate" (600, `--text`) in the top-left corner; its tooltip and About
    say it is worked out in the browser on coarser terrain. A day's column picks that day,
    and the selection follows Autoplay.
- **Map layers:** a Layers button in the top bar (Tabler `stack-2`, 44 px, next to Earth &
  Sun; outlined in `--text` while any layer is on) opens a menu with a switch for each layer:
  Slope, Sunlight and Permanent shadow (44 px rows, `menuitemcheckbox`, a checked one ringed in
  `--sel`; they keep the menu open), then "All off" (disabled while none is on; it closes the
  menu). Arrows move, Escape closes. Slope and Sunlight both fill the ground, so turning one on
  turns the other off; Permanent shadow is an outline and stacks over either. The choice stays
  across sites, dates and visits (local storage).
  - In the site view the same switches also sit under the disc, after "Horizon" (see the site
    view below).
  - Data: value images in `data/layers/` (built by `science/make_layers.py`), coloured by token
    in the shaders, so the files hold numbers, not colours. Slope in four bands (`--layer-0`
    to `--layer-3`, flat green to steep red); Sunlight from `--glass-solid` (0%) to `--sun`
    (100%), the nearby spots' scale; Permanent shadow in `--layer-shadow`. No data is left
    clear. Not a "safe to land" verdict, so no layer combines them into one.
  - Coverage: Slope covers the whole Moon (a global map, slope over 3.8 km, with the finer
    240 m polar map from 75°S to the pole); Sunlight and Permanent shadow cover both poles to
    65° (NASA PGDA's polar maps) and leave the band between 65°S and 65°N uncoloured, with
    no assumed values. Picking a layer never turns the globe; it shows wherever it has data.
  - Globe: at 80% over the ground, half-lit even in shadow so it reads on the night side
    (`map-layers.js` picks the polar map within its coverage, else the global one). Zoomed
    out, a pixel shows the area's typical value rounded to a band, not speckle; for Permanent
    shadow it shows any shadow in it, so small crater floors still show at the default view.
  - Site view: the disc reads its site's own image (78 m cells, slope over 100 m), the far
    ground the globe's maps at each place, over the lit ground at 80%, under the 5 km ring
    and the spots.
  - Permanent shadow: an outline, where the flag changes from one pixel to the next (about
    2 px of `--layer-shadow`), on the globe and both parts of the site view, over the fill.
  - Key: a line under the bar for each layer that is on (13 px `--muted`, the layer's name 600
    `--text`, 12 px swatches): "Slope · Under 5° · 5–10° · 10–20° · 20° and over · Over 10°:
    too steep to land"; "Sunlight · 0% [ramp] 100% · ground level, 18.6-year average";
    "[outlined swatch] Outlined: permanently shadowed, never sunlit"; the last two end with "No
    data between 65°S and 65°N". The Sunlight key's tooltip and About explain that it is not the forecast's measure
    (2 m above the ground, one year), so values differ; the Slope key's tooltip says the
    globe's slope, over kilometres, reads gentler than a site view's.
- **Autoplay:** a Play button at the start of the day control steps time forward hour by
  hour, and every view moves together.
  - Control: a 44 × 44 ghost button (transparent, a `--line` outline only on hover) with the
    Tabler player-play icon, which turns into player-pause while playing (outline, 1.5
    stroke, inline SVG in `currentColor`). Its label reads "Play" or "Pause". It never
    starts by itself.
  - Speed: the visible range plays in about 30 s: 30 days at a day a second, 3 months at
    3 days a second, 1 year at 12 days a second. It runs on elapsed time, so slow frames
    skip hours rather than slow down, and a new day redraws the screen at most once a frame.
  - Smooth in the published year: between the published hours, the globe's lighting, the
    Sun and Earth bodies and the sky clock's and strip's rings move every whole minute, so
    the motion is continuous. Those positions come from the computation module's own
    interpolation between adjacent hours (productSnapshot and productMoonDirections, over
    the same published files); the view adds none. The data, the call, the bar's date and
    hour and the diagram stay hourly and daily. Pausing returns the drawing to the hour the
    bar shows. With reduced motion playback steps a day at a time in both modes.
  - Smooth in estimate mode too: the estimate carries an hourly Moon-frame track for its whole
    window, so playback runs hour by hour through the same two functions, from the window's
    first day at 00:00 UTC to its last whole hour, with no new engine run while playing. The
    site view's lighting follows each hour's Sun and Earth azimuth and height. Pausing runs the
    engine once for the hour shown, in the same window, so every view, the link and Observer
    view agree on one instant again.
  - Live time: opened without a date in the link, the page shows the current UTC hour (the
    published forecast from 1 Dec 2026 to 30 Nov 2027, an estimate outside it), and follows
    the real clock: once a minute the globe's Sun and Earth move to the current minute (the
    computation module's interpolation, or the estimate's track), and the hour and day step
    on when they change (an estimate is worked out again each hour). The date button shows
    the live minute ("14 Dec 2026 · 12:34 UTC"). Play, the slider, picking a day or a date and
    the Wait chip leave live time; Today, confirmed in the date picker, returns to it. A link
    with a date keeps its date.
  - The instant: the current instant is the planned day plus an hour. Without autoplay the
    hour is the default one (00:00 UTC on the globe, the lit hour in the site view). Play
    starts from the current instant (00:00 UTC when no hour is set), or from the start of
    the range when it is already at the last hour. Any change of the day by the user
    (dragging the slider, the range, the Wait chip) goes back to the default instant.
  - What moves: the globe's lighting and the Earth's phase, the Sun and Earth bodies, edge
    markers and overhead rings, the site view's lighting and shadows, the now marks on the
    sky clock and height strip, the date-and-time button ("1 Dec 2026 · 05:00 UTC")
    and the slider thumb, which glides hour by hour (a drag still snaps to whole days). The
    call, its reason, the Wait and Move chips, Compare and the countdowns are daily: they
    change at each new day.
  - Pausing: Pause; dragging the slider or moving it with a key; changing the range;
    picking a site in any way; opening Times, Compare, the site picker, the enlarged clock
    or the site sheet on phones; and the Wait chip. Pausing keeps the hour.
  - Looping: after the last hour of the range's last day (or its last day with reduced
    motion) playback goes back to the range's first day and keeps playing until paused.
  - Reduced motion: Play still works, but steps a day at a time at the default instant, at
    the same 30 s for the range.
  - Loading: the next month's Sun file loads 4 days ahead of the playhead, and the sky
    clock's span already loads the site's hourly sky 15 days ahead, so a month change
    doesn't stall.
- **Wait chip (the first answer):** on a No-go day it names the next Go day for this site
  and how long that Go run lasts: "Wait: Sun 13 Dec, +12 d · Go 15 days". It searches the
  whole year, not only the window on screen. Tapping it moves the planned date there.
  With no Go day left it reads "Not Go by Tue 30 Nov 2027". On a Go day it reads "Go for
  15 days", how long the current run lasts. A run is counted to the end of the data; when
  it reaches the end, the count reads "N+" ("Go for 40+ days").
- **Move chip (the second answer):** on a No-go day, "Move: Malapert massif" selects the
  first site that is Go on the planned date, and the globe flies there. "+1 more" opens a
  short list of the other Go sites. With none it reads "No site Go on this date". It is
  hidden on a Go day.
- **Times:** the Forecast panel's right-hand column (232 px, as Windy's "About location"), and
  under the table on phones, where the Sun–Earth–Moon diagram sits beside the countdowns; it
  shows whenever the Forecast panel does, and there is no Times button. Its content: the two
  countdowns: the time from the planned
  day's 00:00 UTC to the next sunset or sunrise and Earthset or Earthrise ("2 d 6 h",
  "6 h 14 m"). The counts are static, not ticking. With no such event before the data
  ends, the countdown says so: "No earthset" over "before 1 Dec 2027". Under them, in the same two columns,
  "Sun above level" and "Earth above level" give each body's published hourly elevation
  ("2.3°", "−1.4°": one decimal, a true minus sign, tabular figures; `--sun` and
  `--earth` like the countdowns). "Level" is the flat horizon, not the terrain skyline,
  so a body can be above level yet hidden by a ridge, and below level reads negative. The
  readouts are for the current instant: the autoplay hour, else the lit hour in the site
  view, else the planned day's 00:00 UTC. They change with each autoplay hour and read
  "–" until the day's hourly file has loaded. They stay reachable but come after
  the answers. Values never run past their column: a count stays on one line, and "None
  before 1 Dec 2027" wraps. While the site view's pin is on a
  nearby spot, "At <site>" (13 px, `--muted`, one line) sits directly above the countdowns,
  since they are the site's own.
- **Site panel:** the focused site's details. A site is focused from the first time the
  user picks one (the switcher, the site picker, the Move chip, a row in Compare or a pin)
  until "Whole Moon"; the page opens with no site focused.
  - Wide screens (1024 px and wider): the panel opens with focus and closes when it ends;
    it has no Close button. It is a right-hand column, 320 px wide (360 px from 1440 px),
    16 px from the right edge, from the sky clock's top (under the top bar) to 12 px above
    the bar. Text sits on black with no fill or border, and the content scrolls inside the
    column when it is taller (rows scrolled out of view take no taps), with no visible
    scrollbar: like the clock's column, its last 40 px fade out while more is below. It holds the site's
    information only; the sky clock and the Times content stay in the left column (see
    Times). The globe and the site view are framed between the two columns.
  - Narrower screens: it never opens by itself, because it would cover the arrival.
    While a site is focused a "Site info" button joins the bar's row of buttons, before
    "Times" and "Compare" (all three fit one row at 320 px), and opens the panel as
    a bottom sheet: full width, sliding up to half the screen's height over the
    bar. The top bar and the globe or terrain disc stay shown above it, re-framed into the
    space between the top bar and the sheet's top edge; pins and edge markers under the
    sheet hide. The sheet is solid `--space` black with a 1 px `--edge` top line (it sits
    over the stage), no blur or shadow, and its content scrolls inside it.
    - Handle: a full-width 44 px button along the sheet's top, with a 36 × 4 px rounded
      `--line` grab bar in the middle; it stays put while the content scrolls. Its label
      reads "Expand details" or "Collapse details" (with `aria-expanded`). A tap toggles
      half and full height (full: up to just under the top bar, where the framing stays at
      the half-sheet band). Dragging it moves the sheet; on release it snaps to the nearer
      of half and full, or closes when dragged below a quarter of the screen's height.
    - "Close" (44 px) sits beside the heading in the sheet's top row. "Close", Escape or
      the drag down closes it, and focus returns to "Site info". With reduced motion
      the sheet doesn't slide.
    - The sky clock stays where it is; the sheet holds only the site's information, up to
      560 px wide.
  - Content, in order: the site's name (600, 22 px; a site without a name shows its
    region and coordinates); the coordinates ("89.44° S, 137.17° W", 13 px, `--muted`,
    tabular figures; longitudes over 180° east read as west), then on the same line the
    category ("Base candidates") and "approximate position" where the position is
    approximate, joined by " · " as plain words, not tags; mission · agency · date
    (14 px); the site's photo at the full panel width and its own shape, never cropped
    (its credit is in About); the summary; then
    "Official page" (opens a new tab) and "Observer view". Parts a site doesn't have are left out.
  - On landing day, for visited sites only, under the summary: "On landing day" (13 px,
    600, `--muted`); the touchdown from `data/landings.json` in the app's date format with
    its UTC time ("Sun 20 Jul 1969, 20:17 UTC", 14 px, 600); the Sun and Earth at that
    instant on one line, each after an 8 px dot in its colour, up or hidden and its height
    to 0.1° ("Sun up, 10.7°", "Earth hidden, −39.2°"); then one 12 px `--muted` line,
    "Estimate on coarse terrain." and the source as a small link. The sky comes from the
    browser quick estimate (1969 to 2100), which loads only once the block is on screen;
    until then the line reads "Working out the sky…". Base candidates and upcoming sites
    show nothing here.
  - Opening Compare hides the current panel; clicking the Moon opens candidate details. Closing Compare brings it
    back while the site is still focused. The site picker and the enlarged sky clock hide
    it like the rest.
  - "Observer view" opens the observer at the focused site and current autoplay hour,
    including after pausing; otherwise it uses the lit hour
    (`observer/?site=<id>&t=2026-12-16T05:00:00Z`, or the planned day's 00:00 UTC until
    the lit hour is known). The enabled link also passes the site's full `lat` and `lon`
    coordinates. The separate observer page retains its existing shell and camera,
    with saved-data controls and explicit unavailable states in place of fixture inputs.
- **Site picker:** choosing a landing site works like an airline's "choose your
  destination" page, calm and photographic, because in this concept travel to the Moon is
  ordinary.
  - Opening: tapping the site name in the bar opens it, and so does the top bar's search
    icon, which puts the cursor in the search field; the previous and next buttons still
    step through the sites. It is a full overlay from under the top bar to the
    bottom, with content up to 1120 px wide and its own scroll. The globe and its pins are
    hidden while it is open, so its text sits on pure black. The head reads
    "Choose a site", a muted line with the planned date ("Calls for Tue 1 Dec"), and
    "Close". "Close", Escape or picking a site closes it. Only one overlay is open at a
    time.
  - Search: first in the picker, an outlined field up to 480 px wide with the search icon
    inside and "Search sites" as its placeholder (16 px text, so phones don't zoom). As you
    type it narrows the cards to sites whose name, mission, agency or category contains
    every word typed, together with the chosen filter chip; with none left it says "No sites
    match." Enter goes to the first card, like tapping it: the globe flies there and the
    picker closes. The count of sites shown is said to screen readers. Closing the picker
    clears the search. In estimate mode it narrows the plain list of names the same way.
  - Go to coordinates: under the search, "Go to coordinates" (13 px, `--muted`), then two
    outlined 44 px fields, latitude and longitude in degrees, north and east positive (their
    placeholders "N +, S −" and "E +, W −" say so), and Go. A latitude outside −90 to 90 or
    a longitude outside −180 to 360 is outlined and explained in one line under them. Go
    opens that place in estimate mode, named by its coordinates ("85.50° S, 30.25° E") in
    the switcher and the site panel (with no second coordinates line there). It has no pin
    and no ring on the globe. It can be pinned or added in Compare, with its estimate labelled. Moving from it to a listed
    site (previous or next, the picker, a pin, search) on a published whole hour returns to
    the normal view, as the date picker's in-year Confirm does.
  - Filters: a row of chips, All · Base candidates · Visited · Upcoming, taken from each
    site's `category`. A chip with no sites is hidden, and the whole row is hidden when no
    site has a category. A site without a category shows only under All. Chips have a 1 px
    `--line` outline; the active chip has a 2 px `--text` outline, never a fill.
  - Cards: a grid on desktop (columns at least 232 px wide, 16 px gaps); on phones, one
    row of 248 px cards that scrolls sideways and snaps to each card. Each card has a 16:9
    hero image, the site's name (600, 16 px), "mission · date" (13 px, muted, only the
    parts that exist), and the call for the planned date with its Go or No-go dot ("Go on
    Tue 1 Dec", "No-go on Tue 1 Dec"), using the same Go rule as the bar. The hero is the
    site's `image`, with no text on it (photo credits are in About). Until images are approved, the hero is a `--glass-solid` tile with the site's
    initials (600, 32 px, `--muted`). No generated imagery. Tapping a card selects the
    site, the globe flies there and the picker closes. A separate "Details" button opens
    the detail view. The selected site's card has a 2 px `--text` outline around its hero.
  - Detail view: shown inside the sheet, with "Back to sites". A larger hero, the name
    (600, 22 px), a one-line summary, then label and value rows: Mission, Agency, Date,
    Coordinates (latitude and east longitude, then the frame, or "frame unverified"),
    Ground height (metres above the reference sphere), and the call for the planned date
    with its reason. Then a Sources line (the site's source, the ephemeris and the
    terrain), the official page link, and "Select this site", an outlined button like
    every other.
  - Missing data: a field that has no value is left out with its label and separator, so
    there are no empty labels, stray dots or blank rows.
- **Compare:** the bar or site panel's "Compare" button captures the current location as
  the first of three slots in a lower tray. Every location can be removed. Sites are numbered
  1–3 in insertion order; removing a site compacts the remaining numbers. The Moon stays
  visible and interactive above the tray; the sky
  clock, horizon strip and Earth/Sun diagram slide left and fade out. Reduced motion removes
  the transition. The shared date and range remain available below the tray.
  - Two outlined "Add a site" slots start empty. Selecting a slot arms the next Moon click;
    its text changes to "Click on the Moon". Escape cancels picking without closing Compare.
  - Clicking the Moon without arming a slot opens that location's details. Its action reads
    "Add site" in Compare and "Compare" otherwise. Adding keeps the details open and changes
    the action to "Remove site"; removing changes it back to "Add site". A new candidate at
    capacity shows a "Comparison full" status label and a guide to remove a site before adding
    this location. Candidates never replace an existing comparison site.
  - Matching numbered Moon markers replace the catalogue markers during comparison.
    Selecting a numbered site name in the tray rotates the Moon to that location without
    opening candidate details. Marker numbers always match the current row order.
    Nearby markers separate with a line to the exact point. Locations on the hidden hemisphere
    use a dashed, explicitly labelled "Far side" indicator at the limb. Travel markers remain.
  - Each row shows its location, forecast quality, and daily Sun/Earth hours and Go status
    from the shared forecast source. Custom locations retain their estimate label. Forecast
    columns share the same UTC window, use one shared horizontal scrollbar below the rows,
    and let users select a day. Scrolling any chart also moves the others. Scrubbing
    the timeline follows the selected date in every chart. Loading uses a small spinner, with
    a static indicator under reduced motion; failure/retry states stay within their own row.
  - On desktop, candidate details occupy the right side. On narrower screens, they replace
    the lower tray temporarily, preserving the Moon and timeline. Close returns to the tray.
    "Done" or Compare closes comparison; Escape closes the candidate or armed slot first.
    On exit the tray fades and collapses as the sky details and catalogue markers return.
- **Travel comparison:** a card's Compare action starts with that destination only. The
  shared three-site controller switches the cards to Add site, Remove site, or Comparison
  full. In this context every member can be removed, including the first. Travel keeps
  its search, dates, filters and matching Moon diamonds. Compare uses its existing bottom tray beneath the Moon
  and stays clear of Travel on the right. On phones, Travel collapses to a retained header;
  Expand/Collapse switches the lower workspace without clearing dates or results, leaving
  enough room for a complete comparison chart and its shared rail. Opening Travel from Compare preserves its selected sites, UTC window and hidden
  sky/forecast panels; closing that added Travel panel returns to the same comparison.
  Comparison row and marker navigation preserve the scrubbed UTC and shared window. On
  short phones the comparison heading scrolls with the rows so site controls remain usable.
  Filters never change the Moon framing. Closing comparison returns focus to
  the selected Travel card. The 360° Observer icon reuses the top-bar glyph and carries
  the exact destination coordinates and full trip interval.
  - Comparison reuses the science module's existing Travel daily values, including
    partial arrival/departure days, explicit unknowns and mixed forecast sources. It
    does not rerun or substitute the example mission's daily Go rule. Changing the
    search criteria ends a comparison started from Travel before refreshing results; a
    comparison started on the main Moon retains its sites and window.
- **Lanes:** two lanes over a Go line, one column per day with no gaps. The Sun lane
  (7 px) is `--sun` on days with at least `NEEDS.sunHours`, the Earth lane (7 px, 2 px
  below) is `--earth` on days with at least `NEEDS.earthHours`, and the Go line (3 px,
  2 px below) is `--text` on Go days. Each lane and the Go line is one drawn bar, painted
  with hard colour stops: runs of filled days in the lane's colour, and the 1 px
  `--nogo-edge` track line through the middle for empty days. One bar per lane, not one
  element per day, keeps a year of days light to draw. Run ends are square, so each run,
  and each Go window, reads as one shape even when a day is only 2 px wide. Each site's
  lanes are its row in Compare.
  The planned day's column has a 2 px `--sel` outline over it, at least 4 px wide so it
  stays visible when days are compressed. In this data the polar
  No-go days come almost all from Earth being below the skyline, so the Earth lane carries
  the story.
- **Sky clock (no box, always visible):** the horizon ring, with no heading or key on the
  main screen ("Sky from the site" and the key Sun, Sun hidden, Earth show only in the
  enlarged clock; About has the key). Its compass letters (N, E, S, W, `--muted`) are at
  least 9 px on screen at every size: 12 drawing units in the 160 px clock, 21 in the 88 px
  phone clock, centred on their points just outside the ring. It shows the site's skyline as a ring, with the
  Sun's path over 30 days around the planned date, from 14 days before it (faint where
  terrain hides it), and Earth's small wobble. The planned day is highlighted, as "now"
  is. The clock keeps this 30-day span whatever range is chosen, because a year of paths
  would bury the planned day. While Autoplay has set an hour, a 1.5 px `--text` ring marks
  the Sun's and Earth's points at that hour on the clock and the height strip, in place of
  the site view's lit-hour ring.
  There is no filled disc. Only the ground band, between the skyline and the outer ring,
  is filled, in `--terrain`. The sky inside the skyline is black, the skyline is a 1 px
  `--muted` line, and the paths and compass letters sit on black. It sits top left on
  desktop (with the Times content under its key while a site is focused on wide screens)
  and at 88 px beside the call on phones. Tapping it enlarges it as a full
  overlay (up to 360 px) that hides the globe and its pins; tapping again, "Close" or Escape shrinks it. On a No-go day
  it points at the reason: the planned day's hourly points for the body that falls short
  are drawn large, the hours when it is hidden behind the skyline are hollow rings in its
  colour, and every other day fades back. Visibility comes from the forecast's hourly
  flags, not from the browser. The hourly sky positions load one month at a time, only
  for the selected site and only when the clock or the forecast panel needs them, so a
  year of forecasts doesn't load up front (the panel's "1 year" range loads all twelve).
- **Height strip (under the sky clock, same width):** the clock unrolled into a side view.
  Azimuth runs left to right from north round to north (N E S W N under it), and height
  runs up on the same −3° to +9° scale as the clock, so the two read the same way. The
  skyline is a 1 px `--muted` line with `--terrain` below it, and a faint dashed `--edge`
  line marks level (0°). It shows only the planned day's 24 hourly Sun and Earth points:
  filled where the body is seen, hollow where the terrain hides it, so how far a body
  clears or misses the skyline is easy to read. A point above +9° or below −3° is not
  pinned to the edge: it is a small arrow (6 px wide, 5 px tall) on the edge it left through,
  pointing up or down, at its azimuth and in its colour, filled or outlined the same way;
  the current instant's ring goes round that arrow. It is drawn in real pixels so the points
  stay round. It hides while Times or Compare is open, so those panels keep their room.
  On phones it shows only in the enlarged clock, under the ring.
- **Globe lighting:** the Moon is lit for the current instant: the selected day at 00:00
  UTC, the same instant the countdowns start from, or the hour Autoplay has reached. The
  sunlit half turns round the pole as you drag the day slider or play. The Sun's direction
  comes from the hourly entry for that instant in its monthly Sun file (the subsolar point
  from JPL Horizons, in the sites' frame); a fixed placeholder Sun shows
  only until it loads. The night side gets a faint earthshine-like fill, so its ground still
  shows (about 5% of the sunlit brightness, brightest where the ground faces you). It is
  decorative, not a lighting result, and low enough that the day/night line stays clear: lit
  ground 5 to 10% of a radius past the line stays about 4.6 times brighter than the night
  side next to it. The Earth sphere uses NASA's Blue Marble texture (listed in
  SOURCES.md), and About credits it.
- **Sun and Earth:** like a solar system viewer, the globe shows where the Sun and Earth
  are from the Moon on the planned date. Directions are real; sizes and distances are
  not to scale. It explains the call at a glance: Earth sits low on the near side, or is
  out of view from the far side.
  - Earth (desktop, 761 px and wider): a small Blue Marble sphere at a fixed distance
    along Earth's real direction from the Moon at the current instant. It is lit
    by the real Sun, so its phase shows. A small label reads "Earth" (12 px
    on a `--glass-solid` chip) beside it, right or left, else above or below it, wherever it is clear, keeping the whole chip 4 px off the Moon's face; only when Earth itself is in front of the Moon and no spot off the face is clear may the chip sit on the face. It hides when no spot is clear. Earth's own spin is not modelled, so the continents are
    not placed by time of day.
  - Sun (desktop): a small flat disc in `--sun`, at a fixed distance along the Sun's
    direction, over a soft glow like the Sun–Earth–Moon diagram's: `--sun` at 35% opacity
    out to the disc's edge, fading to nothing at 2.5 times its radius. The glow moves,
    scales and hides with the disc in every view. It is hidden when the Moon is in front
    of it. Text near it keeps its contrast: chips sit on `--glass-solid`, and the
    unbacked `--muted` labels stay at least 4.9:1 even over the glow's brightest part.
  - In front of the Moon or behind it (both bodies, every view, at any turn or zoom): a
    body nearer the camera than the Moon draws over the Moon's face, as it would in space,
    and keeps its chip, and what lies on the Moon under it is covered too: pins, numbered
    pins, the overhead rings and the selected site's pulse hide while their mark would touch
    the body's disc. A body behind the Moon is hidden by it (the depth test), and then its
    edge marker or overhead ring shows where it is.
  - Edge markers (all sizes): when a body is outside the free band or behind the Moon, a
    small chip at the band's edge points to it: "Earth" or "Sun" in its colour (12 px,
    600) on `--glass-solid`, with a Tabler arrow towards the body. Markers take no taps.
    They keep clear of the top bar, the sky clock and the planning bar, and hide while a
    full overlay hides the globe.
  - Overhead rings (all sizes): a 14 px ring on the Moon where Earth is overhead
    (`--earth`) and where the Sun is overhead (`--sun`), each with a thin `--glass-solid`
    halo so it reads on the sunlit surface. Their names show only on hover, so the globe
    stays clean. They sit under the site pins.
  - Phones (760 px and narrower): no Sun or Earth bodies, only the edge markers and the
    overhead rings, so the small screen stays calm, until the view is pulled back past 5 Moon
    radii; then the bodies show as on desktop.
  - Motion: everything follows the current instant. Sweeping the slider shows Earth's small
    monthly wobble and the line between day and night moving. Nothing animates on its
    own; Autoplay moves the instant only when asked.
  - Data: positions come only from the Sun data files' sub-solar and sub-Earth points.
    The browser does no astronomy; it only places each body along its direction.
- **Earth and the Sun in 3D (`bodies.js`):** one Earth and one Sun for the globe, the Earth &
  Sun view, the site view and the Observer view, so they look the same everywhere. Earth is
  NASA's Blue Marble map lit along the published Sun direction, so its phase is real (oceans
  with a faint glint, a thin blue rim on the day side's limb; until the map loads, `--earth`),
  and a soft `--earth` glow just outside the day side's limb, out to 1.15 times its radius
  (the lit air), so a thin crescent still reads at a small size; a view may add a faint
  night-side fill towards the camera (at most 4% of the sunlit colour) so a dark Earth still
  reads as a sphere. The Sun is a photosphere disc in `--sun` (limb darkening, a fine grain) with one soft
  glow (`--sun` at 35% to the disc's edge, fading out at 2.5 times its radius) and no rays. A
  body out of view from the site is drawn fainter (35%). The 2D charts keep their token dots.
- **Earth & Sun view:** one Earth & Sun icon button in the top bar, left of View (44 px,
  `aria-pressed`; pressed shows this view, unpressed the close
  view above). It shows only with the globe, not the site view; picking a site that opens the
  site view returns to the close view. The top bar stays one row down to 320 px.
  - Camera: glides (1.2 s, ease in and out; a jump with reduced motion) to a view square to
    the Moon–Earth line, Earth on the right, Moon north up, 25° below the Moon's equator
    plane, so the Sun's monthly path round the Moon reads as a ring that never crosses the
    Moon's disc, and the south polar sites face you. Pulled back so the Sun's whole path (with
    its drawn size) fits the free band across and up and down, and Earth's loop above and
    below the plane fits too, with a margin (10% and 15%); the Moon stays centred. Turning and zooming stay free; "Default view" in the View menu frames it again; the
    other views turn to face a pole or a side at this distance; turning the
    toggle off glides back to the view that was left.
  - Sizes: bigger than in the close view, by one rule for all three bodies, so they read in
    the real order, Sun > Earth > Moon, still not to scale (About says so): each body's drawn
    radius is its true radius to the power 0.1, in Moon radii (the Moon 1, Earth about 1.14,
    the Sun about 1.82). Earth at 4.2 radii out along its real direction, the Sun 2.5 times as
    far (10.5), so the Sun's path stays well outside Earth's loop and the Sun never seems to
    jump over Earth. The view zooms out to fit that path, so the Moon is smaller here.
  - Paths: over the shown range, the Sun's path round the Moon at its distance (1.5 px `--sun`
    at 60%) and Earth's small libration loop at its distance (1.5 px `--earth` at 60%, drawn
    over Earth's disc, since the loop is smaller than Earth as drawn). Both come from the
    computation module (the published hourly directions, or the estimate's track) every 2 h;
    the bodies move along them during Autoplay. Hidden where the Moon is in front.
  - Earth (also on phones) at its place for the current instant, so it moves with
    Autoplay. Overhead rings are hidden. Its night side gets the same faint fill as on the
    globe (4% of the sunlit colour where it faces you), so the crescent and its glow stand
    out and Earth still reads as a sphere; it is decorative, not a lighting result.
  - Sun: the Observer view's photosphere (limb darkening and a fine grain) in `--sun`, with
    its glow, at 1.6 times Earth's drawn size (the size rule), whatever its distance, with a "Sun"
    chip like Earth's (on the side away from the Moon first). It keeps its real direction on
    screen, moved further out along it until it is clear of the Moon's disc and Earth's (6 px
    apart). So near Full Moon, when the Sun and Earth lie in the same direction from the Moon,
    Earth never covers any of the Sun's disc at these exaggerated sizes; only the glow passes
    behind Earth. When its direction falls on the Moon's disc (nearly along the line of sight, in
    front or behind), its direction on screen means little, so it sits on the side away from
    Earth, just outside the limb. It never enters
    the sky clock's column: the disc, and its chip when that is on the left, stay at least
    16 px right of the column. In this view the "Sun" and Earth chips stay at least 12 px
    inside the screen's edges; the Sun moves right to make room for its chip. Moved clear of
    Earth on a narrow screen, it goes beside Earth, round it, rather than out of the band; a
    disc a few px over the band's edge is nudged back in.
  - Never hidden silently: framing keeps the Moon, Earth and the Sun in the band all month.
    When a turn or zoom takes Earth or the Sun off screen or under the interface, an edge
    marker points to it, as in the close view.
  - Ring: the equator plane as a 1.5 px ring at Earth's distance (`--muted` at 80%, above
    3:1 on black), so Earth sits visibly above or below it. It stops 16 px short of the sky
    clock column on the left and inside the free band on the right (which ends 16 px short of
    an open site panel), and is hidden where the Moon, Earth or the Sun covers it. "Moon's
    equator plane" (12 px, `--muted`) sits above its left end, not on phones.
  - The selected site: no pins in this view; the selected site is a 10 px `--text` dot on a
    2 px dark rim, with a 2 px ring that grows to three times its size and fades every 1.6 s
    (still, at 1.8 times, under reduced motion). No label. It sits on the site while the site
    faces the camera; otherwise on the limb, in the site's direction from the Moon's centre
    on screen, so a polar site seen side-on shows where its pole meets the limb.
  - No caption: nothing else is explained on screen.
  - Pole line: a short `--muted` mark down the axis below the south pole and, for polar sites,
    a 1.5 px `--earth` line from the mark's tip to Earth's centre, solid while the forecast
    has Earth in view from the site at the current instant and dashed while it doesn't. Other
    sites get no line.
  - Night-side fill: in this view the side of the Moon away from the Sun gets a stronger
    fill than in the close view (about 6 to 10% of the sunlit brightness, brightest where the ground faces you), so a
    Moon lit from behind still reads as the Moon. It is decorative, not a lighting result.
- **Sun–Earth–Moon diagram:** a 160 px square inline SVG, seen from the north and not to
  scale, with a choice of centre. Each centre is its own frame, not a moved origin, and all
  three show the same angle between the Sun and the Moon at the current instant. It follows
  Autoplay hour by hour.
  - Earth (the default): Earth (radius 12) at the centre and the Sun (a radius 7 disc) fixed
    at the left edge, as in a standard phase diagram. The Moon (radius 5) goes round
    counter-clockwise on a radius 46 orbit: new on the left, first quarter below, full on the
    right, last quarter above. Its place is the angle from the Sun's direction to the Moon's,
    from the hourly sub-solar and sub-Earth points the globe uses, with lunar north standing
    in for ecliptic north (within about 1.5°) and the Sun's parallax ignored.
  - Moon: the Moon-fixed frame from above the lunar north pole. The Moon (radius 12) is at the
    centre with longitude 0, the near side, to the left and east longitude counter-clockwise.
    Earth (radius 7) is on an inner ring (radius 36) at the sub-Earth longitude, so its small
    wobble is the libration, drawn true. The Sun (radius 7) is on an outer ring (radius 64) at
    the subsolar longitude and goes round clockwise once a month. At Full Moon the Sun and
    Earth share a bearing, which is why they have separate rings; at New Moon they are
    opposite.
  - Sun: the Sun (radius 9) at the centre, ecliptic longitude 0 to the right and longitude
    counter-clockwise. Earth (radius 7) is on its yearly orbit (radius 46) and the Moon
    (radius 4) on a loop round it (radius 20), much enlarged. Both come from the hourly
    `data/orbit/<YYYY-MM>.json` listed in `data/orbit.json` (earthHelioLonDeg,
    moonGeoLonDeg) for the published months, and from the quick-estimate engine's
    `quickOrbit` (the same longitudes, frame and convention, 1969 to 2100) in estimate mode
    and on any other date; nothing is computed in the view. The engine loads the first time
    it is needed; while it works the drawing dims to 50%, and a newer date cancels the work
    for an older one. The button is never disabled. Only if neither source answers do Earth
    and the Moon hide while the Sun stays. This centre is behind `SUN_CENTRE` in
    forecast.js; while that is false the Sun segment is absent and nothing is fetched.

  Orbits and rings are faint 1 px `--edge` circles. The Sun is a flat `--sun` disc over a
  soft glow: a radial gradient of `--sun` from 35% opacity at the disc's edge to nothing at
  2.2 times its radius, allowed past the drawing's edge, so the Earth centre's Sun on the left
  edge is not cut flat.
  Earth (`--earth`) and the Moon (`--text`) are shaded spheres, lit from the Sun's direction
  (the left in the Earth centre, the Sun's bearing in the Moon centre, the centre in the Sun
  centre): the lit colour fades into a dark `--glass-solid` half across a wide, soft
  terminator 36% of the diameter, so even a 10 px body reads as a lit ball rather than two
  flat halves; the limb darkens toward `--space` (at most 50%, so the lit half stays at least
  3:1 against black at its very edge, 3.8:1 measured for Earth), a `--text` highlight (50% at
  its centre) sits toward the light, and a faint rim
  in the body's own colour (at most 22%) shows the night side's round edge. All gradient
  stops use tokens. Each body has a 1 px outline just outside its limb (`--earth` for Earth,
  `--muted` for the Moon), so its dark half reads against black. A 2 px `--muted` tick
  starting 1.5 px outside the Moon's limb marks the near side: 7 px long, pointing at Earth's
  centre in the Earth and Sun centres (4 px in the Sun centre) and fixed at longitude 0 in the
  Moon centre. It sits on black (about 11:1), not on the Moon's halves, because no token
  reaches 3:1 against the lit `--text` half. The bodies carry no text labels: their colours
  and the centre row's glyphs name them (that it is not to scale is said in About, not on the
  diagram).

  Under the drawing, the phase in 12 px `--muted`, in eight 45° bins centred on 0°, 45° …
  315°: New Moon, Waxing crescent, First quarter, Waxing gibbous, Full Moon, Waning gibbous,
  Last quarter, Waning crescent (a display choice, not an event time). It is the same in
  every centre. Under that, the centre row: Sun, Earth and Moon as joined outlined
  segments (equal widths, an 8 px outer radius), the pressed one with a `--text` outline. The
  outlined segment is drawn 22 px tall, centred inside a 44 px tall button with no border of
  its own, so each hit area stays at least 44 × 44 px and none overlap; the keyboard focus ring
  (2 px `--sel`) goes round the drawn segment. Each segment shows only a 16 px glyph of its
  body, with no visible text, named by its aria-label and a tooltip above it ("Sun at the
  centre", like the top bar's icons):
  the Sun as its disc and glow, Earth and the Moon as the drawing's own shaded spheres lit from
  the left, so they differ by colour and by their `--earth` and `--muted` outlines (lit sides
  at least 3.5:1 for Earth and 5.2:1 for the Moon against black, measured). The row is the drawing's
  width on wide screens and full width inside Times. Earth is pressed at first, and the choice
  stays while the site and date change. Switching cross-fades the drawing (200 ms out, then
  in); with reduced motion it switches at once.

  Wide screens (1024 px and up): last in the sky clock's column, after the key and after the
  Times content when that is there; the column scrolls inside itself when taller, with no
  visible scrollbar (wheel, touch and keyboard still scroll it), so on short screens the diagram and its row
  scroll away first and the clock stays at the top. The column always ends 12 px above the
  bar; while more of it is below, its last 40 px fade out, so the cut reads as "scroll for
  more". It hides while Times or Compare is open
  there, like the height strip. The Sun and Earth edge markers on the globe keep clear of the
  whole column. Narrower: only inside Times, the drawing at 128 px right of the countdowns and
  heights with its labels set 1.25 times larger so they render at the same size, and the row
  under both (see Times). On the globe the drawing (not the row) is a button ("Earth & Sun
  view", `aria-pressed` mirroring the top bar's button) that toggles the Earth & Sun view; in
  the site view it is a plain figure.
- **Site pins (on the globe):** each site from `data/sites.json` that faces the camera is a
  44 × 44 px button around a mark in `--text` with a 2 px `--glass-solid` halo, so it
  shows on both the sunlit Moon and black space. The mark's shape, not a new colour, says
  the kind of site (`category`): a filled 10 px dot for a base candidate (the challenge's
  Artemis and base sites, and any site without a kind), a 10 px ring (2 px outline on
  `--glass-solid`) for a past landing, and a 9 px diamond outline for an upcoming landing.
  Its label says the same for screen readers ("Apollo 11, past landing"). A site with a 3D
  terrain tile has a 1.5 px `--text` ring outside the halo (its label adds "3D terrain");
  numbered pins stay plain. Selected: the mark grows to 16 px (14 px for a diamond) and
  gains a second 2 px `--text` ring 5.5 px out, so it stands apart from a 3D terrain ring.
  Hover with a mouse, or keyboard focus: the mark grows 1.3 times (0.12 s; at once with
  reduced motion) and the site's name shows beside it in the label chip below; a numbered
  pin shows "2 sites". The key for the marks is in About only. Pins
  whose hit areas would overlap merge into one numbered pin: a 24 px circle with the count
  (mono 13 px, `--text` ring on `--glass-solid`; inverted when it holds the selected site).
  Tapping a numbered pin opens a `--glass-solid` list of its sites (44 px rows, the
  selected one outlined in `--sel`); tapping a site there or a single pin selects it, the
  same as its row in Compare. Pins under overlay text are hidden. Labels: a `--glass-solid` chip
  (13 px, 600, 4 px radius, `--edge` outline) beside the pin, right or left, drawn above
  every pin, numbered ones included. Only the
  selected site is labelled, also when it sits inside a numbered pin; other pins show
  theirs on hover or focus. At the default zoom the polar sites sit within a
  few pixels of each other, so they start as one numbered pin and separate as you zoom in
  (see Fly-to).
- **Turning and zooming:** a drag turns the Moon freely in any direction, with no stop at
  the top or bottom, and the surface moves with the cursor at every zoom. North can end up
  anywhere on screen; the View menu puts it back. Scrolling or pinching
  zooms between 1.15 and 10 Moon radii from the centre, far enough to see Earth and the
  Sun disc beside the Moon. There is no panning. While a site is
  focused the same button reads "Whole Moon" and ends focus instead: the site panel closes
  and the globe shows, still facing the site (see Site panel and Site view).
- **Top-bar icons:** the top bar's tools are 44 px square outlined icon buttons from
  Tabler (outline, 1.5 px stroke), in one row top right, 8 px apart (6 px under 375 px):
  Search (`search`, opens the site picker with the cursor in its search field; pressed
  while the picker is open), Observer view (an original 360° orbit icon, a link, from 768 px,
  also used by its site-panel link), Earth & Sun (`planet`, a toggle), View
  (`eye`, opens the View menu; while a site is focused it becomes Whole Moon, `zoom-out`)
  and About (`info-circle`). A row keeps them clear of the site panel and the Moon, which a
  rail down the right edge would not. Each has an `aria-label`, and the same name shows in
  a tooltip under it, right-aligned with it (13 px `--text` on `--glass-solid`, `--edge`
  outline): after a 0.3 s hover with a mouse, at once on keyboard focus, and not while its
  menu is open. Touch shows no tooltips, so every icon carries a common meaning on its own;
  none needs a visible label. Earth & Sun is the least obvious, so the Sun–Earth–Moon
  diagram under the sky clock is a second, pictured way into the same view. Travel
  (`route`) sits right of Layers from 768 px; on phones, where the top bar has room for
  four buttons, it is the first icon in the bottom bar's button row instead.
- **Bar icons:** the bottom bar's panel buttons are the same 44 px outlined icon buttons:
  Forecast (`table`, `aria-expanded`) and Compare (`chart-bar`), with Travel before them on
  phones. Their tooltips show above them, since the bar sits at the screen's bottom edge.
  Site info, Wait and Move keep their words: they carry information, not just a name.
- **About:** the "i" button (Tabler `info-circle`, a 44 px square) ends the top bar's
  buttons. It opens a modal sheet down the right edge, 440 px wide (full width on phones),
  on `--glass-solid` over a `--scrim` that dims the page; the page behind is inert. Inside:
  "About Tanaw" (22 px) and Close; one line on what Tanaw does; the team ("Team Gabay ·
  from the Philippines", no member names) and the code licence (Apache 2.0), then a "Source
  code" link to the public repository, which shows only once `REPO_URL` in forecast.js is
  set; "Go / No-go", the example mission's rule in one paragraph (its hours from `NEEDS`,
  the same text the call gives as its tooltip in one line); "Accurate forecast or estimate",
  which dates and places use the published forecast and which the browser estimate; the
  key (the sky clock's Sun,
  Sun hidden and Earth marks, the forecast panel's height lines (Sun, Earth, Hidden), then the
  globe's site marks: base candidate, past landing, upcoming landing and 3D terrain); the
  scale notes (the diagram and the drawn Earth are not to scale, site heights are 1.5×,
  spots are 500 m apart with north up); then the data and credits, each with a link. This
  is the one place for credits and caveats, so the main screen carries none. Escape, Close
  or a tap on the dimmed page closes it, and focus returns to the "i" button. SOURCES.md
  keeps the full list with licences.
- **View menu:** while no site is focused, the top bar's eye button is "View"
  (`aria-haspopup="menu"`, `aria-expanded`; open shows the brighter outline) and opens a
  small menu under it, right-aligned with it, styled like the pin lists (`--glass-solid`,
  `--edge` outline, 44 px rows): "Default view" (the view on load: the south pole in front,
  the near side up, at the starting zoom, or the Earth & Sun view framed again), "North up"
  (the whole Moon with lunar north at the top, as most Moon maps show it: the same longitude
  as the view, from no more than 30° above or below the equator; camera pose only), "South
  pole" (the same pose, gliding there), "North pole" (the near side down, as in north polar
  maps), "Near side" (longitude 0 in front) and "Far side" (longitude 180 in front), both
  north up. Choosing a row closes the menu and glides there (1.2 s, a jump with reduced
  motion) at the default zoom; in the Earth & Sun view the poses keep that view's distance.
  Escape, a tap outside or the button again closes it; up and down arrows move between the
  rows. It does nothing while the globe dives into or rises out of the site view. A last
  row, "Lat/lon grid" (`menuitemcheckbox`, `aria-checked`; checked shows the pin lists'
  2 px `--sel` inset ring), turns the grid and its readout on and off and leaves the menu open.
- **Lat/lon grid:** latitude circles every 10° and meridians every 30°, just above the
  ground in the Moon's frame, so they turn with it; 1 px `--text` lines at 25%, the equator
  and longitude 0 at 45%, under the pins. Shown in the close view and the Earth & Sun view,
  not in the site view. While it is on, the close view shows a readout in the bottom-left
  corner of the free band (right of the sky clock column where they would meet), or else the
  first clear spot of: bottom right, bottom centre, up from the bottom in 8 px steps (left,
  then right), the band's top left and top right, then along the row just under the top bar.
  "Clear" means off every pin's 44 px hit area (so at least 12 px from a pin's dot) and off
  every control: a 12 px `--glass-solid` chip in `--text` with tabular figures, giving
  the latitude and longitude under the pointer ("84.21° S, 32.10° E", east-positive,
  -180° to 180°), or on touch of the last tapped point; nothing off the Moon. It is read
  back from the same mapping the pins use, so a pin's readout matches its site's
  coordinates. Edge markers keep clear of it.
- **Fly-to:** picking a new site (the switcher, the site picker, the Move chip, its row in
  Compare, its pin or a pin list) glides the
  camera round the Moon until that site faces you, over 1.2 s with an ease in and out, at
  the same distance, so the whole Moon stays framed clear of the text. Zooming in is left
  to the user and to the numbered pins.
  The first site on load doesn't fly, so the page opens on the whole Moon. Tapping a
  numbered pin flies to its group, close enough that the group spans 40% of the narrower
  side of the view, so its outer pins split off; at the closest zoom it opens the list
  instead. A drag stops a flight, the View menu returns to the whole Moon, and with reduced
  motion the camera jumps instead of gliding. When the picked site has a terrain tile, the
  flight ends in the site view (below).
- **Site view (`site.js`):** picking a site that has a terrain tile (any of the ways listed
  under Fly-to) shows the ground around it, so the Sun's grazing light and the shadows of
  nearby hills are visible, not only the call.
  - Flow: one motion from the globe into the ground. The globe turns to the site (1.2 s)
    and dives straight down (0.7 s) until its 5 km ring is the size the site view's ring
    will be. The site view fades in over it from directly overhead, flat and north-up, so
    the two rings lie on top of each other, while the globe fades out (0.4 s) behind ground
    that already runs to the horizon. Then the terrain rises (heights × 0 to × 1.5) while the
    camera tilts to the default 40° (1.4 s, ease-out); the pin, the spots and the "5 km"
    label appear once the terrain is most of the way up. After that the disc turns slowly,
    one turn every 70 s. Stepping to another site with a tile dips to black (0.2 s) while
    the Moon behind turns to the new site behind it, swaps the terrain and rises again. A site without a tile stays on the
    globe, turned to the site; so does the first site on load, so the page opens on the
    whole Moon. Estimates open it the same way for a listed site with a tile; a typed or
    clicked point has none and stays on the globe. Changing the date never changes the view.
  - Leaving: Whole Moon (the zoom-out icon) in the top bar, Escape (when nothing else is
    open) and zooming out past the farthest zoom (25% further in one gesture) all play the
    flow backwards: the terrain flattens and the camera returns overhead (0.7 s) while the
    globe glides back down to the dive pose and fades back in, the site view fades out
    over the matching ground, and the globe rises back to the whole Moon,
    with focus ended.
  - Under the disc, centred above the bottom bar: "5 km ring" and "Spots" (pressed
    buttons, on by default, kept for the session). "5 km ring" hides
    the ring, its label and the globe's ring; "Spots" hides the spot dots, not the pin.
    Neither moves the camera. Then "Horizon" (off by default): it glides the camera down to
    the lowest tilt (12°), facing Earth while it is in view from the site, else the Sun, else
    north, so the skyline and the sky fill the top of the band; pressed again it glides back
    to the default 40°. The turntable holds while it is on; a turn or zoom by the user takes
    over and unpresses it, and "Nearby spots" turns it off.
  - Then the map layers, one 44 px icon button each, in the Layers menu's order: Slope (Tabler
    `angle`), Sunlight (`sun`) and Permanent shadow (`shadow`). They are the menu's switches,
    not copies: Slope and Sunlight turn each other off, Permanent shadow stacks, and a press
    here checks the menu row and the menu's check shows here (`aria-pressed`, outlined in
    `--text` like other pressed buttons). Each name shows in a tooltip above it. Phones (760 px
    and under) hide them and use the top bar's Layers menu, so the short 3D band keeps its height.
  - Every site has one: the 14 polar sites read their tiles in `data/terrain/` (PGDA's 5 m
    maps), the 16 others the Observer view's catalogue tiles (SLDEM2015 or LOLA, the same
    257 × 257, 78 m grid); the far ground near them uses the 16 pixels-per-degree global
    terrain. Nearby spots exist only for the polar sites, so "Spots" shows only there.
  - The disc: real terrain (NASA LRO LOLA maps from PGDA, or SLDEM2015 away from the poles), 9 km round the site, heights
    × 1.5 so the relief reads at this size, in `--regolith`. Its last 1 km fades into the
    far ground under it, so no edge shows.
  - Far ground (`far-ground.js`): from 8 km out to 500 km, past the horizon at every zoom and
    tilt, coarser shipped LOLA terrain on the curved Moon: the 240 m polar grid out to about
    60 km, then 4 pixels per degree, blended over 45 to 60 km, heights × 1.5 like the disc.
    The ground curves away with the Moon, so the skyline is the real limb and the far ground
    has no edge. Same `--regolith` and lights as the disc, without shadows (the shadow map
    covers the disc), so it is lit by its own slopes. Display only; the call never uses it.
    About 4 MB of tiles the first time, shared between nearby sites. If they fail to load,
    the disc shows alone over the dimmed globe as before.
  - Sky: black, with the Sun and Earth in their forecast directions from the site, placed
    far beyond the ground so the skyline hides them. Drawn larger than life so they read on
    a phone (the Sun 1.5° across, the Earth 3°; really about 0.5° and 1.9°), drawn as in every
    3D view (`bodies.js`, below). While the forecast says one is out of view from the site it
    is drawn at 35%, since the camera sits above the site and can see past its skyline. At
    the default 40° tilt the view looks down on the ground; tilting down (a drag up, to 12°)
    brings the skyline and the sky into the band. A 5 km ring is drawn on the ground in `--text` at
    70%, labelled "5 km" on a small `--glass-solid` chip (12 px) under the ring where it
    is nearest the camera, shown only once the site view has faded in. The site is a thin
    `--text` stalk with a dot on top: `--sun`
    while the Sun is in view, `--muted` when it is not.
  - Lighting: the current instant: by default the lit hour, the planned day's first hour
    with the Sun in view (12:00 UTC when it never is), or the hour Autoplay has reached,
    from the forecast's hourly data. The Sun is a strong low light (exposed as for a Sun 6°
    up when it is higher, so ground at sites away from the poles doesn't burn out) with
    soft shadows; Earth adds a faint `--earth` light when it is in view. A faint neutral
    fill from above lights the whole disc at all times, so ground in shadow reads as dark
    grey ground rather than black space; it is decorative, not a lighting result. The planned date
    reads "Wed 16 Dec 2026, 00:00 UTC" in the site view, and the sky clock and height
    strip ring the Sun's point at that hour (1.5 px `--text`; with an Autoplay hour, the
    Sun's and Earth's points). The browser computes no
    positions; it only places the lights along the forecast's directions.
  - The call: the Go / No-go call always comes from the forecast, which uses the full
    horizon. The disc is a picture of the ground near the site: shadows cast by hills
    beyond 9 km are not drawn.
  - Controls: a drag turns the disc (sideways) and tilts it (up and down, 12° to 80°);
    the wheel or a pinch zooms between 0.5 and 1.6 × the default distance. The turntable
    pauses while you drag and for 4 s after. The disc is framed in the free band like the
    globe (left of the open site panel), filling it with a small margin at the default pitch.
  - Mask: the terrain is masked to the free band with a 24 px soft edge, at every zoom and
    framing (on phones the band ends at the sheet's top), so text always sits on black.
  - Hidden: the globe's pins and the Sun and Earth markers hide while the site view is
    shown, and the globe fades out behind the far ground. The enlarged clock, the site picker and Compare on phones hide the site view
    too, like the globe.
  - Credit: About credits the terrain and notes the 1.5× heights.
  - Reduced motion: no dive, lift, fades or turntable; the site view appears at the default
    view and the dim switches at once. Zooming out past the limit still returns to the whole
    Moon, at once.
- **Nearby spots:** in the site view, for sites with a file in `data/grid/` (index.json lists
  them), 25 spots around the site, 500 m apart, stand on the terrain as buttons, so you can
  see how much the call changes a short walk away. Sites without a grid show none. The
  numbers are published: each spot's year percentages, slope and daily Sun and Earth hours
  from the grid file; the Go rule and wording are the bar's.
  - On the ground: each spot is a 44 × 44 px button at its published height (× 1.5, like the
    terrain) with a 14 px dot. The dot's fill runs from `--glass-solid` at 0% of the year in
    sunlight to `--sun` at 100% (`color-mix`), so brighter means more sunlight. Its rim is a
    1.5 px `--glass-solid` ring inside a 1 px `--text` ring, so the dot reads on sunlit ground
    (dark ring) and in shadow (light ring, above 3:1). Spots steeper than 10° carry a
    diagonal `--glass-solid` slash. The selected spot (where the pin stands) is 18 px with a
    2 px `--sel` ring. About keys the colours and the slash.
  - Too close to tap: when any two spots are under 44 px apart on screen (the default framing,
    or zoomed out), the dots shrink to 8 px and take no taps, and a "Nearby spots" button
    (on `--glass-solid`) sits under them, or under the "5 km" chip where it would cover it. It turns the view north up, tilts it to its
    steepest and zooms in until every spot is at least 44 px from the next, then the dots
    grow back to buttons. The turntable then holds until the user turns or zooms, so the
    spots stay still and the arrow keys match the screen.
  - Like the terrain, spots show only inside the free band, whole 44 px buttons, so they never
    cover the bar, the panel or a button; one outside stays a keyboard stop. On a phone the
    nearest row can fall just outside (2 of 25 at Connecting Ridge); a small drag brings it in.
  - Keyboard: the spots are one tab stop (the selected one); arrow keys move the selection,
    north up and east right, and focus follows. Each button's label reads like "500 m east,
    1 km north: sunlight 37% of the year, slope 11°, too steep to land"; the group says
    "Nearby spots, 500 m apart, north up".
  - The pin stands on the selected spot and eases there over 0.3 s; it keeps its size on
    screen at any distance (a 56 px stalk in `--text`, a 12 px `--pin` red head in a 2 px
    `--sel` ring, so it stays clear over any map layer). Picking a spot only moves the pin:
    the camera keeps its zoom, tilt and turn. A tap on the ground within 250 m of a spot
    selects it; the pin can be dragged and snaps to the nearest spot when dropped. With
    reduced motion the pin and camera jump.
  - Readout, last in the site panel after "Official page" and "Observer view" (so the actions
    are never pushed out of view), for the selected spot on the planned day: where it is
    ("500 m east, 1 km north of Connecting Ridge", or the site's name; 600, 14 px); the call
    with the bar's dot and wording ("No-go · Earth hidden all day, needs 8 h"); "Year: Sun
    87%, Earth 50%" (values in `--sun` and `--earth`); "Slope 4°" (13 px, `--muted`), with
    " · too steep to land" in `--text` over 10°. It changes with the day (slider, Autoplay's
    days, the Wait chip) and the spot. "Back to site" (an outlined 44 px button) shows while
    a spot off the site is selected.
  - The site's own spot always shows the site's own forecast, so it matches the bar exactly;
    its year percentages come from the grid. The bar, countdowns, sky clock and heights always
    stay the site's.
  - Hidden with the site view, and while Compare, the enlarged clock or the site picker is
    open.
  - The host owns the selection: changing the site or leaving the site view goes back to the
    site's own spot.
- **Buttons and chips:** transparent with a 1 px `--line` outline, radius 14, 44 px tall,
  text labels. Pressed, expanded or selected states use a `--text` outline (2 px for the
  active filter chip and the selected card's hero). Selected calendar cells and forecast
  range buttons are the exception: `--sel` fill, `--space` text. Today's calendar cell has
  a thin outline when unselected, with no dot.
- **Icons:** Tabler outline icons, 1.5 stroke, inline SVG with `currentColor`, as used in
  the site switcher.

### Observer controls and readouts

Horizon, Sun, Earth, Horizon line and View options sit in the bottom bar. Site selection
uses the Moon navigator; the duplicate catalog and presentation dropdowns are removed. Buttons reuse the
Moon page's unfilled outline control. Native selects use the same outline and corner radius.
Control hit areas are at least 44 px. Hover brightens the outline over 160 ms; keyboard focus
is a 2 px outline with a 3 px offset. Press feedback scales buttons to 0.97 without moving
their layout. Disabled controls use half opacity.

View options enters over 180 ms with an ease-out, 6 px upward settle and opacity from 0.6
to 1. Reduced motion removes this entrance, press scaling and control transitions. The
scene and its controls do not animate continuously on their own.

Sun and Earth readouts use their semantic colors, a Tabler arrow, and tabular mono values
for azimuth and elevation. Arrows remain visible on screen and point toward each body.
Desktop keeps two fixed columns with overflowing status text available in a tooltip;
mobile stacks and wraps the readouts. Supporting words remain in the sans font. Errors remain visible
above the controls. Terrain status, star exposure, display settings and source notes live
in View options. Loading, errors and coarse custom-terrain status stay visible outside it.

### Location globe

A Moon color texture without relief maps provides geographic context, with a white point
outlined in black for the current site. Scroll/+/- zooms; drag/arrow keys orbits; clicking
or Enter/Space requests new coordinates from the host. Whole Moon returns to the main
Moon page at the selected location and time. Keyboard focus uses the shared visible outline.
The host supplies Sun/Earth directions and illumination to one 3D scene, with no orbit
lines. Yellow and blue surface dots mark the Sun-facing and Earth-facing points; the
Moon hides far-side dots and bodies. Their sizes and distances are schematic. If science is unavailable,
body directions are hidden. White 3D rods extend from the actual lunar poles. Hovering
previews coordinates and uses a pointer cursor over selectable locations. Clicking
N/S centers the corresponding pole; E/W centers the ±90° hemispheres without changing
the site. Selection rotates smoothly for 500 ms; dragging interrupts, and reduced motion
skips the transition. The navigator only draws on data, texture or camera changes.
Scientific calculations remain outside the UI. Loading retains the previous accepted
site, terrain and sky together; a failed calculation offers Retry forecast. When the
forecast service is unavailable, one inline message explains that custom locations need
the service and asks the visitor to choose another location on the navigator; selection loading indicators stop.

Both Moon views use an unrestricted camera-space orbit that crosses either pole. The
camera stays where the user placed it while the date changes. A newly accepted site
gets a single 650 ms pin pulse and a brief outlined confirmation inside the scene.
Preparation shows a small spinner beside the actual work label, with no invented
percentage; reduced motion removes the spin and pulse. Prepared custom windows carry
30 exact daily scenes at the selected UTC hour, so Sun/Earth positions and geometric
lighting update together during timeline input without waiting for a network response.

### Lunar overview renderer (integration API)

The Moon occupies about 60% of the shorter viewport dimension at the default zoom.
Portrait framing widens the vertical field of view to keep the Moon inside the screen.
Opening the location globe restores this zoom while facing the current site. A fixed
20 px white ring with a dark backing and central dot highlights its actual projected
position; a nearby Current site label gives its name. Both hide when the site is behind
the Moon. This neutral marker is distinct from the Sun and Earth colors.

The renderer retains this API for integration checks. The Observer page stays in Observer
view and exposes no overview switch or return control.

Except for calendar and forecast range selections, brighten button outlines rather than filling them. Scientific
calculations remain outside the views.

## 6. Share cards and link previews

None yet.

## 7. Voice

- **Plain and specific.** "Sun up 21 h, Earth in view 14 h", not "Excellent conditions".
  The answers say what to do and when: "Wait: Sun 13 Dec, +12 d", "Move: Malapert
  massif", "No site Go on this date". At the end of the data they say where it stops:
  "Not Go by Tue 30 Nov 2027", "No earthset before 1 Dec 2027". The site picker says "Choose a
  site", "Calls for Tue 1 Dec" and "Go on Tue 1 Dec".
- **Everyday words.** "Sunset in", "Earthset in", "30 days", "3 months", "1 year".
- **Say whose needs.** The Go rule is an example mission's: "Go: at least 18 h Sun and 8 h
  Earth a day (example mission)".
- **Avoid:** "seamless", "unlock", "journey", "elevate", "Get started", exclamation marks,
  and emoji in the interface.

- Distinguish synthetic fixtures and illustrative lighting from scientific predictions.

## 8. Accessibility

Most visitors are on phones.

Preserve keyboard focus and reduced-motion behavior in observer controls.

### Tap targets

- Every control has a hit area of at least **44 × 44 px**, with no overlaps.
- Check every control, including the range menu's three rows while it is open.
- Check every state: the default view, Compare open, the sky clock enlarged, the Move
  list open, the site picker (grid and detail), and the 3-month and 1-year ranges (with
  Compare open at each).
- Check that the Sun and Earth edge markers never sit over a control. They take no taps,
  but they must not cover one. The overhead rings are not controls either: their names
  show on hover only, and they sit under the site pins.
- Dragging the globe uses the whole screen outside the controls.
- Rows scrolled out of view inside a list are clipped and take no taps, even where the
  automatic check measures them next to a control below the list.

### Contrast fixes made on 2026-11-14

| Problem | Fix |
|---|---|
| Dark glass over the sunlit Moon gave Earth text 4.5:1 and muted text 4.55:1 | Glass from 68% to 72% opacity: now 5.1:1 and 5.2:1 |
| No-go day marks were about 1.3:1 against the glass, so empty days nearly vanished | Added `--nogo-edge` outline: 3.3:1 (dark, over the Moon), 3.1:1 (light, over space) |
| The "Sample data" tag looked like a button and pushed the top bar to two rows at 320 px | No outline, 32 px tall, smaller text, no wrapping |

### How to check

No text sits on the Moon: the camera frames it clear of the text, and full overlays hide
it. So text is checked against black space, which is exactly what the automatic contrast
check measures. Pin labels and pin lists over the Moon are checked against their
`--glass-solid` backing. Button and chip outlines (`--line`, about 5:1) are checked
against black.

Results (2026-11-14), for the earlier layout with dark scrims behind the text: at the
edge of a text block the scrim was 0.84 black (0.86 × 0.977, as the 16 px blur reaches
two blur radii in), which turned the sunlit Moon into `#232321`. Against that, text
14.4:1, muted 8.7:1, Sun 10.3:1, Earth 8.6:1, and an empty lane's track line 4.3:1. All
passed, with the margin growing further inside each block.

### Latest check

Each change was checked with the design-brief lint, contrast check and tap-target check
at 375 × 812, 1280 × 800 and 1280 × 680 in both themes, with no console errors and no
sideways scroll. The phone sheet run added 320 × 568 and covers the sheet closed and open.

| Change | Text checked | Contrast fails | Controls | Under 44 px | Overlaps |
|---|---|---|---|---|---|
| Sun and Earth lanes (2026-11-14) | 38 at 1280 × 800; 28 at 1280 × 680 and 375 | 0 | 13 | 0 | 0 |
| Site pins (2026-11-14) | 41 at 1280 × 800; 31 at 1280 × 680; 28 at 375 | 0 | 15 on desktop (2 pins shown), 13 at 375 (pins all under the sheet); with a numbered pin's list open at 1280 × 800: 50 text, 23 controls | 0 | 0 |
| Phone sheet (2026-11-14), closed and open | 20 closed and 39 open at 375 × 812; 19 and 39 at 320 × 568; 42 at 1280 × 800; 32 at 1280 × 680 | 0 | 6 closed (2 pins shown), 14 open at phone sizes; 15 on desktop | 0 | 0 |
| Fly-to (2026-11-14) | 20 at 375 × 812 dark after tapping the numbered pin; 41 at 1280 × 800 light after flying to Malapert massif | 0 | 7 and 16 | 0 | 0 |
| Rise, set and visibility read from the data (2026-11-14) | 38 at 1280 × 800; 30 at 1280 × 680; 18 closed and 36 open at 375 × 812; 15 and 36 at 320 × 568 (dark) | 0 | 15 on desktop; 6 closed and 14 open at phone sizes | 0 | 0 |
| Text over space, no panels (2026-11-14), dark only; closed, list open and sky open | 31 and 32 at 1280 × 800; 24, 33 and 30 at 1280 × 680; 20, 30 and 11 at 375 × 812; 17, 30 and 11 at 320 × 568 | 0 | 10 and 17 at 1280 × 800; 11, 18 and 2 at 1280 × 680; 10, 18 and 2 at phone sizes | 0 | 0 |
| Moon first: planning bar, sky clock, Compare (2026-11-14); default, Times, Compare, clock enlarged, Move list | 24, 28, 41, 11, 26 at 1280 × 800 and 1280 × 680; 19, 23, 21, 11, 21 at 375 × 812 and 320 × 568 | 0 | 11–23 per state; none under 44 px except "+1 more" measured 41 px wide only while its own list is open (taps reach its full 73 px) | 0 | 0 real (2 clipped rows in Compare on desktop sit behind the bar; not tappable) |
| Site picker (2026-11-14); grid and detail views, plus all earlier states | picker 49, detail 16 at every size | 0 | picker 24, detail 4; earlier states unchanged | 0 | 0 |
| No backgrounds (2026-11-14): no scrims, outlined controls, no clock disc; all seven states | 24, 28, 41, 11, 26, 49, 16 on desktop; 19–21, 23–25, 21, 11, 21–23, 49, 16 on phones | 0 | 11–24 per state | 0 | 0 real (desktop Compare: 2 clipped rows behind the bar, not tappable; the open "+1 more" list sits over the Wait chip while open) |
| Year forecast and range selector (2026-11-14); all states plus 3 months, 1 year and Compare at 1 year | default 27, Compare 45, 1-year Compare 56 at 1280 wide; 22–24, 25, 36 on phones | 0 | 14–26 per state | 0 | 0 real (rows scrolled out of view in Compare sit behind the controls below the list; clipped, not tappable) |
| 31 sites (2026-11-14); all ten states; picker with three categories, Compare at 1 year with 31 rows, far-side sites | default 27, Compare 65, 1-year Compare 76, picker 164 at 1280 wide; 22–25, 45, 56, 164 on phones | 0 | 14–68 per state | 0 | 0 real (rows scrolled out of view in Compare; the open Move list covers the top bar while open) |
| Sun and Earth on the globe (2026-11-14); all ten states, Tue 1 Dec 2026 and Sat 10 Apr 2027 | default 34, Compare 70, 1-year Compare 81 at 1280 × 800; 28–29, 45, 56 on phones | 0 | 15–68 per state | 0 | 0 real (clipped Compare rows; markers take no taps and keep clear of controls and pins) |
| Fewer marks (2026-11-14): continuous lanes, one line under the call, one label | 38 at 1280 × 800; 30 at 1280 × 680; 18 closed and 36 open at 375 × 812; 15 and 36 at 320 × 568 | 0 | 15 on desktop; 6 closed and 14 open at phone sizes | 0 | 0 |

Lint: 0 errors in `index.html`, `style.css`, `forecast.js`, `globe.js`. Linting all of
`app/` also reports 10 raw-colour and system-font errors inside `app/observer/`, which has
its own styles.

### Observer verification

The observer uses shared typography and semantic tokens, retaining standalone token
fallbacks in its stylesheet. The observer refresh was checked at desktop, 375 px and
320 px widths, including settings disclosure, keyboard dismissal and presentation
switching; its browser verification suite passed without JavaScript errors.

The timeline uses one date-and-time button. The calendar and two scrollbar-free,
24-hour UTC wheels (hours 00-23, minutes 00-59) share one popup. Day and time changes
remain drafts until Confirm; dismissal discards them. Today selects the UTC date.

Travel uses a compact 300–340 px desktop sidebar and a separate 196–208 px filter
disclosure. The filters end above the planning bar. While Travel is open, the existing
forecast keeps every row in a 158 px table; closing Travel restores its normal spacing.
Phone controls retain touch targets and the existing sheet pattern. Estimate and mixed
source labels remain visible on results; detailed metrics stay in the information tooltip.
Candidate counts report the bounded search's progress and any shortfall explicitly.

The Moon View menu places Stars beside Lat/lon grid. Stars start on, with the same fixed
Hipparcos catalog as Observer; users can toggle them off. Both views use individual stars
with a 15% display brightness boost and no Milky Way background. The host supplies
the selected time's sky orientation; the renderer composes it with the Moon model rotation.
The background follows the camera without parallax, and missing orientation hides it.
