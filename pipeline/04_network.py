"""Extract the sewer network (manholes + pipe reaches) from the network-plan PDFs.

Method (same for every sheet):
  1. Manholes  = the black circle symbols (double circle in Z2-Z4, dot in Z1), grouped when concentric.
  2. MH labels ("MH-123" + "GL .." + "IL ..") are matched to symbols with an optimal assignment.
  3. Pipe reaches are rebuilt from the length labels ("L23 m" / "L-23 m"): sewers are straight between
     manholes, and each label sits at its reach's midpoint, parallel to it, with the reach's length.
     For Z2-Z4 the drawn pipe bands (filled strips manhole-to-manhole) add reaches that lack a label
     and are used to measure the label method's accuracy.
  4. Sheets are mapped to the common plan frame, then to WGS84 (03_georef_plans.py). Zone 1's three
     overlapping sheets are merged by manhole label.

Outputs: data/processed/manholes.geojson, pipes.geojson, network_report.json
"""
import json
import math
import re
from collections import Counter, defaultdict

import numpy as np
from scipy.optimize import linear_sum_assignment
from scipy.spatial import cKDTree
from shapely.geometry import Point, shape
from shapely.strtree import STRtree

from common import OUT, apply, frame_to_utm, page, sheet_grid_utm, sheet_to_frame, umeyama, utm_to_lonlat

PT_PER_M = json.loads((OUT / "plan_georef.json").read_text())["pt_per_m"]
GEO = json.loads((OUT / "plan_georef.json").read_text())
FRAME_TO_UTM = np.array([[1 / GEO["x_from_E"][0], 0, -GEO["x_from_E"][1] / GEO["x_from_E"][0]],
                         [0, 1 / GEO["y_from_N"][0], -GEO["y_from_N"][1] / GEO["y_from_N"][0]], [0, 0, 1]])


CONTROL = OUT.parent / "control" / "zone1_control.json"


def zone1_correction(sheet_T):
    """The Zone-1 sheets draw the network offset from their base map and carry no survey grid.
    Fit a similarity (raw UTM -> true UTM) to the control points in data/control/zone1_control.json:
    each point = a position on a Zone-1 sheet ("sheet" + "xy" in PDF pt) and its true position
    ("utm" or "lonlat"). One point: translation only, scale from the pipe-length labels."""
    if not CONTROL.exists():
        return np.eye(3), None
    from pyproj import Transformer
    to_utm = Transformer.from_crs(4326, 32644, always_xy=True)
    cfg = json.loads(CONTROL.read_text())
    A, B = [], []
    for p in cfg["points"]:
        A.append(apply(np.array(sheet_T[p["sheet"]]), [p["xy"]])[0])
        B.append(p["utm"] if "utm" in p else to_utm.transform(*p["lonlat"]))
    A, B = np.array(A), np.array(B, dtype=float)
    S = np.eye(3)
    if len(A) == 1:
        sc = cfg.get("scale", 1.0)
        S[:2, :2] = sc * np.eye(2)
        S[:2, 2] = B[0] - sc * A[0]
        res = np.zeros(1)
    else:
        sc, R, t = umeyama(A, B)
        S[:2, :2], S[:2, 2] = sc * R, t
        res = np.linalg.norm(apply(S, A) - B, axis=1)
    info = {"points": len(A), "scale": round(float(np.linalg.norm(S[:2, 0])), 5),
            "rot_deg": round(float(np.degrees(np.arctan2(S[1, 0], S[0, 0]))), 3),
            "shift_m": np.round(S[:2, 2] + (S[:2, :2] - np.eye(2)) @ A.mean(0), 1).tolist(),
            "residuals_m": np.round(res, 1).tolist()}
    return S, info
ZONE = {"Z1P1": 1, "Z1P2": 1, "Z1P3": 1, "Z2": 2, "Z3": 3, "Z4": 4}

