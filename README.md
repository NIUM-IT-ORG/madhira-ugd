# Madhira UGD Tracker

Web app for tracking the Underground Drainage scheme in Madhira Municipality: a satellite map of the sewer
network road by road, field updates from AEEs and inspectors, and progress dashboards for the Commissioner.

## Layout

| Folder | What it holds |
| --- | --- |
| `pipeline/` | Python scripts that turn the source files (KML, Google Earth frames, network plan PDFs, progress Excel) into map data |
| `data/raw/` | Source files as received |
| `data/processed/` | Map data the app serves: wards, zones, manholes, pipes (GeoJSON) and imagery tiles (PMTiles) |
| `server/` | Node.js API server (Fastify); also serves the built web app and the map data |
| `web/` | React + MapLibre web app |
| `shared/` | Status model, geometry and progress figures used by both server and web app |
| `docs/` | Deployment guide, user guides, map accuracy report |

## Run locally

```bash
cd server && npm install && cd ../web && npm install && cd ..
node server/src/index.js          # API + map data on http://localhost:8080
npm --prefix web run dev          # web app with hot reload on http://localhost:5173
```

Production: `npm --prefix web run build`, then `node server/src/index.js` serves everything on port 8080.
On first start an admin is created; its one-time password is in `var/first-admin.json`.
Cloud deployment with Docker: see [docs/DEPLOY.md](docs/DEPLOY.md).

Tests (server running): `node server/test/postdeploy-check.mjs <url> [email password]` (read-only, safe on the live system);
`node server/test/staging-test.mjs <url>` (full end-to-end test that creates test data: test copies only).

## Rebuild the map data

```bash
python3 -m venv .venv && .venv/bin/pip install pymupdf openpyxl pillow numpy shapely scipy pmtiles pyproj
cd pipeline
../.venv/bin/python 01_wards_zones_baseline.py
../.venv/bin/python 02_imagery_tiles.py
../.venv/bin/python 03_georef_plans.py
../.venv/bin/python 04_network.py
../.venv/bin/python 05_web_extras.py
```
