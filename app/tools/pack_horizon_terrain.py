"""Losslessly repack the pinned LOLA polar tiles for browser horizon downloads.

Run: python app/tools/pack_horizon_terrain.py
Standard library only. Heights, grid registration and scientific sampling stay intact.
"""
import array
import gzip
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1] / 'assets/observer/terrain'
SOURCE_HASH = 'dc16bba853b22fa29e26dc26b411acc180de70478578b2c75c8e6f253f56a9d9'


def pack(raw, side):
    values = array.array('H', raw)
    if sys.byteorder != 'little':
        values.byteswap()
    count = len(values)
    encoded = bytearray(count * 2)
    for i, value in enumerate(values):
        delta = (value - (values[i - 1] if i % side else 0)) & 65535
        encoded[i] = delta & 255
        encoded[count + i] = delta >> 8
    return gzip.compress(encoded, compresslevel=9, mtime=0)


def main():
    source = ROOT / 'polar20'
    manifest = json.loads((source / 'manifest.json').read_text())
    assert manifest['sourceSha256'] == SOURCE_HASH
    assert manifest['width'] == 7584 and manifest['tileSize'] == 512
    width, side = manifest['width'], manifest['tileSize']
    # Reconstruct the unpadded source to verify provenance before writing assets.
    original = bytearray(width * width * 2)
    # Exact maxima of 64x64 source pixels, including padded edge blocks.
    bounds = array.array('h', [-32768]) * (120 * 120)
    for path in sorted(source.glob('*.bin.gz')):
        row, col = map(int, path.name.split('.')[0].split('-'))
        raw = gzip.decompress(path.read_bytes())
        assert len(raw) == side * side * 2
        heights = array.array('h', raw)
        if sys.byteorder != 'little':
            heights.byteswap()
        for by in range(8):
            for bx in range(8):
                bounds[(row * 8 + by) * 120 + col * 8 + bx] = max(
                    max(heights[y * side + bx * 64:y * side + (bx + 1) * 64])
                    for y in range(by * 64, (by + 1) * 64))
        count = min(side, width - col * side) * 2
        for y in range(min(side, width - row * side)):
            offset = ((row * side + y) * width + col * side) * 2
            original[offset:offset + count] = raw[y * side * 2:y * side * 2 + count]
    assert hashlib.sha256(original).hexdigest() == SOURCE_HASH, 'Unpadded tiles differ from the pinned NASA source'
    del original
    if sys.byteorder != 'little':
        bounds.byteswap()
    bound_bytes = bounds.tobytes()
    (ROOT / 'polar20-bounds-v1.bin').write_bytes(bound_bytes)
    print(f'Exact height bounds: {len(bound_bytes):,} bytes, SHA-256 {hashlib.sha256(bound_bytes).hexdigest()}')
    if '--bounds-only' in sys.argv:
        return
    target = ROOT / 'polar20-delta-v1'
    target.mkdir(parents=True, exist_ok=True)
    entries, before, after = {}, 0, 0
    for path in sorted(source.glob('*.bin.gz')):
        source_bytes = path.read_bytes()
        raw = gzip.decompress(source_bytes)
        packed = pack(raw, side)
        (target / path.name).write_bytes(packed)
        entries[path.name] = dict(bytes=len(packed), decodedSha256=hashlib.sha256(raw).hexdigest())
        before += len(source_bytes)
        after += len(packed)
    manifest.update(encoding='row-delta16-byteplanes-gzip-v1', decodedEncoding='int16-le', files=entries)
    (target / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'{len(entries)} lossless tiles: {before:,} -> {after:,} bytes ({100 * (1 - after / before):.1f}% smaller)')


if __name__ == '__main__':
    main()