RE_MH = re.compile(r"^MH-?\s?(\d+(?:/[\w]+)?)\b")
RE_GL = re.compile(r"GL[-\s]?(\d+(?:\.\d+)?)")
RE_IL = re.compile(r"IL\s?(\d+(?:\.\d+)?)")
RE_L = re.compile(r"^L-?\s?(\d+(?:\.\d+)?)\s*m?$")
RE_D = re.compile(r"^D-?\s?(\d{3})(?:\.\d+)?\s*(?:mm)?(?:DWC|RCC\w*)?$")
RE_S = re.compile(r"^S-\s?1/([\d,]+)$")


def text_lines(sheet):
    out = []
    for b in page(sheet).get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            t = "".join(sp["text"] for sp in l["spans"]).strip()
            if t:
                out.append({"t": t, "bbox": l["bbox"], "dir": l["dir"],
                            "size": max(sp["size"] for sp in l["spans"])})
    return out


def circle_symbols(sheet):
    """Black circles, grouped when concentric -> list of (x, y, outer_radius)."""
    cands = []
    for g in page(sheet).get_drawings():
        col = g.get("color") or g.get("fill")
        if not col or max(col) > 0.05:
            continue
        its = g["items"]
        pts = []
        for it in its:
            if it[0] == "l":
                pts += [it[1], it[2]]
            elif it[0] == "c":
                pts += [it[1], it[4]]
            else:
                pts = None
                break
        if not pts or len(its) < 4 or (len(its) < 6 and not any(it[0] == "c" for it in its)):
            continue
        P = np.array([(p.x, p.y) for p in pts])
        c = P.mean(0)
        r = np.linalg.norm(P - c, axis=1)
        if 0.3 < r.mean() < 8 and r.std() < 0.1 * r.mean():
            cands.append((c[0], c[1], r.mean()))
    cands.sort(key=lambda c: -c[2])
    C = np.array(cands)
    tree = cKDTree(C[:, :2])
    used = np.zeros(len(C), bool)
    out = []
    for i in range(len(C)):
        if used[i]:
            continue
        grp = [j for j in tree.query_ball_point(C[i, :2], 0.35) if not used[j]]
        used[grp] = True
        out.append((C[i, 0], C[i, 1], C[i, 2], len(grp)))
    # Keep the dominant symbol size (manholes); drop odd circles (icons, arrows, legend).
    radii = Counter(round(o[2], 1) for o in out)
    main_r = radii.most_common(1)[0][0]
    return [o for o in out if abs(o[2] - main_r) <= 0.25 * main_r + 0.1]


def mh_labels(lines):
    """MH label blocks: id + GL + IL, with the bbox of the whole label block."""
    gl = [(l, RE_GL.search(l["t"])) for l in lines if l["t"].startswith("GL")]
    il = [(l, RE_IL.search(l["t"])) for l in lines if l["t"].startswith("IL") or " IL " in l["t"]]
    glc = np.array([((l["bbox"][0] + l["bbox"][2]) / 2, l["bbox"][1]) for l, _ in gl]) if gl else np.zeros((0, 2))
    ilc = np.array([((l["bbox"][0] + l["bbox"][2]) / 2, l["bbox"][1]) for l, _ in il]) if il else np.zeros((0, 2))
    out = []
    for l in lines:
        m = RE_MH.match(l["t"])
        if not m:
            continue
        x0, y0, x1, y1 = l["bbox"]
        h = y1 - y0
        lab = {"label": f"MH-{m.group(1)}", "bbox": [x0, y0, x1, y1], "gl": None, "il": None}
        cx = (x0 + x1) / 2
        for arr, src, key in ((glc, gl, "gl"), (ilc, il, "il")):
            if len(arr):
                below = arr[:, 1] - y0
                d = np.where((below > 0.3 * h) & (below < 3.2 * h), np.abs(arr[:, 0] - cx), np.inf)
                k = int(np.argmin(d))
                if np.isfinite(d[k]) and d[k] < 3 * h and src[k][1]:
                    lab[key] = float(src[k][1].group(1))
                    bb = src[k][0]["bbox"]
                    lab["bbox"] = [min(lab["bbox"][0], bb[0]), lab["bbox"][1], max(lab["bbox"][2], bb[2]), max(lab["bbox"][3], bb[3])]
        out.append(lab)
    return out


