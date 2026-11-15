"""Long-term average sunlight at a site, from its horizon.

The Sun's latitude as seen from the Moon swings +-1.54 degrees over 346.6 days
while it circles the sky once a synodic month. The two periods don't line up, so
over the 18.6-year cycle every (latitude, hour angle) pair is visited evenly, and
averaging over that grid gives the long-term mean. The Sun is a disc of radius
0.2666 degrees cut horizontally at the horizon, as in Mazarico et al. (2011),
without limb darkening.
"""
import numpy as np

TILT = 1.543          # lunar equator vs ecliptic, degrees
SUN_R = 0.2666        # Sun's angular radius at 1 au, degrees


def sun_directions():
    """Unit vectors to the Sun (Moon-fixed), evenly covering the long-term cycle."""
    lat = np.radians(TILT * np.sin(np.radians(np.arange(0, 360, 2.0))))[:, None]
    lon = np.radians(np.arange(0, 360, 0.25))[None, :]
    v = np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon),
                  np.sin(lat) + 0 * lon], -1)
    return v.reshape(-1, 3)


def sun_in_sky(lat, lon, sun):
    """Sun azimuth (0 = north, clockwise) and elevation, degrees, at a site."""
    p, l = np.radians(lat), np.radians(lon)
    up = np.array([np.cos(p) * np.cos(l), np.cos(p) * np.sin(l), np.sin(p)])
    east = np.array([-np.sin(l), np.cos(l), 0])
    north = np.cross(up, east)
    az = np.degrees(np.arctan2(sun @ east, sun @ north)) % 360
    return az, np.degrees(np.arcsin(sun @ up))


def disc_fraction(sun_elev, horizon_elev):
    """Visible fraction of the Sun's disc cut by a horizontal line."""
    d = np.clip((sun_elev - horizon_elev) / SUN_R, -1, 1)
    return 0.5 + (d * np.sqrt(1 - d * d) + np.arcsin(d)) / np.pi


def illumination(elevations, lat, lon, sun):
    """(mean visible disc fraction, fraction of time any part of the Sun is up)."""
    az, el = sun_in_sky(lat, lon, sun)
    step = 360 / len(elevations)
    h = np.interp(az, np.arange(len(elevations)) * step, elevations, period=360)
    f = disc_fraction(el, h)
    return f.mean(), (f > 0).mean()
