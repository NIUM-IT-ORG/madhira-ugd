# Madhira UGD Dashboard — Project Notes (working memory)

Source files: `~/Downloads/Madhira UGD Dashboard files/`
Status: PLAN APPROVED 2026-10-02. Plan doc: https://claude.ai/code/artifact/d5e99b47-8461-4cef-a87a-5b725f8aee49

## Decisions (2026-10-02)
1. Zone 3 = Ambarupeta (east, ward 3); Zone 4 = Yellandulapadu (south, ward 4). Excel names are swapped; follow drawings.
2. Sanctioned vs plan quantities: PENDING (Commissioner checking with engineer). Use Excel for KPIs, plans for geometry.
3. Zone 1 IC data (344/1839) confirmed correct.
4. Hosting: Commissioner's own commercial cloud subscription. NOT Supabase. Platform-agnostic: Docker Compose
   (PostgreSQL+PostGIS, Node.js API, static React app). Photos on disk or S3-compatible.
5. Auth: email + password. 6. English only. 7. Google Earth imagery with Google credit.
Open: DEE approval of CC restoration? (comment in doc) - default Commissioner only.

## What the input files contain

| File | Content | Use |
|---|---|---|
| `Madhira_image_frames.kml` | 4 frame rectangles (A overview, B core/Zone1, C Zone3+4, D Zone2 Madupalli) + **22 ward boundaries** as closed LineStrings (WGS84) | Ward polygons, georef of imagery |
| `Google earth frames/Frame A-D.jpg` | 8192×5301 each; magenta KML rectangle visible in each image | Basemap; georef via detected rectangle |
| `UGD progress 30-09-26.xlsx` | Ward-wise Sanctioned / Executed / Balance for pipeline (Rmt), Manholes, ICs | Baseline KPIs |
| `4. Town Plan.pdf` | Road network, landmarks; 22 wards, 31.74 sq km, 116.32 km roads | Reference |
| `5. Ward Boundary Plan.pdf` | Ward map + ward area/population table | Cross-check KML |
| `6. Zonal Plan.pdf` | Zone boundaries, STP locations with lat/long, catchment table | Zone mapping, control points |
| Network plans Z1 (3 parts), Z2, Z3, Z4 | **Vector CAD exports**: every MH with ID, GL, IL; every pipe reach with length + dia + flow arrow | Extract real sewer network → GeoJSON |

Frame resolution (from detected rectangle): A ≈1.1 m/px, B ≈0.55 m/px, C ≈0.60 m/px, D ≈0.27 m/px. Pixels are square → linear georef OK.

## Zone ↔ Ward mapping (from Excel, confirmed by zonal plan areas)
- Zone 1: wards 1, 2, 8–22 (core town) — 75,576 m, 3,311 MH, 1,839 IC sanctioned
- Zone 2: wards 5, 6, 7 (Madupalli, west of Wyra river) — 13,241 m, 620 MH, 433 IC (one combined row)
- Zone 3: ward 3 — 4,396 m, 199 MH, 170 IC
- Zone 4: ward 4 — 6,347 m, 257 MH, 213 IC
- Total: 99,560 m / 4,387 MH / 2,655 IC sanctioned; executed 54,741.5 m (55%) / 1,976 MH (45%) / 491 IC (18.5%)

## Discrepancies to confirm with user
1. Excel names Zone 3/ward 3 "Yellandulapadu" and Zone 4/ward 4 "Ambarupeta". Zonal plan, ward plan, KML and
   network plans all show **Zone 3 = Ambarupet (east, ward 3)** and **Zone 4 = Yellandulapadu (south, ward 4)**.
2. Plan quantities ≠ sanctioned: Z2 plan ≈14.9 km/639 MH; Z3 plan ≈5.8 km/243 MH; Z4 plan ≈9.7 km/396 MH.
   Plans are marked "FOR APPROVAL". Zone 1 three sheets overlap (need dedupe by MH id).
3. Zone 1 IC executed = 344 of 1,839, most wards show 0 ICs — confirm.

## Label formats in network plans (for parser)
- Z2/Z4: `MH-123`, `GL-59.72 m`, `IL 55.44 m`, `L23 m`, `D-150mm`
- Z3: `L23.5` (decimal lengths), otherwise same
- Z1: `MH-1234`, `MH-1234/1`, `GL 59.49 m`, `IL 53.8 m`, `L-23`, `S-1/250` (slope), `D150mm`
- Pipe colours encode diameter (legend on each sheet). Text is extractable with PyMuPDF.

## Tooling
- Python venv with pymupdf, openpyxl, pillow, numpy in session scratchpad (recreate if lost).
- No GDAL installed; write own tiler (Web Mercator math) → PMTiles.

## Phase 1 results (2026-10-02) — pipeline/ scripts, outputs in data/processed
Run in order: `01_wards_zones_baseline.py`, `02_imagery_tiles.py`, `03_georef_plans.py`, `04_network.py`
(venv: `.venv`, `pip install pymupdf openpyxl pillow numpy shapely scipy pmtiles pyproj`). QA overlays: `qa_overlay.py FRAME [crop]` -> data/qa.
- Imagery: frames georeferenced from the burned-in KML rectangle; A 1.23, B 0.77, C 0.61, D 0.28 m/px; tiles in data/processed/tiles/frame_X.pmtiles (WebP, ~33 MB).
- Plans are in **UTM 44N (EPSG:32644)**. All network sheets share one CAD base map (labels match exactly),
  BUT each sheet draws its network at its own offset/scale from the base:
  - Z2, Z3, Z4: georeferenced from each sheet's own STP survey grid labels ("N 1870945"/"E 429810"), network-scale. Verified on imagery (Z2 sub-metre).
  - Z1P1 = reference; Z1P2, Z1P3 aligned to it on shared MH labels (rms 0.2-0.3 m); then whole Zone 1 shifted by
    one control point: PS-1 wet well = STP-1 grid centre (UTM 431820, 1870142.5 from key-plan grid labels), scale 1/1.0151
    from pipe-length labels. Control file: data/control/zone1_control.json. Verified on imagery (centre, Wyra Rd, NE colonies).
