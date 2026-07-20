#!/usr/bin/env bash
# Starts the horror-aids Next.js app (port 3000, or next free port).
# TTS runs via OmniVoice worker scripts spawned by the app itself
# (workers/*.py under workers/.venv) — no separate TTS server needed.
# Stop with Ctrl-C.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_PYTHON="$SCRIPT_DIR/workers/.venv/bin/python3"

if [ ! -x "$VENV_PYTHON" ]; then
  echo "Warning: workers/.venv not found — TTS jobs will fail." >&2
elif ! "$VENV_PYTHON" -c "import omnivoice" 2>/dev/null; then
  echo "Warning: omnivoice is not installed in workers/.venv — TTS jobs will fail." >&2
fi

echo "Starting horror-aids app..."
cd "$SCRIPT_DIR"
exec npm run dev
