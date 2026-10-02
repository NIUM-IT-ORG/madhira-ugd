# Operations runbook

Commands assume the Docker Compose deployment in `/opt/madhira-ugd` (see `DEPLOY-AWS` or `DEPLOY-GENERIC`).

## Daily health

```bash
cd /opt/madhira-ugd
docker compose ps                       # all three services "running (healthy)"
curl -s https://<DOMAIN>/api/health     # {"ok":true,"db":"postgres",...}
docker compose exec app node server/test/postdeploy-check.mjs https://<DOMAIN>   # read-only, safe on the live system
```

Logs: `docker compose logs --since 1h app` (one JSON line per request; errors have `"level":50`).

## Backups

- Nightly `deploy/backup.sh` (cron) writes `backups/db-YYYY-MM-DD.dump` and `backups/photos-YYYY-MM-DD.tgz`
  and keeps 30 days. Copy the folder off the server (or rely on server snapshots as a second copy).
- Test a restore every few months on a spare server.

**Restore the database:**
```bash
docker compose stop app
docker compose exec -T db pg_restore -U ugd -d ugd --clean --if-exists < backups/db-YYYY-MM-DD.dump
docker compose start app
```
**Restore photos:**
```bash
docker run --rm -v madhira-ugd_uploads:/data -v "$PWD/backups:/in" alpine sh -c "cd /data && tar xzf /in/photos-YYYY-MM-DD.tgz"
```

## Updating to a new release

```bash
cd /opt/madhira-ugd
git pull                     # or copy in the new release files
docker compose up -d --build # rebuilds the app; database changes apply automatically at start-up
docker compose exec app node server/test/postdeploy-check.mjs https://<DOMAIN>
```
Take a backup first (`sh deploy/backup.sh`). Roll back by checking out the previous release tag
(`git checkout v1.0`) and running `docker compose up -d --build` again.

## People and access

The Commissioner manages users in the app (**Users** page): add, change wards or role, reset password
(gives a one-time password), disable. If the Commissioner is locked out, reset the password from the server:
```bash
docker compose exec db psql -U ugd -d ugd -c \
 "update users set password_hash = '<bcrypt hash>', must_change_password = true, token_version = token_version + 1 where email = 'commissioner@madhira.local';"
```
Make the bcrypt hash with:
`docker compose exec app node -e "console.log(require('/app/server/node_modules/bcryptjs').hashSync(process.argv[1], 10))" '<new one-time password>'`

## Secrets

| Secret | Where | To change |
| --- | --- | --- |
| `DB_PASSWORD` | `.env` | Change in Postgres (`alter user ugd password '…'`) and `.env`, then `docker compose up -d` |
| `JWT_SECRET` | `.env` | Edit `.env`, `docker compose up -d`; everyone is signed out |
| User passwords | database (bcrypt) | In the app |

## Updating the progress-sheet baseline

When a new monthly progress Excel is issued, in the same layout:
```bash
cp "<new sheet>.xlsx" data/raw/UGD_progress_30-09-26.xlsx      # or edit the file name in pipeline/01_*.py
python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
cd pipeline && ../.venv/bin/python 01_wards_zones_baseline.py && ../.venv/bin/python 05_web_extras.py && cd ..
# set BASELINE_DATE in pipeline/01_wards_zones_baseline.py to the sheet's date first
git commit -am "Progress baseline <date>" && docker compose up -d --build
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Site does not open | `docker compose ps`; DNS points at the server; ports 80/443 open; `docker compose logs caddy` for certificate errors |
| "Please sign in" loops | Server clock (`date`) correct; `JWT_SECRET` unchanged; browser accepts cookies |
| Map shows no imagery | `postdeploy-check` imagery lines; a proxy in front must pass `Range` requests and not re-compress `.pmtiles` |
| Live updates do not arrive | A proxy in front must not buffer `/api/events` (Caddy config already handles this) |
| Photo upload fails | Disk space (`df -h`); photo larger than `MAX_PHOTO_MB` |
| "Someone else changed this stretch" | Expected when two people edit the same field at once; reopen the stretch and save again |
| Disk filling up | Photos grow ~1–3 GB per year at normal use; old backups are pruned after 30 days |