def assign_labels(nodes, labels):
    """Optimal one-to-one matching of label blocks to symbols by distance to the label's bbox."""
    if not nodes or not labels:
        return {}
    N = np.array([(n[0], n[1]) for n in nodes])
    B = np.array([l["bbox"] for l in labels])
    dx = np.maximum(0, np.maximum(B[None, :, 0] - N[:, None, 0], N[:, None, 0] - B[None, :, 2]))
    dy = np.maximum(0, np.maximum(B[None, :, 1] - N[:, None, 1], N[:, None, 1] - B[None, :, 3]))
    D = np.hypot(dx, dy)
    h = np.median(B[:, 3] - B[:, 1]) / 3
    cost = np.where(D < 12 * h, D, 1e6)
    r, c = linear_sum_assignment(cost)
    return {int(i): (int(j), float(D[i, j] / h)) for i, j in zip(r, c) if cost[i, j] < 1e6}


def pipe_labels(lines):
    Ls = []
    Ds = [l for l in lines if RE_D.match(l["t"])]
    Ss = [l for l in lines if RE_S.match(l["t"])]
    cen = lambda l: np.array([(l["bbox"][0] + l["bbox"][2]) / 2, (l["bbox"][1] + l["bbox"][3]) / 2])
    Dc = np.array([cen(l) for l in Ds]) if Ds else np.zeros((0, 2))
    Sc = np.array([cen(l) for l in Ss]) if Ss else np.zeros((0, 2))
    for l in lines:
        m = RE_L.match(l["t"])
        if not m:
            continue
        c = cen(l)
        h = l["size"]
        rec = {"len_m": float(m.group(1)), "c": c, "dir": np.array(l["dir"]), "size": h, "dia": None, "slope": None}
        if len(Dc):
            d = np.linalg.norm(Dc - c, axis=1)
            k = int(np.argmin(d))
            if d[k] < 3.5 * h:
                rec["dia"] = int(RE_D.match(Ds[k]["t"]).group(1))
        if len(Sc):
            d = np.linalg.norm(Sc - c, axis=1)
            k = int(np.argmin(d))
            if d[k] < 3.5 * h:
                rec["slope"] = "1/" + RE_S.match(Ss[k]["t"]).group(1).replace(",", "")
        Ls.append(rec)
    return Ls


def band_edges(sheet, nodes_xy):
    """Z2-Z4: filled 4-vertex pipe bands -> node index pairs (+ fill colour)."""
    tree = cKDTree(nodes_xy)
    out = []
    for g in page(sheet).get_drawings():
        f = g.get("fill")
        if g["type"] not in ("f", "fs") or not f or len(g["items"]) != 4 or any(it[0] != "l" for it in g["items"]):
            continue
        P = np.array([(it[1].x, it[1].y) for it in g["items"]])
        sides = [np.linalg.norm(P[i] - P[(i + 1) % 4]) for i in range(4)]
        w, L = min(sides), max(sides)
        if not (0.8 < w < 3.0 and L > 4 * w) or max(f) - min(f) < 0.2:  # coloured strips only
            continue
        k = int(np.argmin(sides))
        a = (P[k] + P[(k + 1) % 4]) / 2
        b = (P[(k + 2) % 4] + P[(k + 3) % 4]) / 2
        da, ia = tree.query(a)
        db, ib = tree.query(b)
        if da < 4 and db < 4 and ia != ib:
            out.append((min(ia, ib), max(ia, ib), tuple(round(x, 2) for x in f)))
    return out


