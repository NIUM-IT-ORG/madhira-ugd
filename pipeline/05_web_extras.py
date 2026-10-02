"""Small derived layers for the web map: ward / zone label points and the overall map bounds."""
import json

from shapely.geometry import mapping, shape

from common import OUT


def main():
    feats = []
    for name, key in (("wards", "ward"), ("zones", "zone")):
        for f in json.loads((OUT / f"{name}.geojson").read_text())["features"]:
            g = shape(f["geometry"])
            p = g.representative_point() if not g.contains(g.centroid) else g.centroid
            props = dict(f["properties"])
            props["kind"] = key
            props.pop("wards", None)
            feats.append({"type": "Feature", "geometry": mapping(p), "properties": props})
    (OUT / "labels.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}))

    xs, ys = [], []
    for name in ("wards", "manholes"):
        for f in json.loads((OUT / f"{name}.geojson").read_text())["features"]:
            g = shape(f["geometry"])
            b = g.bounds
            xs += [b[0], b[2]]
            ys += [b[1], b[3]]
    meta = {"bounds": [min(xs), min(ys), max(xs), max(ys)],
            "center": [(min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2]}
    (OUT / "map_meta.json").write_text(json.dumps(meta, indent=1))
    print(len(feats), "labels;", meta)


if __name__ == "__main__":
    main()
