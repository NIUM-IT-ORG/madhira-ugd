"""Build ward + zone polygons from the KML and the sanctioned/executed baseline from the progress Excel.

Outputs (data/processed):
  wards.geojson     22 ward polygons with zone, locality names, area
  zones.geojson     4 zone polygons (union of their wards)
  baseline.json     ward-wise sanctioned / executed figures as of the Excel date
"""
import json
import re
from pathlib import Path

import openpyxl
from shapely.geometry import Polygon, mapping
from shapely.ops import unary_union
from shapely.validation import make_valid

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "processed"
OUT.mkdir(parents=True, exist_ok=True)

# Zone membership from the progress sheet. Zone 3 / 4 names follow the drawings
# (decision 1, 2026-10-02): Zone 3 = Ambarupeta (east), Zone 4 = Yellandulapadu (south).
ZONE_OF_WARD = {w: 1 for w in [1, 2] + list(range(8, 23))}
ZONE_OF_WARD.update({5: 2, 6: 2, 7: 2, 3: 3, 4: 4})
ZONE_NAMES = {1: "Zone 1 - Core town", 2: "Zone 2 - Madupalli", 3: "Zone 3 - Ambarupeta", 4: "Zone 4 - Yellandulapadu"}
LOCALITY_FIX = {3: "Ambarupeta", 4: "Yellandulapadu"}
BASELINE_DATE = "2026-09-30"

# Equal-area-ish metres per degree at Madhira's latitude, good enough for areas/lengths at town scale.
LAT0 = 16.92
M_PER_DEG_LAT = 110_600.0
M_PER_DEG_LON = 111_320.0 * 0.95672  # cos(16.92 deg)


def area_ha(poly):
    from shapely.affinity import scale
    return scale(poly, M_PER_DEG_LON, M_PER_DEG_LAT, origin=(0, 0)).area / 10_000


def read_kml_wards():
    s = (RAW / "Madhira_image_frames.kml").read_text()
    wards = {}
    for m in re.finditer(r"<name>Ward (\d+)</name>.*?<coordinates>(.*?)</coordinates>", s, re.S):
        pts = [tuple(map(float, p.split(",")[:2])) for p in m.group(2).split()]
        poly = Polygon(pts)
        if not poly.is_valid:
            poly = make_valid(poly)
            if poly.geom_type != "Polygon":  # keep the largest piece
                poly = max(getattr(poly, "geoms", [poly]), key=lambda g: g.area)
        wards[int(m.group(1))] = poly
    return wards


def read_frames():
    s = (RAW / "Madhira_image_frames.kml").read_text()
    frames = {}
    for m in re.finditer(r"<Placemark><name>Frame (\w) - ([^<]*)</name>.*?<coordinates>(.*?)</coordinates>", s, re.S):
        pts = [tuple(map(float, p.split(",")[:2])) for p in m.group(3).split()]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        frames[m.group(1)] = {"title": m.group(2), "west": min(xs), "east": max(xs), "south": min(ys), "north": max(ys)}
    return frames


def read_baseline():
    ws = openpyxl.load_workbook(RAW / "UGD_progress_30-09-26.xlsx", data_only=True).active
    rows = []
    for r in ws.iter_rows(min_row=6, values_only=True):
        sno, zone, ward, area, *nums = r[:13]
        if not isinstance(sno, int) or ward is None:
            continue
        rows.append({"sno": sno, "zone": zone, "ward": int(ward), "locality": (area or "").strip() or None,
                     "nums": nums})
    # Zone 2 is one combined row (wards 5, 6, 7) on the sheet; the row with numbers carries the zone total.
    out = []
    for r in rows:
        if r["nums"][0] is None:
            continue
        sanc_len, sanc_mh, sanc_ic, ex_len, ex_mh, ex_ic = r["nums"][:6]
        wards = [5, 6, 7] if r["ward"] == 5 and ZONE_OF_WARD[5] == 2 else [r["ward"]]
        out.append({
            "group": f"W{'-'.join(map(str, wards))}",
            "zone": ZONE_OF_WARD[r["ward"]],
            "wards": wards,
            "locality": LOCALITY_FIX.get(r["ward"], r["locality"]),
            "sanctioned": {"pipe_m": sanc_len, "manholes": sanc_mh, "ics": sanc_ic},
            "executed": {"pipe_m": ex_len, "manholes": ex_mh, "ics": ex_ic},
        })
    return out


def main():
    wards = read_kml_wards()
    baseline = read_baseline()
    locality = {}
    for b in baseline:
        for w in b["wards"]:
            locality[w] = b["locality"]

    feats = []
    for w in sorted(wards):
        z = ZONE_OF_WARD[w]
        feats.append({"type": "Feature", "id": w, "geometry": mapping(wards[w]),
                      "properties": {"ward": w, "zone": z, "zone_name": ZONE_NAMES[z],
                                     "locality": locality.get(w), "area_ha": round(area_ha(wards[w]), 2)}})
    (OUT / "wards.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}))

    zfeats = []
    for z in sorted(ZONE_NAMES):
        # The KML wards leave thin gaps between neighbours; close gaps up to ~30 m and drop sliver holes.
        u = unary_union([wards[w].buffer(0.00015, join_style=2) for w in wards if ZONE_OF_WARD[w] == z]).buffer(-0.00015, join_style=2)
        polys = [p for p in getattr(u, "geoms", [u]) if area_ha(p) > 1]
        polys = [Polygon(p.exterior, [h for h in p.interiors if area_ha(Polygon(h)) > 1]) for p in polys]
        u = polys[0] if len(polys) == 1 else unary_union(polys)
        zfeats.append({"type": "Feature", "id": z, "geometry": mapping(u),
                       "properties": {"zone": z, "name": ZONE_NAMES[z], "area_ha": round(area_ha(u), 2),
                                      "wards": sorted(w for w in wards if ZONE_OF_WARD[w] == z)}})
    (OUT / "zones.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": zfeats}))

    (OUT / "baseline.json").write_text(json.dumps({"as_of": BASELINE_DATE, "source": "UGD progress 30-09-26.xlsx",
                                                   "units": {"pipe_m": "running metres"}, "groups": baseline},
                                                  indent=1))
    (OUT / "frames.json").write_text(json.dumps(read_frames(), indent=1))

    tot = lambda k, f: sum(b[k][f] for b in baseline)
    print(f"wards {len(feats)} zones {len(zfeats)} baseline groups {len(baseline)}")
    print("sanctioned", tot("sanctioned", "pipe_m"), tot("sanctioned", "manholes"), tot("sanctioned", "ics"))
    print("executed  ", tot("executed", "pipe_m"), tot("executed", "manholes"), tot("executed", "ics"))
    for f in zfeats:
        print(f["properties"]["name"], f["properties"]["area_ha"], "ha", f["geometry"]["type"])
    for f in feats:
        p = f["properties"]
        print(f"  ward {p['ward']:>2} zone {p['zone']} {p['area_ha']:>8} ha  {p['locality']}")


if __name__ == "__main__":
    main()
