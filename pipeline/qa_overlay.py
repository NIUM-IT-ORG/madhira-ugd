"""QA: draw the extracted pipes / manholes and ward lines on the Google Earth frames.

usage: qa_overlay.py FRAME [x0 y0 x1 y1]   (crop in frame pixels; default whole frame at 1/4 size)
"""
import json
import sys

from PIL import Image, ImageDraw

from common import OUT, ROOT

Image.MAX_IMAGE_PIXELS = None
ZCOL = {1: (255, 60, 60), 2: (60, 160, 255), 3: (255, 200, 0), 4: (200, 80, 255)}


def main():
    f = sys.argv[1]
    crop = list(map(int, sys.argv[2:6])) if len(sys.argv) >= 6 else None
    meta = {m["frame"]: m for m in json.loads((OUT / "imagery.json").read_text())}[f]
    g = json.loads((OUT / "frames.json").read_text())[f]
    xl, yt, xr, yb = meta["rect_px"]
    P = lambda lon, lat: (xl + (lon - g["west"]) / (g["east"] - g["west"]) * (xr - xl),
                          yt + (g["north"] - lat) / (g["north"] - g["south"]) * (yb - yt))
    im = Image.open(ROOT / "data" / "raw" / "frames" / f"Frame_{f}.jpg").convert("RGB")
    d = ImageDraw.Draw(im)
    w = 2 if crop else 6
    for ft in json.loads((OUT / "wards.geojson").read_text())["features"]:
        d.line([P(*c) for c in ft["geometry"]["coordinates"][0]], fill=(255, 255, 255), width=w)
    for ft in json.loads((OUT / "pipes.geojson").read_text())["features"]:
        d.line([P(*c) for c in ft["geometry"]["coordinates"]], fill=ZCOL[ft["properties"]["zone"]], width=w + 1)
    if crop:
        for ft in json.loads((OUT / "manholes.geojson").read_text())["features"]:
            x, y = P(*ft["geometry"]["coordinates"])
            d.ellipse([x - 4, y - 4, x + 4, y + 4], outline=(255, 255, 255), width=2)
        out = im.crop(crop)
        name = f"overlay_{f}_{crop[0]}_{crop[1]}.jpg"
    else:
        out = im.resize((im.width // 4, im.height // 4), Image.LANCZOS)
        name = f"overlay_{f}.jpg"
    (ROOT / "data" / "qa").mkdir(exist_ok=True)
    out.save(ROOT / "data" / "qa" / name, quality=85)
    print(ROOT / "data" / "qa" / name)


if __name__ == "__main__":
    main()
