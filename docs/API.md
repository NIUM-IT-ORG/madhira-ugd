# API reference

All endpoints are under the same origin as the web app. JSON in, JSON out. Except for sign-in, every
call needs the session cookie set by `POST /api/auth/login`. Every `POST`, `PATCH` and `DELETE` must send
the header `x-ugd: 1`. Errors return `{ "error": "message" }` with HTTP 400 (invalid), 401 (not signed in),
403 (not allowed / password change pending), 404, 409 (conflict) or 429 (too many sign-in attempts).

## Saves sent twice

`POST` and `PATCH` may carry `x-idempotency-key: <unique id>` (the phone app sends one per saved update and per
photo). If the same signed-in user sends the same key again, the first answer is returned and nothing is saved
twice (keys kept 30 days, table `request_keys`).

## Sign-in and users

| Method and path | Who | Purpose |
| --- | --- | --- |
| `POST /api/auth/login` `{email, password}` | anyone | Sign in; sets the session cookie |
| `POST /api/auth/logout` | anyone | Sign out |
| `GET /api/auth/me` | signed in | Current user |
| `POST /api/auth/password` `{current, next}` | signed in | Change own password (min 8 characters) |
| `GET /api/users` | signed in | Users (contact details only for admin) |
| `POST /api/users` | admin | Create user; returns a one-time password once |
| `PATCH /api/users/:id` | admin | Edit role, wards, active; `reset_password: true` returns a new one-time password |

## Map data

| Method and path | Purpose |
| --- | --- |
| `GET /data/<file>` | Reference files in `data/processed` (GeoJSON, JSON, PMTiles with Range support) |
| `GET /api/network` | Current sewer network `{pipes, manholes}` = plans + approved edits (ETag) |

## Road stretches

| Method and path | Who | Purpose |
| --- | --- | --- |
| `GET /api/stretches` | signed in | All stretches (GeoJSON FeatureCollection) |
| `GET /api/stretches/:id` | signed in | One stretch with full history and issues |
| `POST /api/stretches` `{name, geometry, pipe_ids, status, note, photos, gps}` | editor (ward), admin | Add; proposed until approved when added by an editor |
| `PATCH /api/stretches/:id` `{base_version, changes:[{path,to}], name?, geometry?, pipe_ids?, note, photos, gps}` | editor (ward), admin | Update; 409 if the same field changed since `base_version` |
| `POST /api/stretches/bulk` `{ids, changes, note}` | editor, admin | Same change on many stretches |
| `POST /api/stretches/:id/approve` / `reject` `{note}` | admin | Restoration approval (reject needs a note) |
| `POST /api/stretches/:id/revert` `{version}` | admin | Roll back to a version (recorded as a new version) |
| `DELETE /api/stretches/:id` `{reason}` | editor (request), admin (immediate) | Delete |

## Issues

| Method and path | Who | Purpose |
| --- | --- | --- |
| `GET /api/issues`, `GET /api/issues/:id` | signed in | List / one with events |
| `POST /api/issues` `{kind, location, stretch_id?, count, severity?, description, photos?}` | editor (ward), admin | Report (`description` = remark, required; photos optional) |
| `PATCH /api/issues/:id` `{status?, assigned_to?, due_date?, severity?, note, photos}` | editor (ward), admin | Assign / resolve (note required) / re-open |

## Change requests (network)

| Method and path | Who | Purpose |
| --- | --- | --- |
| `GET /api/change-requests?status=` | signed in | List |
| `POST /api/change-requests` `{entity, action, target_id?, payload?, reason}` | editor, admin | Propose add / delete of a pipe or manhole (admin's apply at once) |
| `POST /api/change-requests/:id/approve` / `reject` | admin | Decide |
| `POST /api/change-requests/:id/withdraw` | requester, admin | Withdraw |

Manhole `payload`: `{lon, lat, label, gl?, il?}`. Pipe `payload`: `{from, to, dia_mm, slope?, length_m?}`.

## Photos, activity, labour, reports

| Method and path | Purpose |
| --- | --- |
| `POST /api/photos` (multipart: `lat`, `lng`, `accuracy`, `taken_at`, then `file`) | Upload a JPEG/PNG/WebP (≤ `MAX_PHOTO_MB`); returns `{id}` |
| `GET /api/photos/:id` | Photo file (signed-in users only) |
| `GET /api/activity?limit=` | Recent changes across stretches, issues and requests |
| `GET /api/labour`, `POST /api/labour` `{log_date, ward, labourers, machines, note}` | Labour log |
| `GET /api/stats/timeline` | Weekly field figures for the dashboard |
| `GET /api/export/progress.xlsx` | Excel workbook (progress sheet + detail sheets) |
| `GET /api/export/issues.xlsx?kind=&zone=&ward=&severity=&status=` | Issues only, filtered as on the Issues page |
| `GET /api/export/stretches.kml`, `GET /api/export/stretches.geojson` | Google Earth / GIS exports |
| `GET /api/events` | Live updates (Server-Sent Events) |
| `GET /api/health` | `{ok, db}` for load balancers and monitoring (no sign-in) |

## Storage (Commissioner only)

| Method and path | Purpose |
| --- | --- |
| `GET /api/admin/storage` | Usage: database size, photos (count, bytes, by month), row counts, server disk, clean-up log |
| `POST /api/admin/storage/preview` `{categories, before}` | Exact counts and photo bytes a clean-up would delete (dry run, nothing changes) |
| `GET /api/admin/storage/archive?categories=a,b&before=YYYY-MM-DD` | Zip: `records.xlsx` (every record to be deleted) + `photos/` |
| `POST /api/admin/storage/purge` `{categories, before, confirm: "DELETE"}` | Delete; recorded in `storage_purges` |

Categories: `photos`, `history`, `resolved_issues`, `requests`, `removed_stretches`, `labour`, `audit`, `cleanup_log`.
`before` is a day in India time (everything before 00:00 IST of that day). Photos that nothing refers to after
the deletion are removed too (`unused_photos` in the summary).