def match_pipes(Ls, nodes_m):
    """Rebuild reaches from length labels. nodes_m: node coords in metres (UTM); each label carries
    its centre c_m and unit direction u in the same metric space."""
    tree = cKDTree(nodes_m)
    best = {}
    for li, L in enumerate(Ls):
        c, u = L["c_m"], L["u"]
        cand = tree.query_ball_point(c, L["len_m"] / 2 + 12)
        top = None
        for a in range(len(cand)):
            for b in range(a + 1, len(cand)):
                i, j = cand[a], cand[b]
                v = nodes_m[j] - nodes_m[i]
                d = np.linalg.norm(v)
                if d < 1:
                    continue
                v = v / d
                e_len = abs(d - L["len_m"]) / max(L["len_m"], 8)
                ang = abs(u[0] * v[1] - u[1] * v[0])
                mid = (nodes_m[i] + nodes_m[j]) / 2
                w = c - mid
                perp = abs(w[0] * v[1] - w[1] * v[0])
                along = abs(w @ v) / d
                if e_len > 0.25 or ang > 0.3 or perp > 7 or along > 0.4:
                    continue
                score = 3 * e_len + 2 * ang + perp / 4 + along
                if top is None or score < top[0]:
                    top = (score, min(i, j), max(i, j))
        if top:
            key = (top[1], top[2])
            if key not in best or top[0] < best[key][0]:
                best[key] = (top[0], li)
    return {k: v[1] for k, v in best.items()}


