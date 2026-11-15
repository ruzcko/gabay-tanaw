"""Convert LROC images into small site photos.

Usage: python -I make_site_images.py <images_dir> <out_dir>
Reads the images named in SITES from <images_dir>: NAC_ROI region mosaic browse PNGs, and
LROC featured images in its featured/ folder. Writes one grayscale WebP per site, at most
960 px wide and tall, under MAX_BYTES.
"""
import io
import sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
SIZE = 960
MAX_BYTES = 200_000

# Output file (site id) -> source image.
SITES = {
    "peak-near-cabeus-b": "NAC_ROI_CABEUSPKLO1_P836S2912.BROWSE.PNG",
    "haworth": "NAC_ROI_HAWORTH_LO1_P867S3363.BROWSE.PNG",
    "malapert-massif": "NAC_ROI_MALAPERTLO1_P860S0003.BROWSE.PNG",
    "mons-mouton-plateau": "NAC_ROI_MOUTNPLTLO1_P843S0306.BROWSE.PNG",
    "mons-mouton": "NAC_ROI_MTMOUTONLO1_P854S0353.BROWSE.PNG",
    "leibnitz-beta-plateau": "NAC_ROI_MTMOUTONLO1_P854S0353.BROWSE.PNG",
    "nobile-rim-1": "NAC_ROI_MTMOUTONLO1_P854S0353.BROWSE.PNG",
    "nobile-rim-2": "NAC_ROI_NOBILE02LO1_P839S0587.BROWSE.PNG",
    "de-gerlache-rim": "NAC_ROI_DEGERRIMLO1_P885S2933.BROWSE.PNG",
    # LROC featured images (lroc.im-ldi.com/images/<n>), in <images_dir>/featured/
    "apollo-11": "featured/2xenlarge.png",  # 22
    "apollo-12": "featured/M175428601RE_25cm_AP12_area.png",  # 401
    "apollo-14": "featured/M150633128LR_close.png",  # 285
    "apollo-15": "featured/a15_tracks.png",  # 491
    "apollo-16": "featured/M116215423ME.bwmos.png",  # 199
    "apollo-17": "featured/ap17_1st50km_4release.png",  # 72
    "luna-24": "featured/luna23_24_regional.png",  # 461
    "change-3": "featured/chang_e3_FI_opening.png",  # 637
    "change-4": "featured/content_NAC_DTM_Change4_eq_disc_CLRSHADE_1100p_Crop.png",  # 1100
    "change-5": "featured/content_CE5_1100p_Image_version2.png",  # 1172
    "change-6": "featured/content_CE6_FI_Header_425mmpp.png",  # 1374
    "chandrayaan-3": "featured/content_M1447750764_LRmos.warp.1100px1100p.clean.png",  # 1314
    "slim": "featured/content_ALIGN_aligned_M1460739214L.1100x1100.png",  # 1358
    "im1-malapert-a": "featured/content_Nova_C_no_arrow_1100x1100_crop.png",  # 1360
    "im2-mons-mouton": "featured/content_M1495922531_LRmos.warp.str01_str02.3xdecimated.1300p.png",  # 1408
    "blue-ghost-1": "featured/content_M1495619099LR_mos.str01.320cm.1300p.png",  # 1407
    "im3-reiner-gamma": "featured/content_ReinerGamma.jpg",  # 1195
    "blue-ghost-3": "featured/content_NAC_ROI_GRUITHSNLOB_E362N3197_20M_Recrop.png",  # 1133
    "connecting-ridge": "featured/content_M1348682369_LRmos.warp.str01.shrunk6x.1100x1100.png",  # 1247
    "connecting-ridge-extension": "featured/content_M1348682369_LRmos.warp.str01.shrunk6x.1100x1100.png",  # 1247
    "shackleton-rim": "featured/content_M1348682369_LRmos.warp.str01.shrunk6x.1100x1100.png",  # 1247
    "peak-near-shackleton": "featured/shack_spole_v2.png",  # 98
}

for name, png in SITES.items():
    im = Image.open(f"{src}/{png}").convert("L")
    im.thumbnail((SIZE, SIZE), Image.LANCZOS)
    for q in range(85, 20, -5):
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=q, method=6)
        if buf.tell() < MAX_BYTES:
            break
    with open(f"{out}/{name}.webp", "wb") as f:
        f.write(buf.getvalue())
    print(f"{name}.webp {im.width}x{im.height} q{q} {buf.tell() // 1024} KB")
