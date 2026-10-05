# Data dictionary

## 1. Reference map data (`data/processed/`, read-only, served to signed-in users)

| File | Format | Contents |
| --- | --- | --- |
| `wards.geojson` | GeoJSON, EPSG:4326 | 22 ward polygons |
| `zones.geojson` | GeoJSON | 4 zone polygons |
| `labels.geojson` | GeoJSON points | Label positions for wards and zones |
| `pipes.geojson` | GeoJSON lines | 3,991 sewer reaches from the plans |
| `manholes.geojson` | GeoJSON points | 3,969 manholes from the plans |
| `baseline.json` | JSON | Progress sheet of 30-09-2026 (sanctioned and executed per ward group) |
| `imagery.json` | JSON | Imagery frames: bounds, pixel size, zoom range, file |
| `frames.json` | JSON | KML frame rectangles |
| `tiles/frame_A–D.pmtiles` | PMTiles (WebP tiles, EPSG:3857) | Satellite imagery |
| `map_meta.json` | JSON | Initial map bounds |
| `plan_georef.json`, `network_report.json` | JSON | Georeferencing parameters and extraction report |

### Ward (`wards.geojson` properties)

| Field | Type | Meaning |
| --- | --- | --- |
| `ward` | integer 1–22 | Ward number (also the feature id) |
| `zone` | integer 1–4 | Zone |
| `zone_name` | text | e.g. "Zone 3 - Ambarupeta" |
| `locality` | text | Area of working from the progress sheet |
| `area_ha` | number | Polygon area in hectares |

### Manhole (`manholes.geojson` properties)

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | text | Unique id, `Z<zone>/<label>`; Zone 1 duplicates get `#Z1P2` / `#Z1P3` |
| `label` | text | Number as on the plan, e.g. `MH-1472` (null if unreadable) |
| `zone`, `ward` | integer | Zone (from the plan sheet) and ward (from location) |
| `gl`, `il` | number (m) | Ground level and invert level; depth = gl − il |
| `sheets` | text[] | Plan sheets the manhole appears on |
| `label_dist` | number | Label-to-symbol distance (quality indicator) |
| `outside_boundary` | boolean | Lies outside the KML ward outlines |

### Pipe reach (`pipes.geojson` properties)

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | text | `P<zone>-<n>`; reaches added in the field are `P<zone>-F<n>` |
| `from`, `to` | text | Manhole ids, upstream → downstream (flow from higher invert level) |
| `from_label`, `to_label` | text | Manhole numbers |
| `length_m` | number | Length used (plan label if present, else drawn) |
| `len_label_m`, `len_geom_m` | number | Length on the plan label / measured on the map |
| `dia_mm` | integer | Diameter (150–700 mm); `dia_inferred` if taken from the drawing colour |
| `slope` | text | e.g. `1/150` |
| `zone`, `ward` | integer | Zone and ward |
| `source`, `sheet` | text | `label` / `band` / `field`; plan sheet |

### Baseline group (`baseline.json` → `groups[]`)

