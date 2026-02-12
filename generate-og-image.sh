#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT="$SCRIPT_DIR/og-image.svg"
OUTPUT="$SCRIPT_DIR/og-image.png"

if ! [ -f "$INPUT" ]; then
  echo "Error: $INPUT not found"
  exit 1
fi

if ! command -v rsvg-convert &>/dev/null; then
  echo "Error: rsvg-convert not found. Install with: brew install librsvg"
  exit 1
fi

rsvg-convert -w 1200 -h 630 "$INPUT" -o "$OUTPUT"
echo "Created $OUTPUT"
