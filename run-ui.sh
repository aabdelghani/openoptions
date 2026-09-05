#!/usr/bin/env bash
# Run the Electron UI (expects the agent to be running).
set -e
cd "$(dirname "$0")/ui"
[ -d node_modules ] || npm install --no-audit --no-fund
exec ./node_modules/.bin/electron . --class=OpenOptions "$@"