- Network: manholes = circle symbols; labels matched by optimal assignment; reaches rebuilt from length labels
  (99% agreement with drawn pipe bands in Z2). Zone 1 reuses MH numbers across parts -> ids like `Z1/MH-245#Z1P2`.
- Totals from plans: Z1 2686 MH / 88.7 km, Z2 639 / 15.0 km, Z3 248 / 6.1 km, Z4 396 / 10.0 km (differ from sanctioned - decision 2 pending).
- Zonal plan STP lat/longs for Z1/Z3/Z4 are approximate (65-500 m off survey grids); Z2 within 5 m.

## Phase 2 results (2026-10-02) — map approved by Commissioner ("map okay, cross checked")
- App: `server/` (Fastify, serves /data with Range + gzip, serves web/dist), `web/` (React 19 + Vite 8 + MapLibre 6 + pmtiles 4).
- MapLibre v6 gotchas: named exports; module worker -> vite.config copies maplibre-gl-worker.mjs + shared.mjs to
  public/vendor and MapView calls setWorkerUrl; MapLibre CSS sets .maplibregl-map{position:relative} (use .map-wrap > .map);
  StrictMode double-mount clears #map hash -> parse hash at module load.
- @fastify/static v10 setHeaders gets the Fastify reply (use reply.header).
- Glyphs self-hosted in web/public/glyphs (Noto Sans Regular/Bold, Latin ranges).
- Launch configs in .claude/launch.json (api :8080, web :5173). Accuracy report: docs/map-accuracy.md.
- Next: Phase 3 (stretch status model, colours, tags, issues) -> Phase 4 (auth email+password, roles, forms, audit, Postgres/PGlite).

## Phases 3-5 (2026-10-02) — built and tested locally
- New requirement from Commissioner: AEEs can add stretches / pipes / manholes and request deletions; all need
  Commissioner approval (change_requests + network_edits tables; admin's own changes apply at once).
- Server: Fastify + PostgreSQL (DATABASE_URL) or embedded PGlite (var/db). Routes in server/src/routes:
  users (auth email+password, bcrypt, JWT cookie, roles admin/editor/viewer, ward assignment), stretches
  (create/update/bulk/approve/reject/revert/delete, conflict detection, GPS distance flag >200 m, issue sync),
  issues, network (change requests), misc (photos on disk, activity, labour), reports (xlsx/kml/geojson/timeline).
- Shared logic (Node runs TS directly): shared/status.ts (18 items in 6 buckets, stages, themes, tags, validation),
  shared/geo.ts, shared/stats.ts (dashboard + Excel use the same figures).
- Web: login, map tools (pick pipes / draw line / place point / pick manholes / multi-select), StretchForm, panels,
  Issues, Approvals, Activity, Users, Dashboard (hero + tiles + meters + bars + weekly line + zone/ward table + ward
  report print), offline outbox (IndexedDB), PWA (manifest + sw.js), live updates via SSE.
- Tests: server/test/smoke.mjs (58 checks; passes on PGlite and on the pg driver via pglite-socket),
  server/test/demo-seed.mjs (local demo data), server/test/exports.mjs.
- Bug caught by pg-driver test: arrays into jsonb params must be JSON.stringify'd (node-postgres sends arrays as PG arrays).
- Local logins: var/dev-credentials.json (gitignored). Local DB has demo data + smoke-test leftovers; reset = delete var/db.
- Deployment: Dockerfile, docker-compose.yml (postgres + app + caddy HTTPS), deploy/backup.sh, .env.example, docs/DEPLOY.md.
  Docker image NOT built locally (no Docker on this Mac). Photos: disk volume only (no S3). One app instance (SSE in memory).
- Guides: docs/GUIDE-COMMISSIONER.md, docs/GUIDE-AEE.md.
- Next: Phase 6 = deploy on Commissioner's cloud (need VM access/domain), create real users, onboarding.

## v1.1 (2026-10-03) — field-testing feedback
- Pipes outside the KML ward outlines (582/3991, 15%; Z2 287, Z1 188, Z4 107; median 117 m, max 656 m) were refused
  by the phone app ("outside the municipal wards"). Now: nearest ward everywhere (shared/geo.ts `wardAt(p, wards)`,
  used by server and app), stretches carry `outside_ward`, Excel column "Outside ward boundary". Decision: nearest ward.
- `utilities.water_leaks_fixed` (like taps_restored); leak issue/badge use pending = leaks - fixed.
- Photos: required only for restoration claims; Report issue needs a remark (description), photo optional.
- Issues page: ward + status filters, filtered Excel `/api/export/issues.xlsx`.
- Storage page (admin): `/api/admin/storage*`, dry-run preview (tx rolled back), zip archive (yazl), purge with typed
  DELETE, log in `storage_purges` (migration 003). Decision: everything is deletable by the Commissioner.
- Tests: staging-test 83 checks (PGlite and pg driver); headless UI walk-through with puppeteer-core + system Chrome
  (scratchpad/uitest) when the Browser pane is hidden.
