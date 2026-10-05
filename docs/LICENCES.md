# Licences and data terms

## Software that runs in production

| Component | Version | Licence |
| --- | --- | --- |
| Node.js | 24 | MIT |
| Fastify, @fastify/compress, @fastify/cookie, @fastify/multipart, @fastify/static | 5.x | MIT |
| pg (node-postgres) | 8.23 | MIT |
| @electric-sql/pglite (embedded database, trials only) | 0.5 | Apache-2.0 |
| bcryptjs | 3.0 | BSD-3-Clause |
| jsonwebtoken | 9.0 | MIT |
| zod | 4.6 | MIT |
| exceljs | 4.4 | MIT |
| yazl (zip archives on the Storage page) | 3.3 | MIT |
| React, React DOM | 19.3 | MIT |
| MapLibre GL JS | 6.11 | BSD-3-Clause |
| PMTiles (JavaScript) | 4.5 | BSD-3-Clause |
| PostgreSQL | 17 | PostgreSQL Licence |
| Caddy | 2 | Apache-2.0 |
| Noto Sans glyphs (map labels) | — | SIL Open Font Licence 1.1 |

Full licence texts are inside each package (`server/node_modules/<name>/LICENSE`, `web/node_modules/…`)
after `npm ci`.

## Data-preparation tools (not deployed)

The `pipeline/` scripts use Python packages listed in `pipeline/requirements.txt`: openpyxl (MIT), Pillow
(HPND), NumPy (BSD-3), SciPy (BSD-3), Shapely (BSD-3), pmtiles (BSD-3), pyproj (MIT) and **PyMuPDF
(AGPL-3.0 or commercial)**. They are used only to prepare the map data on an office machine; they are not
part of the deployed application.

## Data

| Data | Source | Terms |
| --- | --- | --- |
| Satellite imagery (frames A–D and tiles) | Google Earth, captured by the municipality | Internal municipal use; the credit "Imagery © Google Earth" must stay visible on the map. Not for publication on a public website. |
| Background imagery outside the frames | Esri World Imagery (loaded live from Esri) | Credit "Esri, Maxar" shown on the map; Esri terms of use |
| Network plans, ward / zonal / town plans, progress sheet | Madhira Municipality / PHED and their consultants | Property of the municipality |
| Map data derived from them (`data/processed`) | Produced for the municipality | Property of the municipality |
