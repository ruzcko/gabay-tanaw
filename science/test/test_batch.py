"""Batch transport must preserve sampling, cache identity and provenance coverage.

Offline tests use a real Horizons response; no requests are sent to NASA.
"""
import gzip
import json
import sys
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fetch_ephemeris import MAX_BATCH_SAMPLES, batch_windows, check_cache_layout, main, query
from validate_data import validate_source_coverage
from test_forecast import RAW, SITE, HORIZON


class BatchTests(unittest.TestCase):
    def test_publication_keeps_1972_floor_when_browser_range_expands(self):
        for year in (1969, 1970, 1971):
            with self.assertRaisesRegex(ValueError, 'Unsupported time window'):
                query('sun', SITE, HORIZON, date(year, 1, 1), date(year, 1, 2))
        with patch('fetch_ephemeris.request_text', return_value=RAW) as request, patch('fetch_ephemeris.validate_response'):
            query('sun', SITE, HORIZON, date(1972, 1, 1), date(1972, 1, 2))
            self.assertEqual(request.call_args.args[0]['START_TIME'], '1972-01-01 00:00')

    def test_bounded_year_and_leap_day_at_both_cadences(self):
        # Include endpoint rows in the resource bound. A one-minute year must
        # split into more requests, never silently reduce its resolution.
        for start in (date(2026, 12, 1), date(2028, 1, 1)):
            for step in (1, 10):
                stop = start + timedelta(days=366)
                windows = batch_windows(start, stop, step)
                self.assertEqual(windows[0][1], start)
                self.assertEqual(windows[-1][2], stop)
                for index, (label, a, b) in enumerate(windows):
                    self.assertLessEqual((b-a).days * 1440 // step + 1, MAX_BATCH_SAMPLES)
                    self.assertEqual(label, f"{a}_{b}")
                    if index:
                        self.assertEqual(windows[index-1][2], a)
                self.assertEqual(len(windows), 1 if step == 10 else 9)
        for step in (0, 5, 60):
            with self.assertRaises(ValueError):
                batch_windows(date(2026, 1, 1), date(2027, 1, 1), step)

    def test_layout_cannot_mix_monthly_batch_or_unrelated_windows(self):
        windows = batch_windows(date(2026, 12, 1), date(2027, 1, 1), 10)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            monthly = root / "sun-2026-12.txt.gz"
            monthly.touch()
            with self.assertRaises(ValueError): check_cache_layout(root, windows, True)
            monthly.unlink()
            (root / "sun-2026-12-01_2027-01-01.txt.gz").touch()
            check_cache_layout(root, windows, True)  # Partial download can resume.
            with self.assertRaises(ValueError): check_cache_layout(root, windows, False)
            other = batch_windows(date(2026, 12, 1), date(2027, 2, 1), 10)
            with self.assertRaises(ValueError): check_cache_layout(root, other, True)

    def test_fetch_cache_hit_and_stale_height(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sites, horizons, cache = root/"sites.json", root/"horizons", root/"cache"
            horizons.mkdir()
            sites.write_text(json.dumps([SITE]))
            terrain = horizons/f"{SITE['id']}.json"
            terrain.write_text(json.dumps(HORIZON))
            argv = ["fetch_ephemeris.py", str(sites), str(cache), "2026-12-01", "31",
                    "--horizons", str(horizons), "--batch"]
            with patch.object(sys, "argv", argv), patch.dict("fetch_ephemeris.BODIES", {"earth": "399"}, clear=True):
                with patch("fetch_ephemeris.request_text", return_value=RAW) as request, patch("fetch_ephemeris.time.sleep") as pause:
                    main()
                    request.assert_called_once()
                    pause.assert_not_called()  # No courtesy pause after the last request.
                    self.assertEqual(request.call_args.args[0]["STEP_SIZE"], "10m")
                path = cache/SITE["id"]/"earth-2026-12-01_2027-01-01.txt.gz"
                with gzip.open(path, "rt") as stream:
                    self.assertEqual(stream.read(), RAW)  # Headers/warnings are never rewritten.
                with patch("fetch_ephemeris.request_text", side_effect=AssertionError("Unexpected network")):
                    main()  # Valid cached response needs zero requests.
                terrain.write_text(json.dumps({**HORIZON, "observerHeight": 20}))
                with patch("fetch_ephemeris.request_text", return_value=RAW) as request:
                    with self.assertRaisesRegex(ValueError, "Observer location mismatch"):
                        main()
                    request.assert_called_once()  # Stale height was not accepted.

    def test_source_coverage_uses_actual_windows_not_file_count(self):
        start = datetime(2026, 12, 1, tzinfo=timezone.utc)
        end = datetime(2027, 1, 1, tzinfo=timezone.utc)
        header = RAW.split("$$SOE")[0]
        sources = [{"file": "earth-2026-12-01_2027-01-01.txt.gz", "header": header},
                   {"file": "sun-2026-12-01_2027-01-01.txt.gz",
                    "header": header.replace("Target body name: Earth (399)", "Target body name: Sun (10)")}]
        validate_source_coverage(sources, start, end, 10)
        # Bodies can use different valid chunk boundaries. Count alone cannot
        # establish coverage; verify that a non-calendar seam joins exactly.
        split = [sources[0],
                 {"file": "sun-2026-12-01_2026-12-16.txt.gz",
                  "header": sources[1]["header"].replace("2027-Jan-01 00:00", "2026-Dec-16 00:00")},
                 {"file": "sun-2026-12-16_2027-01-01.txt.gz",
                  "header": sources[1]["header"].replace("2026-Dec-01 00:00", "2026-Dec-16 00:00")}]
        validate_source_coverage(split, start, end, 10)
        overlap = [*split[:2], {**split[2], "header": split[2]["header"].replace("2026-Dec-16 00:00", "2026-Dec-15 00:00")}]
        with self.assertRaises(ValueError): validate_source_coverage(overlap, start, end, 10)
        for broken in (sources[:1], sources + sources[:1],
                       [sources[0], {**sources[1], "header": header}],
                       [sources[0], {**sources[1], "header": sources[1]["header"].replace("2026-Dec-01 00:00", "2026-Dec-02 00:00")}],
                       [sources[0], {**sources[1], "header": sources[1]["header"].replace("2027-Jan-01 00:00", "2027-Jan-02 00:00")}]):
            with self.assertRaises(ValueError): validate_source_coverage(broken, start, end, 10)
        with self.assertRaises(ValueError): validate_source_coverage(sources, start, end, 1)


if __name__ == "__main__":
    unittest.main()
