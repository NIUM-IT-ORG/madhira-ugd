#!/bin/sh
# Nightly backup: database dump + photos, kept for 30 days. Run from the folder with docker-compose.yml:
#   crontab -e   ->   30 1 * * * cd /opt/madhira-ugd && sh deploy/backup.sh >> backups/backup.log 2>&1
set -e
STAMP=$(date +%Y-%m-%d)
mkdir -p backups
docker compose exec -T db pg_dump -U ugd -d ugd --format=custom > "backups/db-$STAMP.dump"
docker run --rm -v "$(basename "$PWD")_uploads:/data:ro" -v "$PWD/backups:/out" alpine tar czf "/out/photos-$STAMP.tgz" -C /data uploads 2>/dev/null || true
find backups -name 'db-*.dump' -mtime +30 -delete
find backups -name 'photos-*.tgz' -mtime +30 -delete
echo "$STAMP backup done"