def main():
    wards = json.loads((OUT / "wards.geojson").read_text())["features"]
    wgeoms = [shape(f["geometry"]) for f in wards]
    wtree = STRtree(wgeoms)

    def ward_of(lon, lat):
        """Ward containing the point; else the nearest ward within ~600 m (flagged by caller)."""
        p = Point(lon, lat)
        for i in wtree.query(p):
            if wgeoms[i].contains(p):
                return wards[i]["properties"]["ward"]
        i = int(np.argmin([g.distance(p) for g in wgeoms]))
        return wards[i]["properties"]["ward"] if wgeoms[i].distance(p) < 0.0055 else None

    def inside_boundary(lon, lat):
        p = Point(lon, lat)
        return any(wgeoms[i].contains(p) for i in wtree.query(p))

    report = {}
    sheet_T = {}
    all_nodes = {}   # key -> node dict (merged across sheets)
    all_pipes = {}   # (keyA, keyB) -> pipe dict
    # Sheets with their own STP survey grid first; Zone-1 Part 3 last (it is aligned on Parts 1-2).
    for sheet in ["Z2", "Z3", "Z4", "Z1P1", "Z1P2", "Z1P3"]:
        M = sheet_to_frame(sheet)
        G = sheet_grid_utm(sheet)
        if G is not None:
            T = G
            method = "own STP survey grid (UTM labels)"
        else:
            T = FRAME_TO_UTM @ M
            method = "shared base map, Zone-2 STP grid"
        zone = ZONE[sheet]
        lines = text_lines(sheet)
        sym = circle_symbols(sheet)
        labs = mh_labels(lines)
        asg = assign_labels(sym, labs)
        sym_xy = np.array([(s[0], s[1]) for s in sym])
        align = None

        if sheet in ("Z1P2", "Z1P3"):
            # Each Zone-1 sheet draws its network at its own offset (and Part 3 at its own scale) from
            # the base map, with no survey grid: fit a similarity on the manholes it shares with the
            # parts already placed (Part 1 is the reference; the control point then fixes Zone 1).
            raw = apply(T, sym_xy)
            common = [(i, f"Z{zone}/{labs[j]['label']}") for i, (j, _) in asg.items()]
            common = [(i, k) for i, k in common if k in all_nodes]
            A = raw[[i for i, _ in common]]
            B = np.array([all_nodes[k]["_raw"] for _, k in common])
            rng = np.random.default_rng(1)
            best = None
            for _ in range(800):
                idx = rng.choice(len(A), 3, replace=False)
                sc, R, t = umeyama(A[idx], B[idx])
                inl = np.linalg.norm((sc * (R @ A.T)).T + t - B, axis=1) < 3
                if best is None or inl.sum() > best.sum():
                    best = inl
            sc, R, t = umeyama(A[best], B[best])
            res = np.linalg.norm((sc * (R @ A[best].T)).T + t - B[best], axis=1)
            S = np.eye(3)
            S[:2, :2], S[:2, 2] = sc * R, t
            T = S @ T
            align = {"shared": len(common), "inliers": int(best.sum()), "scale": round(float(sc), 5),
                     "rot_deg": round(float(np.degrees(np.arctan2(R[1, 0], R[0, 0]))), 3),
                     "rms_m": round(float(np.sqrt((res ** 2).mean())), 2)}
            method = "aligned on manholes shared with earlier Zone-1 parts"
        raw_m = apply(T, sym_xy)
        sheet_T[sheet] = T.tolist()
        to_utm = lambda pts, T=T: apply(T, pts)
        nodes_m = to_utm(sym_xy)
        lonlat = utm_to_lonlat(nodes_m)

        keys = []
        far = 0
        for i, s in enumerate(sym):
            if i in asg:
                lab = labs[asg[i][0]]
                far += asg[i][1] > 4
                key = f"Z{zone}/{lab['label']}"
                props = {"label": lab["label"], "gl": lab["gl"], "il": lab["il"], "label_dist": round(asg[i][1], 2)}
            else:
                key = f"Z{zone}/{sheet}-U{i}"
                props = {"label": None, "gl": None, "il": None, "label_dist": None}
            # Merge Zone-1 duplicates (same label on overlapping sheets) when within 4 m.
            if key in all_nodes:
                prev = all_nodes[key]
                dist = np.linalg.norm(np.array(prev["_raw"]) - raw_m[i])
                if dist < 4:
                    keys.append(key)
                    prev["sheets"].append(sheet)
                    continue
                key = f"{key}#{sheet}"
            all_nodes[key] = {"id": key, "zone": zone, "sheets": [sheet], "lon": float(lonlat[i, 0]),
                              "lat": float(lonlat[i, 1]), "_m": nodes_m[i].tolist(), "_raw": raw_m[i].tolist(), **props}
            keys.append(key)

        Ls = pipe_labels(lines)
        for L in Ls:
            c, c2 = to_utm([L["c"], L["c"] + 5 * L["dir"]])
            L["c_m"], L["u"] = c, (c2 - c) / np.linalg.norm(c2 - c)
        lab_edges = match_pipes(Ls, nodes_m)
        bands = band_edges(sheet, sym_xy) if zone > 1 else []
        band_set = {(a, b) for a, b, _ in bands}
        band_col = {(a, b): c for a, b, c in bands}
        edges = set(lab_edges) | band_set
        ratios = []

        for (a, b) in edges:
            ka, kb = keys[a], keys[b]
            if ka == kb:
                continue
            pk = tuple(sorted((ka, kb)))
            L = Ls[lab_edges[(a, b)]] if (a, b) in lab_edges else None
            na, nb = all_nodes[ka], all_nodes[kb]
            geo_len = float(np.linalg.norm(np.array(na["_m"]) - np.array(nb["_m"])))
            if L:
                ratios.append(geo_len / L["len_m"])
            # Flow from higher invert level to lower.
            up, dn = (ka, kb)
            if na["il"] is not None and nb["il"] is not None and nb["il"] > na["il"]:
                up, dn = kb, ka
            rec = {"from": up, "to": dn, "zone": zone, "len_label_m": L["len_m"] if L else None,
                   "len_geom_m": round(geo_len, 1), "dia_mm": L["dia"] if L else None,
                   "slope": L["slope"] if L else None, "source": "label" if L else "band",
                   "band_colour": band_col.get((a, b)), "sheet": sheet}
            if pk in all_pipes:
                continue
            all_pipes[pk] = rec

        report[sheet] = {
            "georef": method, "alignment": align,
            "symbols": len(sym), "mh_labels": len(labs), "labels_assigned": len(asg),
            "labels_far_from_symbol": far, "length_labels": len(Ls), "reaches_from_labels": len(lab_edges),
            "reaches_from_bands": len(band_set),
            "label_vs_band_agree": len(set(lab_edges) & band_set) if band_set else None,
            "band_only": len(band_set - set(lab_edges)) if band_set else None,
            "geom_over_label_len_median": round(float(np.median(ratios)), 4) if ratios else None,
        }
        print(sheet, report[sheet])

    S, info = zone1_correction(sheet_T)
    report["zone1_correction"] = info
    print("zone-1 correction", info)
    z1 = [n for n in all_nodes.values() if n["zone"] == 1]
    if z1:
        m = apply(S, [n["_m"] for n in z1])
        ll = utm_to_lonlat(m)
        for n, mm, l in zip(z1, m, ll):
            n["_m"], n["lon"], n["lat"] = mm.tolist(), float(l[0]), float(l[1])
        for p in all_pipes.values():
            if p["zone"] == 1:
                a, b = all_nodes[p["from"]]["_m"], all_nodes[p["to"]]["_m"]
                p["len_geom_m"] = round(float(np.linalg.norm(np.array(a) - np.array(b))), 1)

    # Diameter fill-in for band-only reaches from the band colour, using the colour->diameter mapping
    # observed on labelled reaches of the same sheet.
    col_dia = defaultdict(Counter)
    for p in all_pipes.values():
        if p["band_colour"] and p["dia_mm"]:
            col_dia[(p["sheet"], p["band_colour"])][p["dia_mm"]] += 1
    for p in all_pipes.values():
        if p["dia_mm"] is None and p["band_colour"]:
            c = col_dia.get((p["sheet"], p["band_colour"]))
            if c:
                p["dia_mm"] = c.most_common(1)[0][0]
                p["dia_inferred"] = True

    mh_feats = []
    for n in all_nodes.values():
        n["ward"] = ward_of(n["lon"], n["lat"])
        n["outside_boundary"] = not inside_boundary(n["lon"], n["lat"])
        props = {k: v for k, v in n.items() if not k.startswith("_") and k not in ("lon", "lat")}
        mh_feats.append({"type": "Feature", "id": n["id"], "geometry": {"type": "Point", "coordinates": [round(n["lon"], 7), round(n["lat"], 7)]}, "properties": props})
    pipe_feats = []
    for i, (pk, p) in enumerate(sorted(all_pipes.items())):
        a, b = all_nodes[p["from"]], all_nodes[p["to"]]
        mid = ((a["lon"] + b["lon"]) / 2, (a["lat"] + b["lat"]) / 2)
        p["ward"] = ward_of(*mid) or a.get("ward") or b.get("ward")
        p["id"] = f"P{p['zone']}-{i + 1:05d}"
        p["from_label"], p["to_label"] = a["label"], b["label"]
        p["length_m"] = p["len_label_m"] or p["len_geom_m"]
        pipe_feats.append({"type": "Feature", "id": p["id"], "geometry": {"type": "LineString", "coordinates": [
            [round(a["lon"], 7), round(a["lat"], 7)], [round(b["lon"], 7), round(b["lat"], 7)]]}, "properties": p})

    (OUT / "manholes.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": mh_feats}))
    (OUT / "pipes.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": pipe_feats}))

    summ = {}
    for z in (1, 2, 3, 4):
        ps = [f["properties"] for f in pipe_feats if f["properties"]["zone"] == z]
        ms = [f["properties"] for f in mh_feats if f["properties"]["zone"] == z]
        summ[z] = {"manholes": len(ms), "labelled_manholes": sum(1 for m in ms if m["label"]),
                   "reaches": len(ps), "length_km": round(sum(p["length_m"] for p in ps) / 1000, 2),
                   "dia": dict(Counter(p["dia_mm"] for p in ps))}
    report["zones"] = summ
    report["sheet_to_utm"] = sheet_T
    (OUT / "network_report.json").write_text(json.dumps(report, indent=1, default=str))
    print(json.dumps(summ, indent=1, default=str))


if __name__ == "__main__":
    main()
