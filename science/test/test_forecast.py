"""Regression checks for scientific assumptions, monthly joins and event timing.

Run: python -m unittest discover -s science/test -v
The real Horizons fixture is offline; these tests never call the network.
"""
import gzip
import json
import math
import sys
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fetch_ephemeris import observer_altitude_km, validate_response, cached_for, months, query, COVERAGE_START, COVERAGE_END, parse_columns, parse_stamp
from build_forecast import cadence, mask_at, read_columns, read_chunks, up_intervals, events, build
from check_sun import sun_from_subpoint

FIXTURES=Path(__file__).parent/"fixtures"
SITE=json.loads((FIXTURES/"apollo-11.json").read_text())
with gzip.open(FIXTURES/"apollo-11-earth-2026-12.txt.gz","rt") as f:
    RAW=f.read()
HORIZON={"id":SITE["id"],"lat":SITE["lat"],"lon":SITE["lon"],
         "referenceFrame":"MOON_ME_DE421","datum":"sphere-1737400m",
         "surfaceElevation":0,"observerHeight":2,"terrain":"smooth"}
T0=datetime(2026,12,1,tzinfo=timezone.utc)


class ForecastTests(unittest.TestCase):
    def test_requests_outside_manifest_never_reach_horizons(self):
        with patch('fetch_ephemeris.request_text') as fetch:
            for start in (COVERAGE_START.date() - timedelta(days=1), COVERAGE_END.date()):
                with self.assertRaisesRegex(ValueError, 'Unsupported time window'):
                    query('sun', SITE, HORIZON, start, start + timedelta(days=1))
            fetch.assert_not_called()

    def test_subsolar_geometry_known_cardinal_values(self):
        # At the subsolar point the Sun is overhead; a quarter-turn east lies
        # on the east horizon, and the antipode sees the Sun straight below.
        site = {"lat": 0, "lon": 0}
        self.assertAlmostEqual(sun_from_subpoint(site, 0, 0)[1], 90)
        self.assertEqual(sun_from_subpoint(site, 90, 0), (90, 0))
        self.assertAlmostEqual(sun_from_subpoint(site, 180, 0)[1], -90)

    def test_real_month_and_header_provenance(self):
        t,a,e,r,d=validate_response(RAW,"earth",SITE,HORIZON,date(2026,12,1),date(2027,1,1),observer=True)
        self.assertEqual(len(t),31*144+1)
        self.assertTrue(350000<r[0]<410000 and 1<d[0]<3)
        self.assertIn("EOP coverage",RAW)

    def test_validated_columns_keep_raw_units_and_unused_columns(self):
        # The builder consumes these exact validated samples, including range-rate
        # for seam checks. Diameter must remain in arcseconds until output rounding.
        parsed = validate_response(RAW,"earth",SITE,HORIZON,return_columns=True)
        self.assertEqual(parsed, read_columns(FIXTURES/"apollo-11-earth-2026-12.txt.gz"))
        times, _, _, ranges, diameters = validate_response(RAW,"earth",SITE,HORIZON,observer=True)
        self.assertEqual(parsed[0], times)
        self.assertEqual(parsed[1]["delta"], ranges)
        self.assertEqual([d/3600 for d in parsed[1]["Ang-diam"]], diameters)
        self.assertIn("deldot", parsed[1])

    def test_unconsumed_numeric_columns_cannot_hide_corruption(self):
        # A speedup must retain the old second parser's checks, even for columns
        # not drawn by the app. Duplicate names or nonfinite range-rate fail closed.
        head, rest = RAW.split("$$SOE")
        table, tail = rest.split("$$EOE")
        lines = table.strip().splitlines()
        names = next(s for s in head.splitlines() if s.strip().startswith("Date__(UT)__HR:MN,"))
        index = [s.strip() for s in names.split(",")].index("deldot")
        row = lines[0].split(",")
        row[index] = "nan"
        lines[0] = ",".join(row)
        broken = head + "$$SOE\n" + "\n".join(lines) + "\n$$EOE" + tail
        for text in (broken, RAW.replace("deldot", "delta")):
            with self.assertRaises(ValueError):
                validate_response(text,"earth",SITE,HORIZON,return_columns=True)

    def test_reject_changed_models_units_and_location(self):
        # Each mutation isolates an upstream assumption; accepting IAU is not a harmless label change.
        for old,new in [("MEAN_ME (high precision)","IAU_MOON"),("API VERSION: 1.2","API VERSION: 9.9"),
                        ("1737.4, 1737.4, 1737.4","1738.4, 1738.4, 1738.4"),
                        ("Units: ARCSECONDS","Units: DEGREES"),("EOP coverage","removed coverage")]:
            with self.subTest(old=old):
                self.assertIn(old,RAW)
                with self.assertRaises(ValueError): validate_response(RAW.replace(old,new),"earth",SITE,HORIZON)
        with self.assertRaises(ValueError): validate_response(RAW,"earth",SITE,{**HORIZON,"observerHeight":20})
        with self.assertRaises(ValueError): validate_response(RAW,"sun",SITE,HORIZON)

    def test_height_and_unverified_frames(self):
        self.assertEqual(observer_altitude_km(SITE,HORIZON),0.002)
        self.assertEqual(observer_altitude_km(SITE,{**HORIZON,"terrain":"LOLA","surfaceElevation":5000}),5.002)
        with self.assertRaises(ValueError): observer_altitude_km(SITE,{**HORIZON,"surfaceElevation":5000})
        with self.assertRaises(ValueError): observer_altitude_km({**SITE,"referenceFrame":"unverified"},HORIZON)

    def test_stale_window_or_cadence_is_not_cached(self):
        self.assertFalse(cached_for(RAW,"earth",SITE,HORIZON,date(2026,12,1),date(2027,1,1),1))
        self.assertFalse(cached_for(RAW,"earth",SITE,HORIZON,date(2026,12,2),date(2027,1,1)))

    def test_months_cross_year_and_leap_day(self):
        chunks=months(date(2027,12,15),date(2028,3,1))
        self.assertEqual([x[0] for x in chunks],["2027-12","2028-01","2028-02"])
        self.assertEqual((chunks[-1][2]-chunks[-1][1]).days,29)

    def test_monthly_seam_values_and_gaps(self):
        t=[T0+timedelta(minutes=10*k) for k in range(3)]
        with patch('build_forecast.read_columns',side_effect=[(t[:2],{'x':[1,2]}),(t[1:],{'x':[2,3]})]):
            self.assertEqual(read_chunks(['a','b']),(t,{'x':[1,2,3]}))
        for second in [(t[1:],{'x':[9,3]}),(t[1:],{'y':[2,3]}),
                       ([t[2],t[2]+timedelta(minutes=10)],{'x':[3,4]})]:
            with patch('build_forecast.read_columns',side_effect=[(t[:2],{'x':[1,2]}),second]):
                with self.assertRaises(ValueError): read_chunks(['a','b'])

    def test_missing_duplicate_and_reversed_samples(self):
        for minutes in ([0,10,30],[0,10,10],[10,0],[]):
            with self.assertRaises(ValueError): cadence([T0+timedelta(minutes=x) for x in minutes])

    def test_parsed_rows_must_print_their_expected_instant(self):
        head,rest=RAW.split("$$SOE"); body,tail=rest.split("$$EOE")
        rows=body.strip().splitlines()
        times,_=parse_columns(RAW,10)
        self.assertEqual(times,[parse_stamp(r.split(",")[0].strip()) for r in rows])
        stamp=lambda r:r.split(",")[0]
        for broken in (rows[:3]+rows[4:], rows[:3]+[rows[2]]+rows[3:], [rows[1],rows[0]]+rows[2:],
                       [rows[0],rows[1].replace(stamp(rows[1]),stamp(rows[1]).replace("Dec","Jan"))]+rows[2:]):
            with self.assertRaises(ValueError):
                parse_columns(head+"$$SOE\n"+"\n".join(broken)+"\n$$EOE"+tail,10)

    def test_interpolate_actual_time_not_fixed_ten_minutes(self):
        # A one-minute bracket has its crossing at 15 seconds; old STEP gave 150 seconds.
        times=[T0,T0+timedelta(minutes=1)]
        self.assertEqual(up_intervals(times,[-1,3]),[(T0+timedelta(seconds=15),times[-1])])
        self.assertEqual(events(up_intervals(times,[1,1]),times[0],times[-1]),[])

    def test_tangent_is_down_and_no_fake_boundary_event(self):
        times=[T0+timedelta(minutes=i) for i in range(3)]
        self.assertEqual(up_intervals(times,[-1,0,-1]),[])
        self.assertEqual(events(up_intervals(times,[1,1,1]),times[0],times[-1]),[])

    def test_cyclic_quarter_degree_skyline(self):
        mask=[0.0]*1440; mask[-1]=4
        self.assertEqual(mask_at(mask,359.875),2)
        self.assertEqual(mask_at(mask,-0.125),2)
        self.assertEqual(mask_at(mask,720),0)

    def test_missing_horizon_fails_closed(self):
        missing=FIXTURES/"missing-horizons"
        with self.assertRaises(FileNotFoundError): build(SITE,missing,missing)

    def test_sinusoid_resolution_is_not_a_universal_guarantee(self):
        # A narrow visibility window between samples is undetectable by endpoint interpolation.
        self.assertEqual(up_intervals([T0,T0+timedelta(minutes=10)],[-1,-1]),[])
        dense=[T0+timedelta(minutes=k) for k in range(11)]
        clearance=[1-((k-5)/1.1)**2 for k in range(11)]
        self.assertEqual(len(up_intervals(dense,clearance)),1)


if __name__=='__main__': unittest.main()
