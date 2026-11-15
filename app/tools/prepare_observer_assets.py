"""Offline asset preparation, Python standard library only. No application build step.
Usage: python app/tools/prepare_observer_assets.py .terrain-raw app/assets/observer
Inputs: NASA ldem_16_uint.tif and HEASARC hipparcos.xml (VOTable). See app/SOURCES.md.
"""
import array, base64, gzip, hashlib, json, math, pathlib, struct, sys, xml.etree.ElementTree as ET

raw, out = map(pathlib.Path, sys.argv[1:3])
out.mkdir(parents=True, exist_ok=True)
data = (raw / 'ldem_16_uint.tif').read_bytes()
endian = '<' if data[:2] == b'II' else '>'
assert struct.unpack_from(endian+'H', data, 2)[0] == 42, 'Expected classic TIFF'
offset = struct.unpack_from(endian+'I', data, 4)[0]
tags = {}
for i in range(struct.unpack_from(endian+'H', data, offset)[0]):
    entry = offset+2+i*12
    tag, kind, count, value = struct.unpack_from(endian+'HHII', data, entry)
    if kind not in (3,4): continue
    size, code = (2,'H') if kind == 3 else (4,'I')
    tags[tag] = struct.unpack_from(endian+str(count)+code, data, entry+8 if size*count <= 4 else value)
width, height = tags[256][0], tags[257][0]
assert (width,height) == (5760,2880) and tags[258] == (16,) and tags[259] == (1,), 'Expected uncompressed 16-bit LOLA TIFF'
assert tags.get(277,(1,)) == (1,), 'Expected one sample per pixel'
pixels = array.array('H')
for start, length in zip(tags[273], tags[279]): pixels.frombytes(data[start:start+length])
if (endian == '<') != (sys.byteorder == 'little'): pixels.byteswap()
assert len(pixels) == width*height
total = 0
for ppm in (4,16):
    folder=out/'terrain'/str(ppm); folder.mkdir(parents=True,exist_ok=True)
    side=10*ppm; stride=16//ppm; w=360*ppm; h=180*ppm
    if stride == 1: level=pixels
    else:
        level=array.array('H', (round(sum(pixels[(y*stride+dy)*width+x*stride+dx] for dy in range(stride) for dx in range(stride))/(stride*stride)) for y in range(h) for x in range(w)))
    for row in range(18):
        for col in range(36):
            tile=array.array('H')
            for y in range(side): tile.extend(level[(row*side+y)*w+col*side:(row*side+y)*w+(col+1)*side])
            if sys.byteorder != 'little': tile.byteswap()
            encoded=gzip.compress(tile.tobytes(),mtime=0)
            (folder/f'{row}-{col}.bin.gz').write_bytes(encoded); total+=len(encoded)
manifest={'source':'https://svs.gsfc.nasa.gov/4720/', 'license':'NASA media, free to use with attribution', 'referenceFrame':'LOLA-ME', 'elevationDatum':'sphere-1737400m', 'radiusM':1737400, 'levels':[4,16], 'tileDegrees':10, 'encoding':'gzip uint16 little-endian; metres = value / 2 - 10000', 'sourceSha256':hashlib.sha256(data).hexdigest(), 'compressedBytes':total}
(out/'terrain/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
stars=[]
catalog=ET.parse(raw/'hipparcos.xml')
for row in catalog.findall('.//{*}TR'):
    values=[cell.text for cell in row]
    stars.append([int(values[0]),float(values[1]),float(values[2]),float(values[3])])
stream=catalog.find('.//{*}BINARY/{*}STREAM')
if stream is not None:
    binary=base64.b64decode(stream.text); offset=0
    while offset<len(binary):
        hip=struct.unpack_from('>i',binary,offset)[0]; offset+=4; coords=[]
        for _ in range(2):
            size=struct.unpack_from('>i',binary,offset)[0]; offset+=4
            coords.append(float(binary[offset:offset+size] or 'nan')); offset+=size
        mag=struct.unpack_from('>d',binary,offset)[0];offset+=8
        if all(math.isfinite(value) for value in [*coords,mag]): stars.append([hip,*coords,mag])
assert len(stars)>100, 'Expected a valid bright-star table'
(out/'stars.json').write_text(json.dumps({'frame':'ICRS-J1991.25', 'source':'ESA Hipparcos / CDS I/239 / NASA HEASARC', 'license':'NASA Open Data government-works metadata', 'columns':['hip','raDeg','decDeg','magnitude'], 'stars':stars},separators=(',',':'))+'\n')
print(json.dumps({'terrainCompressedBytes':total,'stars':len(stars),'terrainTiles':1296}))
