#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
USAGE_FILE="$SCRIPT_DIR/USAGE.md"

echo "discussion-logger usage quick check"
echo "USAGE file: $USAGE_FILE"

if [ ! -f "$USAGE_FILE" ]; then
  echo "ERROR: USAGE.md not found"
  exit 1
fi

if ! grep -q "USAGE:START" "$USAGE_FILE"; then
  echo "ERROR: missing USAGE:START marker"
  exit 1
fi

if ! grep -q "USAGE:END" "$USAGE_FILE"; then
  echo "ERROR: missing USAGE:END marker"
  exit 1
fi

echo "OK: markers present"
