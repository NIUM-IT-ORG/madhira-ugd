#!/bin/sh
# Builds release/madhira-ugd-trial-<version>.zip: a self-contained local trial for macOS (needs only Node.js 24+).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-v1.0}"
WORK="$(mktemp -d)"
NAME="madhira-ugd-trial-$VERSION"
git -C "$ROOT" archive --format=tar HEAD | tar -x -C "$WORK"
cd "$WORK"
(cd web && npm ci --no-audit --no-fund && npm run build)
(cd server && npm ci --omit=dev --no-audit --no-fund)
OUT="$WORK/$NAME"
mkdir -p "$OUT/server" "$OUT/web" "$OUT/data" "$OUT/trial"
cp -R server/src server/test server/package.json server/package-lock.json server/node_modules "$OUT/server/"
cp -R shared "$OUT/"
cp -R web/dist "$OUT/web/"
cp -R data/processed "$OUT/data/"
cp trial/accounts.json "$OUT/trial/"
cp trial/start.command trial/reset.command trial/README.txt "$OUT/"
mkdir -p "$ROOT/release"
rm -f "$ROOT/release/$NAME.zip"
(cd "$WORK" && zip -q -r -X -9 "$ROOT/release/$NAME.zip" "$NAME")
rm -rf "$WORK"
ls -la "$ROOT/release/$NAME.zip"
