"""Georeference the Google Earth frames and cut them into web-map tiles (one PMTiles archive per frame).

Each frame image has its KML rectangle (magenta, 4 px) burned in. We detect the rectangle's pixel
position, map it linearly to the rectangle's lon/lat edges from the KML (top-down view, square pixels),
clip the image to just inside the rectangle and render Web-Mercator tiles from it.

Outputs:
  data/processed/tiles/frame_<X>.pmtiles   WebP tiles with transparency outside the frame
  data/processed/imagery.json              georeference, resolution and zoom range per frame
"""
import io
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "frames"
OUT = ROOT / "data" / "processed"
TILES = OUT / "tiles"
TILES.mkdir(parents=True, exist_ok=True)

INSET = 7          # px kept away from the magenta line when clipping
WEBP_QUALITY = 82
M_PER_DEG_LAT = 110_600.0
COS_LAT = math.cos(math.radians(16.92))
# Lower zooms come from Frame A only; sharper frames start where they add detail.
MIN_ZOOM = {"A": 11, "B": 15, "C": 15, "D": 16}


def clusters(idx):
    """Split sorted indices into runs of consecutive values."""
    runs, cur = [], [idx[0]]
    for v in idx[1:]:
        if v - cur[-1] <= 2:
            cur.append(v)
        else:
            runs.append(cur)
            cur = [v]
    runs.append(cur)
    return runs


def detect_rectangle(rgb):
    a = rgb.astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = ((r - g) > 50) & ((b - g) > 50) & (np.abs(r - b) < 90)
    rows = m.sum(1)
    # Horizontal edges: the two strongest runs of rows.
    cand = np.where(rows > rows.max() * 0.5)[0]
    runs = sorted(clusters(list(cand)), key=lambda c: -rows[c].sum())[:2]
    runs = sorted(runs, key=lambda c: c[0])
    y_top = float(np.average(runs[0], weights=rows[runs[0]]))
    y_bot = float(np.average(runs[1], weights=rows[runs[1]]))
    # Vertical edges: from the horizontal lines' end points (robust even when vertical lines are faint),
    # cross-checked with column runs when they are strong.
    xs = np.where(m[int(round(y_top)) - 1:int(round(y_top)) + 2].any(0) | m[int(round(y_bot)) - 1:int(round(y_bot)) + 2].any(0))[0]
    x_left = float(np.percentile(xs, 0.2)) + 2.0
    x_right = float(np.percentile(xs, 99.8)) - 2.0
    cols = m[int(y_top) + 20:int(y_bot) - 20].sum(0)
    strong = np.where(cols > (y_bot - y_top) * 0.6)[0]
    if len(strong):
        cr = sorted(clusters(list(strong)), key=lambda c: c[0])
        lc, rc = cr[0], cr[-1]
        if abs(np.mean(lc) - x_left) < 15:
            x_left = float(np.average(lc, weights=cols[lc]))
        if abs(np.mean(rc) - x_right) < 15:
            x_right = float(np.average(rc, weights=cols[rc]))
    return x_left, y_top, x_right, y_bot


def tile_bounds(z, x, y):
    n = 2 ** z
    lon0 = x / n * 360 - 180
    lon1 = (x + 1) / n * 360 - 180
    lat0 = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    lat1 = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lon0, lat0, lon1, lat1


