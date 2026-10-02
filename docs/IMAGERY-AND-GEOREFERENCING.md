# Imagery and georeferencing

How the satellite base map and the sewer network were placed on the earth, with every number needed to
check or redo it. The scripts that did it are in `pipeline/` (run order in the README).

## Coordinate systems

| Data | System | EPSG |
| --- | --- | --- |
| Everything the app serves (GeoJSON, KML exports) | WGS 84 longitude / latitude | 4326 |
| Imagery tiles | Web Mercator XYZ tiles (256 px), zoom 11–19 | 3857 |
| Network plan drawings (CAD) | WGS 84 / UTM zone 44N, metres | 32644 |

## Satellite imagery

**Source:** four top-down Google Earth Pro frames supplied by the municipality (`data/raw/frames/Frame_A–D.jpg`,
8192 × 5301 px each), framed on the rectangles in `data/raw/Madhira_image_frames.kml`. Credit shown on the map:
"Imagery © Google Earth". Licence: internal municipal use with attribution (see `LICENCES.md`).

**Method:** the KML rectangle is burned into each image in magenta. Script `02_imagery_tiles.py` detects
its four edges to sub-pixel precision, maps them linearly to the rectangle's longitude/latitude, clips each
image 7 px inside the line, and renders WebP tiles into one PMTiles archive per frame. Horizontal and
vertical pixel sizes agree within 0.6 %, which confirms a top-down, undistorted view.

| Frame | Area | Rectangle (W, S, E, N) | Pixel size | Zoom levels | Tiles | File |
| --- | --- | --- | --- | --- | --- | --- |
| A | Whole municipality (overview) | 80.3190, 16.8915, 80.4050, 16.9485 | 1.23 m | 11–17 | 987 | `tiles/frame_A.pmtiles` (11.5 MB) |
| B | Core town, Zone 1 | 80.3535, 16.9105, 80.3785, 16.9445 | 0.77 m | 15–18 | 711 | `tiles/frame_B.pmtiles` (7.8 MB) |
| C | Zones 3 and 4 (south-east) | 80.3655, 16.8995, 80.3895, 16.9265 | 0.61 m | 15–18 | 516 | `tiles/frame_C.pmtiles` (6.7 MB) |
| D | Zone 2, Madupalli (west) | 80.3280, 16.9148, 80.3425, 16.9272 | 0.28 m | 16–19 | 609 | `tiles/frame_D.pmtiles` (7.3 MB) |

Drawing order on the map, bottom to top: A, B, C, D (each sharper than the one below). Outside the frames
the map shows Esri World Imagery for context only. Per-frame details are in `data/processed/imagery.json`.

**PMTiles** is an open single-file tile format (https://github.com/protomaps/PMTiles). The browser reads
tiles with HTTP Range requests, so any web server or object store that supports Range can serve it.

**Check:** the KML ward boundaries, which were traced on the same imagery, follow the roads, railway and
lake edges in every frame (overlays in the original QA images).

## Wards and zones

- 22 ward polygons from the KML (`wards.geojson`), areas computed on the ground (ha).
- Zones are unions of their wards, following the progress sheet: Zone 1 = wards 1, 2, 8–22; Zone 2 = 5, 6, 7;
  Zone 3 = ward 3 (Ambarupeta, east); Zone 4 = ward 4 (Yellandulapadu, south). Zone names follow the
  drawings, by the Commissioner's decision of 2 Oct 2026 (the Excel had the two names swapped).
- Gaps of up to ~30 m between neighbouring KML wards are closed when forming zones.

## Sewer network from the plans

**Sources:** six network-plan PDFs (Zone 1 in three parts, Zones 2–4), exported from CAD with real vectors
and text. Every manhole label (`MH-123`, ground level `GL`, invert level `IL`) and every pipe label
(length `L`, diameter `D`, slope `S`) is read as text; manholes are the circle symbols.

**Shared base, separate networks:** all sheets share one CAD base map (their place labels match exactly),
but each sheet draws its network at its own offset and scale from that base. Each was therefore placed
on its own:

| Sheet | Placed by | Fit |
| --- | --- | --- |
| Zone 2 | Its STP-2 site survey grid, labelled in UTM (`N 1870945` … / `E 429810` …), 27 labels | exact (labels fit to 0.0001 pt); STP-2 lands 4.9 m from the Zonal Plan lat/long |
| Zone 3 | Its STP survey grid, labelled in UTM | drawn/labelled pipe length 1.000 |
| Zone 4 | Its STP survey grid, labelled in UTM | drawn/labelled pipe length 1.002 |
| Zone 1 Part 1 | Reference sheet for Zone 1 | — |
| Zone 1 Part 2 | Similarity fit to Part 1 on 44 shared manholes | RMS 0.21 m, scale 1.0004, rotation 0.003° |
| Zone 1 Part 3 | Similarity fit to Parts 1–2 on 192 shared manholes | RMS 0.28 m |
| Zone 1 (whole) | One control point: PS-1 wet well = STP-1 survey grid centre, UTM 431820 E, 1870142.5 N (from the key-plan grid labels); scale 0.98512 from the pipe-length labels | checked visually along Wyra Road, the railway overbridge, station road, north-east colonies |

The Zone 1 control point is in `data/control/zone1_control.json`. Adding surveyed points there (e.g. GPS
fixes of manhole covers) and re-running `04_network.py` refines Zone 1.

**Pipe reaches** are rebuilt from the length labels: each label sits at its reach's midpoint, parallel to it,
with its length. In Zone 2 this agrees with the drawn pipe bands for 603 of 607 reaches; unlabelled reaches
come from the drawn bands.

**Estimated position accuracy** (judged against the imagery): Zone 2 about 1–2 m; Zones 1 and 3 about 3–5 m;
Zone 4 about 5–8 m (its trunk sewer sits on the south-west edge of the Yerrupalem road, possibly its design
alignment). The Commissioner checked the map against the ground on 2 Oct 2026 and accepted it.

## Totals from the plans vs sanctioned

| Zone | Manholes (plans) | Pipe length (plans) | Manholes (sanctioned) | Pipe (sanctioned) |
| --- | --- | --- | --- | --- |
| 1 | 2,686 | 88.7 km | 3,311 | 75.6 km |
| 2 | 639 | 15.0 km | 620 | 13.2 km |
| 3 | 248 | 6.1 km | 199 | 4.4 km |
| 4 | 396 | 10.0 km | 257 | 6.3 km |

The dashboard uses the sanctioned figures for progress; the plans give the map geometry. The difference is
open with the engineer (plans are marked "For approval").

## Known limits

- Zone 1 reuses manhole numbers across its three parts; such duplicates have ids like `Z1/MH-245#Z1P2`
  and show as "MH-245 (Z1, P2)".
- 590 manholes (15 %) lie just outside the KML ward outlines (mostly the Madupalli edge); they carry the
  nearest ward and `outside_boundary: true`.
- 31 manholes have no readable label; 86 small network pieces are not connected to the main network
  (labels missing on the drawing).
- The Zonal Plan's STP lat/longs for Zones 1, 3 and 4 are 65–500 m from their survey grids; the grids were used.
