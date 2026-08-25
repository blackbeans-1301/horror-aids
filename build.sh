#!/usr/bin/env bash
# Builds the horror-aids Next.js app and serves the production build on port 3300 (macOS),
# in the background. Re-running this script kills whatever instance it previously started
# and replaces it with a fresh one — you get your shell back immediately.
#
# Usage:
#   ./build.sh                 # install deps if needed, build, (re)start in background on :3300
#   ./build.sh --skip-build    # (re)start the existing .next build without rebuilding
#   ./build.sh --build-only    # build only, do not (re)start the server
#   PORT=3400 ./build.sh       # override the port
#
# Server logs:  .run/server.log
# Server PID:   .run/server.pid
# Stop it:      kill "$(cat .run/server.pid)"   (or just re-run ./build.sh)
#
# TTS runs via OmniVoice worker scripts spawned by the app itself
# (workers/*.py under workers/.venv) — no separate TTS server needed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-3300}"
HOSTNAME_BIND="${HOSTNAME_BIND:-0.0.0.0}"
VENV_PYTHON="$SCRIPT_DIR/workers/.venv/bin/python3"

RUN_DIR="$SCRIPT_DIR/.run"
PID_FILE="$RUN_DIR/server.pid"
LOG_FILE="$RUN_DIR/server.log"

SKIP_BUILD=0
BUILD_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --build-only) BUILD_ONLY=1 ;;
    -h|--help)    sed -n '2,17p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Unknown option: $arg (use --help)" >&2; exit 1 ;;
  esac
done

# --- environment checks -------------------------------------------------------

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is not installed. Try: brew install node" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Error: Next.js 15 needs Node >= 18 (found $(node -v))." >&2
  exit 1
fi

if [ ! -f .env.local ]; then
  echo "Warning: .env.local not found — copy .env.example and adjust it." >&2
fi

if [ ! -x "$VENV_PYTHON" ]; then
  echo "Warning: workers/.venv not found — TTS jobs will fail." >&2
elif ! "$VENV_PYTHON" -c "import omnivoice" 2>/dev/null; then
  echo "Warning: omnivoice is not installed in workers/.venv — TTS jobs will fail." >&2
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "Warning: ffmpeg not found — audio concat/verify steps will fail. Try: brew install ffmpeg" >&2
fi

# --- stop any previously started instance -------------------------------------

port_pids() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true
}

stop_previous() {
  if [ -f "$PID_FILE" ]; then
    OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
      echo "==> Stopping previous server (PID $OLD_PID)..."
      kill "$OLD_PID" 2>/dev/null || true
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        kill -0 "$OLD_PID" 2>/dev/null || break
        sleep 0.5
      done
      kill -0 "$OLD_PID" 2>/dev/null && kill -9 "$OLD_PID" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi

  # Fallback: anything else still holding the port (e.g. started outside this script).
  LEFTOVER="$(port_pids)"
  if [ -n "$LEFTOVER" ]; then
    echo "==> Port $PORT still busy (PID: $(echo "$LEFTOVER" | tr '\n' ' ')) — stopping it..."
    # shellcheck disable=SC2086
    kill $LEFTOVER 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      [ -z "$(port_pids)" ] && break
      sleep 0.5
    done
    STILL="$(port_pids)"
    if [ -n "$STILL" ]; then
      # shellcheck disable=SC2086
      kill -9 $STILL 2>/dev/null || true
      sleep 1
    fi
  fi
}

# --- install ------------------------------------------------------------------

if [ ! -d node_modules ]; then
  echo "==> Installing dependencies (npm ci)..."
  npm ci
elif [ package-lock.json -nt node_modules ]; then
  echo "==> package-lock.json changed — reinstalling dependencies (npm ci)..."
  npm ci
fi

# --- build --------------------------------------------------------------------
#
# `next build` overwrites .next/static in place with freshly-hashed chunk
# filenames, deleting the previous build's files. Any browser tab still
# holding the old page (or mid client-side navigation) will then 404/400 on
# those now-gone chunks -> ChunkLoadError. We stash the previous build's
# static assets and merge them back in after the new build so stale tabs can
# keep fetching old chunks until they naturally reload. Content hashes make
# filenames collision-free across builds, so this only ever adds files.
STATIC_CACHE="$RUN_DIR/static-chunk-cache"

if [ "$SKIP_BUILD" -eq 0 ]; then
  if [ -d .next/static ]; then
    mkdir -p "$STATIC_CACHE"
    echo "==> Preserving previous static chunks for in-flight clients..."
    cp -a .next/static/. "$STATIC_CACHE/" 2>/dev/null || true
  fi

  echo "==> Building production bundle (next build)..."
  NODE_ENV=production npm run build

  if [ -d "$STATIC_CACHE" ]; then
    echo "==> Restoring previous static chunks alongside the new build..."
    cp -an "$STATIC_CACHE/." .next/static/ 2>/dev/null || true
    # Keep the cache from growing forever: cap it at the last few builds' worth.
    find "$STATIC_CACHE" -type f -mtime +7 -delete 2>/dev/null || true
  fi
else
  if [ ! -d .next ]; then
    echo "Error: --skip-build given but no .next build exists. Run without --skip-build first." >&2
    exit 1
  fi
  echo "==> Skipping build, using existing .next"
fi

if [ "$BUILD_ONLY" -eq 1 ]; then
  echo "==> Build complete (--build-only, not starting the server)."
  exit 0
fi

# --- serve (background) --------------------------------------------------------
#
# Stop the old server only now, right before starting the new one, so the
# site stays up for the duration of the build instead of going dark early.

stop_previous

mkdir -p "$RUN_DIR"

echo "==> Starting production server in the background on http://localhost:$PORT"
nohup npx next start --hostname "$HOSTNAME_BIND" --port "$PORT" >"$LOG_FILE" 2>&1 &
SERVER_PID=$!
disown
echo "$SERVER_PID" >"$PID_FILE"

sleep 1
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "Error: server exited immediately — check $LOG_FILE" >&2
  rm -f "$PID_FILE"
  exit 1
fi

echo "==> Server running (PID $SERVER_PID). Logs: $LOG_FILE"
