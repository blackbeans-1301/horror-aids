#!/usr/bin/env bash
# Builds the horror-aids Next.js app and serves the production build on port 3300 (macOS).
#
# Usage:
#   ./build.sh                 # install deps if needed, build, then start on :3300
#   ./build.sh --skip-build    # start the existing .next build without rebuilding
#   ./build.sh --build-only    # build only, do not start the server
#   ./build.sh --restart       # kill whatever already listens on :3300 first
#   PORT=3400 ./build.sh       # override the port
#
# TTS runs via OmniVoice worker scripts spawned by the app itself
# (workers/*.py under workers/.venv) — no separate TTS server needed.
# Stop with Ctrl-C.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-3300}"
HOSTNAME_BIND="${HOSTNAME_BIND:-0.0.0.0}"
VENV_PYTHON="$SCRIPT_DIR/workers/.venv/bin/python3"

SKIP_BUILD=0
BUILD_ONLY=0
RESTART=0

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --build-only) BUILD_ONLY=1 ;;
    --restart)    RESTART=1 ;;
    -h|--help)    sed -n '2,14p' "${BASH_SOURCE[0]}"; exit 0 ;;
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

# --- port ---------------------------------------------------------------------

port_pids() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true
}

EXISTING_PIDS="$(port_pids)"
if [ -n "$EXISTING_PIDS" ]; then
  if [ "$RESTART" -eq 1 ]; then
    echo "Port $PORT busy (PID: $(echo "$EXISTING_PIDS" | tr '\n' ' ')) — stopping it..."
    # shellcheck disable=SC2086
    kill $EXISTING_PIDS 2>/dev/null || true
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
  elif [ "$BUILD_ONLY" -eq 0 ]; then
    echo "Error: port $PORT is already in use by PID $(echo "$EXISTING_PIDS" | tr '\n' ' ')." >&2
    echo "       Re-run with --restart to replace it, or set PORT=<other>." >&2
    exit 1
  fi
fi

# --- install ------------------------------------------------------------------

if [ ! -d node_modules ]; then
  echo "==> Installing dependencies (npm ci)..."
  npm ci
elif [ package-lock.json -nt node_modules ]; then
  echo "==> package-lock.json changed — reinstalling dependencies (npm ci)..."
  npm ci
fi

# --- build --------------------------------------------------------------------

if [ "$SKIP_BUILD" -eq 0 ]; then
  echo "==> Building production bundle (next build)..."
  NODE_ENV=production npm run build
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

# --- serve --------------------------------------------------------------------

echo "==> Starting production server on http://localhost:$PORT"
exec npx next start --hostname "$HOSTNAME_BIND" --port "$PORT"
