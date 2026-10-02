# Architecture

```
 Phones (AEE, Field Inspector)        Office PC (Commissioner)        Viewers
            │  installable web app (PWA), GPS, camera, offline outbox
            └───────────────┬──────────────────────────────┘
                            ▼  HTTPS (443)
                    Caddy  (TLS certificate, reverse proxy)          ← any proxy / load balancer works
                            ▼  HTTP 8080
          ┌──────────── app container (Node.js 24) ─────────────┐
          │ Fastify API server                                   │
          │  • sign-in (email + password, bcrypt, JWT cookie)    │
          │  • role + ward checks on every request               │
          │  • validation (shared/status.ts), history, approvals │
          │  • live updates to open browsers (Server-Sent Events)│
          │  • Excel / KML / GeoJSON exports                     │
          │ Static files: built web app (React + MapLibre)       │
          │ Reference data: map tiles (PMTiles) + GeoJSON        │
          └───────┬───────────────────────────────┬──────────────┘
                  ▼                               ▼
        PostgreSQL 13+ (records)        Disk volume /var/lib/ugd (photos)
```

| Part | Technology | Notes |
| --- | --- | --- |
| Web app | React 19, TypeScript, Vite, MapLibre GL 6, PMTiles | Built to static files in `web/dist`; served by the app server |
| API server | Node.js 24, Fastify 5 | `server/src`; runs TypeScript in `shared/` natively |
| Shared rules | `shared/status.ts`, `shared/stats.ts`, `shared/geo.ts` | Same validation and figures in the browser and the server |
| Database | PostgreSQL 13+ (17 in compose); no extensions | Embedded PGlite is used only when `DATABASE_URL` is unset (laptop trials) |
| Photos | Files on a mounted volume | Phones shrink photos to ≤1600 px JPEG before upload |
| Map data | PMTiles + GeoJSON in the image | Read-only; produced by `pipeline/` |
| HTTPS | Caddy 2 (Let's Encrypt) | Replaceable by an ALB, nginx or any TLS proxy |

## Request flow for a field update

1. The AEE's phone sends the change (only the fields that changed, with the version it started from),
   photos first, with GPS.
2. The server checks the session, the role and the ward, validates the values with the shared rules,
   and checks for a conflicting edit since that version.
3. In one database transaction it updates the stretch, writes a new `stretch_versions` row (who, when,
   old → new, GPS distance) and opens or closes the matching issues.
4. It broadcasts an event; every open browser refetches just what changed.

If the phone has no signal, the change and its photos wait in the phone's IndexedDB outbox and are sent
automatically later.

## Security model

- Everything except the sign-in page needs a session cookie (`HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS).
- State-changing requests must carry the header `x-ugd: 1` (blocks cross-site form posts).
- One-time passwords must be replaced before any other request is allowed.
- Roles: `admin` everything; `editor` writes only in assigned wards; `viewer` read only. Enforced on the server.
- Additions and deletions of stretches, pipes and manholes by editors become change requests for the admin.
- History rows are append-only. Deletions are soft (the record and its history remain).
- 8 failed sign-ins per email and IP within 15 minutes are blocked.

## Scaling

One app container comfortably serves a municipality (tens of users). Live updates are held in process
memory, so run a single app instance. The database and photo volume can live on managed services.
