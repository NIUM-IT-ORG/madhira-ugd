# Madhira UGD Tracker — release v1.1

Web app for tracking the Underground Drainage scheme of Madhira Municipality: a satellite map of the
sewer network road by road, field updates from the AEE and Field Inspector, approvals and progress
dashboards for the Commissioner.

**This folder is everything needed to deploy and run it**: source code, the container recipe, all map data
(satellite imagery tiles, wards, zones, sewer network, progress baseline), the original source files, and
the documentation. Nothing else has to be downloaded except public software packages during the build.

## Start here

| You are | Read |
| --- | --- |
| IT team deploying on AWS | `docs/DEPLOY-AWS.docx` (Git repository + one EC2 server, step by step) |
| IT team deploying elsewhere | `docs/DEPLOY-GENERIC.md` (any Linux server or cloud with Docker) |
| Commissioner | `docs/user-guides/Commissioner-Guide.docx` |
| AEE and Field Inspector | `docs/user-guides/AEE-and-Field-Inspector-Guide.docx` |
| AEE, every task tap by tap | `docs/user-guides/AEE-Step-by-Step-Guide.docx` (also `.pdf` for the phone) |
| Developers / GIS staff | `docs/ARCHITECTURE.md`, `docs/DATA-DICTIONARY.md`, `docs/IMAGERY-AND-GEOREFERENCING.md`, `docs/API.md` |
| Running it day to day | `docs/OPERATIONS.md`, `docs/UAT-CHECKLIST.md` |
| What changed | `docs/RELEASE-NOTES.md` |

## Deploy in brief (any server with Docker)

```bash
cp .env.example .env        # set DOMAIN, DB_PASSWORD, JWT_SECRET
docker compose up -d --build
docker compose exec app node server/test/postdeploy-check.mjs https://<DOMAIN>
```

## Contents

| Path | What |
| --- | --- |
| `server/`, `web/`, `shared/` | Source code (Node.js 24 API server, React + MapLibre web app, shared rules) |
| `Dockerfile`, `docker-compose.yml`, `.env.example`, `deploy/` | Deployment: container image, PostgreSQL + app + Caddy (HTTPS), backup script, starting accounts |
| `data/processed/` | Map data served by the app (≈35 MB) |
| `data/raw/` | Original files: Google Earth frames, KML, network and town plans (PDF), progress Excel (≈91 MB) |
| `data/control/` | Control point used to place the Zone 1 network |
| `pipeline/` | Python scripts that produced `data/processed` from `data/raw` |
| `docs/` | Guides and technical documentation |
| `server/test/` | `postdeploy-check.mjs` (read-only, safe on the live system); `staging-test.mjs` and `demo-seed.mjs` (test copies only) |

## Accounts

Three accounts are created on the first start, from `deploy/initial-users.json` (passwords stored only as
bcrypt hashes): **Commissioner** (admin), **AEE** and **Field Inspector** (editors, all 22 wards). Their
one-time passwords are printed in the user guides; each must be changed at first sign-in, after which the
printed password no longer works. Treat this package as confidential until all three have signed in.

## Handover checklist

- [ ] Package checksum verified (`SHA256SUMS.txt`)
- [ ] Folder committed and pushed to the municipality's private Git repository; tag `v1.1` (deployment guide, Part A; upgrading from v1.0: part B14)
- [ ] Site live on HTTPS; post-deploy check passes
- [ ] Commissioner, AEE and Field Inspector have signed in and set their own passwords
- [ ] Nightly backups and disk snapshots running; one restore tested
- [ ] Acceptance checklist (`docs/UAT-CHECKLIST.md`) signed off
