"""Shared helpers for the network-plan pipeline.

All network plan sheets are viewports of the same CAD model. We use the Zone-2 sheet's page
coordinates (PDF points) as the common "plan frame" and fit a similarity transform from every
other sheet into it by matching the base-map labels the sheets share.
"""
import collections
import json
import math
import re
from functools import lru_cache
from pathlib import Path

import fitz
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "processed"

SHEETS = {
    "Z1P1": "Madhira_Network_Plan_Zone-1_Part-1.pdf",
    "Z1P2": "Madhira_Network_Plan_Zone-1_Part-2.pdf",
    "Z1P3": "Madhira_Network_Plan_Zone-1_Part-3.pdf",
    "Z2": "Madhira_Network_plan_Zone-2.pdf",
    "Z3": "Madhira_Network_plan_Zone-3.pdf",
    "Z4": "Madhira_Network_plan_Zone-4.pdf",
}
REF_SHEET = "Z2"
LAT0 = 16.92
M_PER_DEG_LAT = 110_600.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(LAT0))


@lru_cache(maxsize=None)
def page(sheet):
    return fitz.open(RAW / SHEETS[sheet])[0]


def label_spans(sheet):
    out = []
    for b in page(sheet).get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            t = "".join(s["text"] for s in l["spans"]).strip()
            if len(t) >= 4 and re.search("[A-Za-z]{3}", t) and not re.match(r"(MH|GL|IL|L\d|L-|D-?\d)", t):
                x0, y0, x1, y1 = l["bbox"]
                out.append((t, (x0 + x1) / 2, (y0 + y1) / 2))
    return out


def umeyama(A, B):
    """Similarity B ~= s R A + t. Returns (s, R, t)."""
    ma, mb = A.mean(0), B.mean(0)
    a, b = A - ma, B - mb
    U, S, Vt = np.linalg.svd(b.T @ a)
    D = np.eye(2)
    D[1, 1] = np.sign(np.linalg.det(U @ Vt))
    R = U @ D @ Vt
    s = (S * np.diag(D)).sum() / (a ** 2).sum()
    return s, R, mb - s * R @ ma


@lru_cache(maxsize=None)
def sheet_to_frame(sheet):
    """3x3 matrix mapping sheet page coords -> common plan frame (Zone-2 page coords)."""
    if sheet == REF_SHEET:
        return np.eye(3)

    def uniq(sp):
        c = collections.Counter(s[0] for s in sp)
        return {s[0]: (s[1], s[2]) for s in sp if c[s[0]] == 1}

    u, ref = uniq(label_spans(sheet)), uniq(label_spans(REF_SHEET))
    common = [k for k in u if k in ref]
    A = np.array([u[k] for k in common])
    B = np.array([ref[k] for k in common])
    rng = np.random.default_rng(0)
    best = None
    for _ in range(500):
        idx = rng.choice(len(A), 3, replace=False)
        s, R, t = umeyama(A[idx], B[idx])
        res = np.linalg.norm((s * (R @ A.T)).T + t - B, axis=1)
        inl = res < 3
        if best is None or inl.sum() > best.sum():
            best = inl
    s, R, t = umeyama(A[best], B[best])
    M = np.eye(3)
    M[:2, :2] = s * R
    M[:2, 2] = t
    return M


def apply(M, pts):
    pts = np.asarray(pts, dtype=float)
    return (M[:2, :2] @ pts.T).T + M[:2, 2]


@lru_cache(maxsize=None)
def _georef():
    from pyproj import Transformer
    g = json.loads((OUT / "plan_georef.json").read_text())
    return g, Transformer.from_crs(g["utm_epsg"], 4326, always_xy=True)


def frame_to_utm(pts):
    g, _ = _georef()
    pts = np.asarray(pts, dtype=float).reshape(-1, 2)
    (ax, bx), (ay, by) = g["x_from_E"], g["y_from_N"]
    return np.column_stack([(pts[:, 0] - bx) / ax, (pts[:, 1] - by) / ay])


def grid_labels(sheet, min_size=1.0):
    """UTM survey-grid labels ('N 1870945', 'E 429810') drawn at network scale (key-plan copies are tiny)."""
    N, E = [], []
    for b in page(sheet).get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            t = "".join(sp["text"] for sp in l["spans"]).strip()
            m = re.fullmatch(r"([NE])\s*(\d{6,7})", t)
            if m and max(sp["size"] for sp in l["spans"]) >= min_size:
                x0, y0, x1, y1 = l["bbox"]
                (N if m.group(1) == "N" else E).append((float(m.group(2)), (x0 + x1) / 2, (y0 + y1) / 2))
    return np.array(N).reshape(-1, 3), np.array(E).reshape(-1, 3)


def sheet_grid_utm(sheet):
    """Sheet coords -> UTM via the sheet's own STP survey grid, or None if the sheet has none.
    Returns 3x3 matrix mapping (x, y) -> (E, N)."""
    N, E = grid_labels(sheet)
    if len(N) < 5 or len(E) < 5:
        return None
    ay, by = np.polyfit(N[:, 0], N[:, 2], 1)
    ax, bx = np.polyfit(E[:, 0], E[:, 1], 1)
    G = np.eye(3)
    G[0, 0], G[0, 2] = 1 / ax, -bx / ax
    G[1, 1], G[1, 2] = 1 / ay, -by / ay
    return G


def utm_to_lonlat(en):
    _, T = _georef()
    en = np.asarray(en, dtype=float).reshape(-1, 2)
    lon, lat = T.transform(en[:, 0], en[:, 1])
    return np.column_stack([lon, lat])


def frame_to_lonlat(pts):
    """Common plan frame (PDF pt) -> [[lon, lat], ...] via UTM 44N, produced by 03_georef_plans.py."""
    _, T = _georef()
    en = frame_to_utm(pts)
    lon, lat = T.transform(en[:, 0], en[:, 1])
    return np.column_stack([lon, lat])