def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def build(frame, rect_geo):
    img = Image.open(RAW / f"Frame_{frame}.jpg").convert("RGB")
    rgb = np.asarray(img)
    xl, yt, xr, yb = detect_rectangle(rgb)
    W, S, E, N = rect_geo["west"], rect_geo["south"], rect_geo["east"], rect_geo["north"]
    deg_per_px_x = (E - W) / (xr - xl)
    deg_per_px_y = (N - S) / (yb - yt)
    m_px_x = deg_per_px_x * 111_320 * COS_LAT
    m_px_y = deg_per_px_y * M_PER_DEG_LAT
    native = (m_px_x + m_px_y) / 2

    # Clip to just inside the rectangle; keep the geo extent of the clipped image.
    cx0, cy0, cx1, cy1 = int(math.ceil(xl + INSET)), int(math.ceil(yt + INSET)), int(xr - INSET), int(yb - INSET)
    crop = img.crop((cx0, cy0, cx1, cy1)).convert("RGBA")
    geo = {"west": W + (cx0 - xl) * deg_per_px_x, "east": W + (cx1 - xl) * deg_per_px_x,
           "north": N - (cy0 - yt) * deg_per_px_y, "south": N - (cy1 - yt) * deg_per_px_y}
    del img, rgb

    # Max zoom: the first zoom whose tile resolution is at least as fine as the image.
    zmax = next(z for z in range(10, 23) if 156543.034 * COS_LAT / 2 ** z <= native * 1.05)
    zmin = MIN_ZOOM[frame]

    # Image pyramid (each level half the size of the previous).
    levels = [crop]
    while min(levels[-1].size) > 512:
        im = levels[-1]
        levels.append(im.resize((im.width // 2, im.height // 2), Image.LANCZOS))

    cw, ch = crop.size
    lon_per_px = (geo["east"] - geo["west"]) / cw
    lat_per_px = (geo["north"] - geo["south"]) / ch

    out_path = TILES / f"frame_{frame}.pmtiles"
    tiles = []
    for z in range(zmin, zmax + 1):
        tx0, ty0 = lonlat_to_tile(geo["west"], geo["north"], z)
        tx1, ty1 = lonlat_to_tile(geo["east"], geo["south"], z)
        tile_m = 156543.034 * COS_LAT / 2 ** z
        k = max(0, min(len(levels) - 1, int(math.floor(math.log2(max(tile_m / native, 1.0))))))
        lev = levels[k]
        sx, sy = lev.width / cw, lev.height / ch
        for x in range(int(tx0), int(tx1) + 1):
            for y in range(int(ty0), int(ty1) + 1):
                lon0, lat0, lon1, lat1 = tile_bounds(z, x, y)
                px0 = (lon0 - geo["west"]) / lon_per_px * sx
                px1 = (lon1 - geo["west"]) / lon_per_px * sx
                py0 = (geo["north"] - lat1) / lat_per_px * sy
                py1 = (geo["north"] - lat0) / lat_per_px * sy
                t = lev.transform((256, 256), Image.EXTENT, (px0, py0, px1, py1), Image.BICUBIC)
                alpha = np.asarray(t.getchannel("A"))
                if alpha.max() == 0:
                    continue
                buf = io.BytesIO()
                if alpha.min() == 255:
                    t.convert("RGB").save(buf, "WEBP", quality=WEBP_QUALITY, method=4)
                else:
                    t.save(buf, "WEBP", quality=WEBP_QUALITY, method=4)
                tiles.append((zxy_to_tileid(z, x, y), buf.getvalue()))
        print(f"  frame {frame} z{z}: level {k}, {len(tiles)} tiles so far")

    tiles.sort(key=lambda t: t[0])
    with open(out_path, "wb") as f:
        w = Writer(f)
        for tid, data in tiles:
            w.write_tile(tid, data)
        e7 = lambda v: int(round(v * 1e7))
        w.finalize({
            "tile_type": TileType.WEBP, "tile_compression": Compression.NONE,
            "min_lon_e7": e7(geo["west"]), "min_lat_e7": e7(geo["south"]),
            "max_lon_e7": e7(geo["east"]), "max_lat_e7": e7(geo["north"]),
            "center_zoom": zmin + 2,
            "center_lon_e7": e7((geo["west"] + geo["east"]) / 2), "center_lat_e7": e7((geo["south"] + geo["north"]) / 2),
        }, {"name": f"Madhira Google Earth Frame {frame}", "attribution": "Imagery © Google Earth",
            "description": rect_geo["title"]})
    size_mb = out_path.stat().st_size / 1e6
    print(f"frame {frame}: rect px ({xl:.1f},{yt:.1f})-({xr:.1f},{yb:.1f}) native {native:.3f} m/px "
          f"(x {m_px_x:.3f}, y {m_px_y:.3f}) z{zmin}-{zmax} tiles {len(tiles)} {size_mb:.1f} MB")
    return {"frame": frame, "title": rect_geo["title"], "rect_px": [xl, yt, xr, yb],
            "m_per_px": round(native, 3), "m_per_px_xy": [round(m_px_x, 3), round(m_px_y, 3)],
            "bounds": [geo["west"], geo["south"], geo["east"], geo["north"]],
            "minzoom": zmin, "maxzoom": zmax, "tiles": len(tiles), "file": f"tiles/frame_{frame}.pmtiles"}


def main():
    frames = json.loads((OUT / "frames.json").read_text())
    meta = [build(f, frames[f]) for f in "ABCD"]
    (OUT / "imagery.json").write_text(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
