"""The terrain downloader must reject bytes for another region, even at the right length."""
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fetch_terrain as terrain


class TerrainDownloadTests(unittest.TestCase):
    def response(self, body, content_range, status=206, content_type="application/octet-stream"):
        response = Mock(status=status)
        response.read.return_value = body
        response.getheader.side_effect = lambda key, default="": {
            "Content-Range": content_range, "Content-Type": content_type}.get(key, default)
        conn = Mock()
        conn.getresponse.return_value = response
        return conn, response

    def test_single_range_exact_location_and_size(self):
        total = terrain.ROWS * terrain.ROW_BYTES
        conn, _ = self.response(b"1234", f"bytes 4-7/{total}")
        self.assertEqual(terrain.fetch(conn, "/", [(4, 7)])[0], {4: b"1234"})
        for header, body in [(f"bytes 8-11/{total}", b"1234"),
                             ("bytes 4-7/12", b"1234"),
                             (f"bytes 4-7/{total}", b"123")]:
            conn, _ = self.response(body, header)
            with self.assertRaises(ValueError):
                terrain.fetch(conn, "/", [(4, 7)])

    def test_ignored_range_rejected_before_reading_large_product(self):
        conn, response = self.response(b"", "", status=200)
        with self.assertRaises(RuntimeError):
            terrain.fetch(conn, "/", [(0, 3)])
        response.read.assert_not_called()

    def test_multipart_missing_duplicate_or_wrong_range(self):
        total = terrain.ROWS * terrain.ROW_BYTES
        def part(start):
            return f"--test\r\nContent-Range: bytes {start}-{start+3}/{total}\r\n\r\n".encode() + b"1234\r\n"
        for starts in [(0, 8), (0,), (0, 0), (0, 12)]:
            body = b"".join(part(k) for k in starts) + b"--test--\r\n"
            conn, _ = self.response(body, "", content_type="multipart/byteranges; boundary=test")
            if starts == (0, 8):
                self.assertEqual(set(terrain.fetch(conn, "/", [(0, 3), (8, 11)])[0]), {0, 8})
            else:
                with self.assertRaises(ValueError):
                    terrain.fetch(conn, "/", [(0, 3), (8, 11)])

    def test_seam_ranges_preserve_eastward_pixel_order(self):
        # Last pixel of row 2, then its first two pixels, without reading row 3.
        n = terrain.ROW_BYTES
        self.assertEqual(terrain.row_ranges(2, -1, 1), [(3*n-4, 3*n-1), (2*n, 2*n+7)])


if __name__ == "__main__":
    unittest.main()
