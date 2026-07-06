#!/usr/bin/env bash
# Starts both services for local production use:
#   1. VieNeu-TTS OpenAI-compatible server (port 8000)
#   2. horror-aids Next.js app (port 3000, or next free port)
# Stop both with Ctrl-C.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIENEU_DIR="${VIENEU_DIR:-$SCRIPT_DIR/../VieNeu-TTS}"
TTS_PORT="${TTS_PORT:-8000}"

if [ ! -d "$VIENEU_DIR" ]; then
  echo "VieNeu-TTS not found at $VIENEU_DIR (override with VIENEU_DIR=...)" >&2
  exit 1
fi

cleanup() {
  echo
  echo "Shutting down..."
  [ -n "${TTS_PID:-}" ] && kill "$TTS_PID" 2>/dev/null || true
  [ -n "${APP_PID:-}" ] && kill "$APP_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "[1/2] Starting VieNeu-TTS server on port $TTS_PORT..."
(cd "$VIENEU_DIR" && uv run python openai_compat_server.py --port "$TTS_PORT") &
TTS_PID=$!

echo "      Waiting for the TTS model to load (first run downloads it)..."
for _ in $(seq 1 120); do
  if curl -sf "http://127.0.0.1:$TTS_PORT/health" >/dev/null 2>&1; then
    echo "      TTS server ready."
    break
  fi
  if ! kill -0 "$TTS_PID" 2>/dev/null; then
    echo "TTS server exited unexpectedly." >&2
    exit 1
  fi
  sleep 2
done

echo "[2/2] Starting horror-aids app..."
(cd "$SCRIPT_DIR" && npm run dev) &
APP_PID=$!

echo
echo "Both services are running. Press Ctrl-C to stop."
wait "$APP_PID"
