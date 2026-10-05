# Deploying the Madhira UGD Tracker (any cloud or server)

For AWS, follow the step-by-step `docs/DEPLOY-AWS.docx` (also `docs/DEPLOY-AWS.md`). This page is the short
version for any Linux server with Docker.

The app is one Docker image (API server + web app + map data) plus a PostgreSQL database. It runs on any
cloud that can run Docker. The simplest route is one Linux virtual machine with Docker Compose, which
also gets a free HTTPS certificate automatically.

## What you need

| Item | Notes |
| --- | --- |
| A Linux VM | Ubuntu 22.04/24.04, 2 vCPU, 2 GB RAM, 40 GB disk is plenty (AWS Lightsail / EC2, Azure VM, Google Compute Engine, DigitalOcean, or a State Data Centre VM) |
| A domain name | e.g. `ugd.madhira.example.in`, with an A record pointing to the VM's public IP |
| Open ports | 80 and 443 (HTTP/HTTPS) in the cloud firewall / security group; 22 for SSH from your office only |

## First deployment (about 20 minutes)

1. Install Docker on the VM:
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER   # then log out and back in
   ```
2. Copy this project folder to the VM, e.g. to `/opt/madhira-ugd` (git clone, or `scp -r`). The folders
   that matter are `server/`, `web/`, `shared/`, `data/processed/`, `deploy/`, `Dockerfile`, `docker-compose.yml`.
   The folder name must be `madhira-ugd` (backup and restore commands assume it).
3. Create the settings file and fill it in:
   ```bash
   cd /opt/madhira-ugd
   cp .env.example .env
   nano .env
   ```
   - `DOMAIN`: the web address.
   - `DB_PASSWORD` and `JWT_SECRET`: long random strings (`openssl rand -hex 24` makes one).
4. Start everything:
   ```bash
   docker compose up -d --build
   docker compose logs -f app     # wait for "Server listening", then Ctrl+C
   ```
5. Check it: `docker compose exec app node server/test/postdeploy-check.mjs https://<DOMAIN>`.
6. Hand over the user guides (`docs/user-guides/*.docx`). The Commissioner, AEE, Field Inspector and contracting assistant accounts
   were created on first start; each person signs in with the one-time password in their guide and sets
   their own password.

## Updating to a new version

```bash
cd /opt/madhira-ugd
# copy in the new files (git pull, or scp), then:
docker compose up -d --build
```
Database changes are applied automatically at start-up. Records, history and photos are kept in Docker
volumes (`db`, `uploads`) and survive updates.

## Backups

`deploy/backup.sh` dumps the database and archives the photos into `backups/`, keeping 30 days. Run it
nightly with cron:
```bash
crontab -e
# add:
30 1 * * * cd /opt/madhira-ugd && sh deploy/backup.sh >> backups/backup.log 2>&1
```
Copy the `backups/` folder off the VM regularly (or use the cloud's VM snapshot feature as well).

Restore a database dump:
```bash
docker compose exec -T db pg_restore -U ugd -d ugd --clean < backups/db-YYYY-MM-DD.dump
```

## Other ways to host

| Option | How |
| --- | --- |
| Managed PostgreSQL (AWS RDS, Azure Database for PostgreSQL, Cloud SQL) | Remove the `db` service from `docker-compose.yml` and set `DATABASE_URL` to the managed database's connection string. Any PostgreSQL 13+ works; no extensions are needed. |
| Container services (Azure Container Apps, AWS App Runner / ECS, Google Cloud Run) | Build and push the image (`docker build -t madhira-ugd .`), run it with the environment variables below, and give it a persistent volume mounted at `/var/lib/ugd` for photos. These platforms terminate HTTPS for you, so Caddy is not needed. Run one instance (live updates are kept in process memory). |
| Existing web server (nginx) | Proxy to port 8080 and switch off buffering for `/api/events` (`proxy_buffering off;`). |

## Settings (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | none (embedded database) | PostgreSQL connection string; always set this in production |
| `JWT_SECRET` | generated into `VAR_DIR` | Signs sign-in sessions |
| `INITIAL_USERS_FILE` | `deploy/initial-users.json` | Starting accounts (hashed one-time passwords), used only when there are no users |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | — | Alternative single first administrator, if the initial-users file is removed |
| `COOKIE_SECURE` | `true` in production | Requires HTTPS for sign-in cookies |
| `VAR_DIR` | `/var/lib/ugd` in the image | Photos (`uploads/`) and generated secrets |
| `MAX_PHOTO_MB` | 8 | Largest photo accepted (phones compress photos before upload) |
| `FAR_THRESHOLD_M` | 200 | Updates made further than this from the stretch are flagged |
| `SESSION_DAYS` | 14 | How long a sign-in lasts |
| `TIME_ZONE` | Asia/Kolkata | Dates on reports |
| `PORT` | 8080 | Port the app listens on |

## Security notes

- All data, including the map imagery, requires sign-in. Passwords are stored as bcrypt hashes;
  repeated wrong passwords are blocked for 15 minutes.
- Disabling a user or resetting their password signs them out everywhere.
- Every change is kept with who, when and where; nothing is deleted from history.
- The Google Earth imagery is for internal municipal use with the Google credit shown on the map.

## Trying it on a laptop (no Docker)

```bash
cd server && npm install && cd ../web && npm install && npm run build && cd ..
node server/src/index.js     # http://localhost:8080, embedded database in ./var
```
The starting accounts are created from `deploy/initial-users.json` (passwords in the user guides).