One entry per progress-sheet row (Zone 2's wards 5, 6, 7 are one row): `zone`, `wards[]`, `locality`,
`sanctioned {pipe_m, manholes, ics}`, `executed {pipe_m, manholes, ics}`. Pipe lengths in running metres.

## 2. Stretch status (JSON stored in `stretches.status`)

| Bucket | Field | Values |
| --- | --- | --- |
| A Sewer work | `sewer.pipeline` | `not_started`, `partial`, `laid` |
| | `sewer.pipe_laid_m` | number (when partial) |
| | `sewer.manholes_built`, `sewer.ics_built` | integer ≥ 0 |
| B Road cutting | `excavation.stage` | `none`, `road_cut`, `trench_open`, `backfilled` |
| | `excavation.cut_length_m` | number |
| C CC restoration | `restoration.stage` | `not_due`, `pending`, `restored_curing_pending`, `restored_curing_done` |
| D Motorability | `motorable` | `yes`, `difficult`, `no` |
| E Utilities | `utilities.taps_broken`, `utilities.taps_restored`, `utilities.water_leaks`, `utilities.water_leaks_fixed` | integer ≥ 0 (restored ≤ broken, fixed ≤ leaks; pending = the difference) |
| | `utilities.drain_clogged` | boolean |
| F Hazards | `hazards.water_stagnation`, `hazards.uneven_backfill` | boolean |
| | `hazards.potholes` | integer ≥ 0 |

**Derived stage** (map colour): `not_started` grey · `in_progress` blue · `backfilled` orange ·
`curing` yellow · `awaiting_approval` light green · `approved` green (restored, cured and approved).
**Approval:** `none`, `pending` (curing done), `approved`, `rejected`. Rules are in `shared/status.ts`.

## 3. Database (PostgreSQL; schema in `server/src/migrations/`, applied automatically at start-up)

| Table | One row per | Key columns |
| --- | --- | --- |
| `users` | person | `email` (sign-in), `name`, `designation`, `role` (`admin`/`editor`/`viewer`), `supervisor` (AEE: corrects others' labour), `all_wards`, `wards[]`, `active`, `must_change_password`, `password_hash` (bcrypt), `token_version` |
| `stretches` | road stretch (current state) | `code` (W9-012), `name`, `ward`, `zone`, `geometry` (GeoJSON), `length_m`, `pipe_ids[]`, `planned_mh`, `status` (JSON, §2), `approval`, `stage`, `open_issues`, `version`, `record_state` (`proposed`/`active`/`rejected`), `deleted_at` |
| `stretch_versions` | change to a stretch (never changed; older entries can be deleted by the Commissioner on the Storage page, the latest is always kept) | `stretch_id`, `version`, `kind` (create/update/bulk/approve/reject/revert/geometry/delete/issue_resolved), `user_id`, `at`, `changes` (field, from, to), `status` (full snapshot), `note`, `photos[]`, `gps`, `gps_distance_m`, `flagged_far`, `warnings`, `batch_id` |
| `issues` | problem | `code` (I-0001), `kind`, `stretch_id`, `ward`, `location` [lon, lat], `count`, `severity`, `status` (open/assigned/resolved), `assigned_to`, `due_date`, `photos[]`, `source` (manual/stretch), reporter / resolver and times, `resolution_note` |
| `issue_events` | change to an issue | `issue_id`, `user_id`, `at`, `action`, `changes`, `note` |
| `photos` | uploaded photo | `path` (under `VAR_DIR/uploads`), `mime`, `bytes`, `lat`, `lng`, `accuracy`, `taken_at`, `uploaded_by` |
| `change_requests` | proposed addition / deletion | `code` (CR-0001), `entity` (stretch/pipe/manhole), `action` (add/delete), `target_id`, `payload`, `reason`, `status` (pending/approved/rejected/withdrawn), requester / decider, `decision_note` |
| `network_edits` | approved network change | `kind` (pipe/manhole), `feature_id`, `op` (add/delete), `geometry`, `properties`, `change_request_id` — applied in order over the plan network at start-up |
| `labour_entries` | zone per day (v1.2) | `log_date`, `zone`, `labourers`, `machines`, `note`, `user_id` (entered by), `created_at` (48-hour edit window), `updated_by`, `updated_at`, `legacy_wards` (converted from v1.1 ward records) |
| `labour_entry_events` | change to a labour entry | `entry_id`, `user_id`, `at`, `action` (create/edit), `changes` |
| `labour_logs` | ward per day (v1.0–v1.1; kept unchanged, no longer used) | `log_date`, `ward`, `labourers`, `machines`, `note` |
| `starting_accounts` | starting account already created | `key` (e.g. `assistant1`): a release adds accounts from `deploy/initial-users.json` once, never re-creating one |
| `audit_log` | sign-in, user and admin action | `at`, `user_id`, `action`, `entity`, `entity_id`, `detail`, `ip` |
| `counters` | code sequence | `name`, `value` |
| `request_keys` | answered save (30 days) | `key`, `user_id`, `status`, `body`, `at`: a resent save gets the first answer |
| `storage_purges` | clean-up on the Storage page | `at`, `user_id`, `before_date`, `categories[]`, `summary` (rows and bytes per category), `bytes_freed` |

## 4. Files on disk

| Path (in the container) | Contents | Back up? |
| --- | --- | --- |
| `/var/lib/ugd/uploads/YYYY/MM/<uuid>.jpg` | Site photos (≈150–400 KB each after phone compression) | **Yes** |
| PostgreSQL data (Docker volume `db`) | All records | **Yes** (nightly `pg_dump`) |
| `/app/data/processed` | Reference map data | No (in the release) |
