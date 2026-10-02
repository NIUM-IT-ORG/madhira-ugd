"""Georeference the common plan frame (Zone-2 sheet page coordinates) to UTM 44N / WGS84.

The Zone-2 network plan contains the STP-2 site survey grid at true drawing scale, labelled with
UTM coordinates ("N 1870945" ... / "E 429810" ...). Fitting those labels gives the exact linear map
plan frame <-> UTM (north-up, no rotation). Checked against the STP-2 lat/long printed on the
Zonal Plan: 4.9 m apart. Pipe-length labels give the same scale (1.712 pt/m vs 1.7111 from the grid).
"""
import json
import re

import numpy as np
from pyproj import Transformer

from common import OUT, page

UTM_EPSG = 32644


def main():
    N, E = [], []
    for b in page("Z2").get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            t = "".join(sp["text"] for sp in l["spans"]).strip()
            m = re.fullmatch(r"([NE])\s*(\d{6,7})", t)
            if m:
                x0, y0, x1, y1 = l["bbox"]
                (N if m.group(1) == "N" else E).append((float(m.group(2)), (x0 + x1) / 2, (y0 + y1) / 2))
    N, E = np.array(N), np.array(E)
    ay, by = np.polyfit(N[:, 0], N[:, 2], 1)
    ax, bx = np.polyfit(E[:, 0], E[:, 1], 1)
    rms = float(np.sqrt(np.mean(np.r_[N[:, 2] - (ay * N[:, 0] + by), E[:, 1] - (ax * E[:, 0] + bx)] ** 2)))

    T = Transformer.from_crs(UTM_EPSG, 4326, always_xy=True)
    lon, lat = T.transform(429837.5, 1870980.0)
    zonal = (16 + 55.283 / 60, 80 + 20.469 / 60)
    check_m = float(np.hypot((zonal[0] - lat) * 110_600, (zonal[1] - lon) * 106_500))
    g = {"utm_epsg": UTM_EPSG, "frame": "Zone-2 sheet page coordinates (PDF pt)",
         "x_from_E": [ax, bx], "y_from_N": [ay, by], "fit_rms_pt": rms,
         "pt_per_m": (ax - ay) / 2, "check_stp2_vs_zonal_plan_m": round(check_m, 1),
         "control_labels": {"N": len(N), "E": len(E)}}
    (OUT / "plan_georef.json").write_text(json.dumps(g, indent=1))
    print(json.dumps(g, indent=1))


if __name__ == "__main__":
    main()
