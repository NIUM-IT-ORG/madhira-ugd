#!/bin/bash
# Madhira UGD Tracker - local trial. Double-click (or run in Terminal) to start; close the window to stop.
cd "$(dirname "$0")"
PORT="${PORT:-8080}"
pause() { read -r -p "Press Enter to close this window." _; }

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version (24 or newer) from https://nodejs.org and try again."
  pause; exit 1
fi
MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$MAJOR" -lt 24 ]; then
  echo "Node.js $(node -v) is too old. Install the LTS version (24 or newer) from https://nodejs.org."
  pause; exit 1
fi
if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use (is the trial already running?). Open http://localhost:$PORT"
  echo "or start on another port:  PORT=8090 ./start.command"
  pause; exit 1
fi

export PORT LOG_LEVEL=warn
export VAR_DIR="$PWD/trial-data"                  # trial database and photos (delete to start fresh)
export DATA_DIR="$PWD/data/processed"
export WEB_DIR="$PWD/web/dist"
export INITIAL_USERS_FILE="$PWD/trial/accounts.json"
FIRST=0; [ -d "$VAR_DIR/db" ] || FIRST=1

echo "Starting the Madhira UGD Tracker (local trial) on http://localhost:$PORT ..."
node server/src/index.js &
PID=$!
trap 'echo; echo "Stopping..."; kill $PID 2>/dev/null; wait $PID 2>/dev/null; exit 0' INT TERM HUP

for _ in $(seq 1 60); do
  curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break
  if ! kill -0 $PID 2>/dev/null; then echo "The server stopped unexpectedly (see messages above)."; pause; exit 1; fi
  sleep 1
done

if [ "$FIRST" = 1 ]; then
  echo "First start: loading sample data (road stretches in every stage, issues, approvals)..."
  SEED_EMAIL=commissioner@trial.local SEED_PASSWORD=trial-commissioner \
  SEED_AEE_EMAIL=aee@trial.local SEED_AEE_PASSWORD=trial-aee \
    node server/test/demo-seed.mjs "http://localhost:$PORT" >/dev/null && echo "Sample data loaded."
fi

[ -z "$NO_OPEN" ] && open "http://localhost:$PORT" 2>/dev/null
cat <<MSG

  Madhira UGD Tracker is running:  http://localhost:$PORT

  Sign in as
    Commissioner     commissioner@trial.local   /  trial-commissioner
    AEE              aee@trial.local            /  trial-aee
    Field Inspector  inspector@trial.local      /  trial-inspector

  To stop: close this window (or press Ctrl+C).
MSG
wait $PID
