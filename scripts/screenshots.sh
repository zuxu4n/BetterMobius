#!/bin/sh
# Renders the Chrome Web Store listing images into store/ with headless
# Chrome: three 1280x800 screenshots of store/demo.html (which runs the real
# content.js on made-up lecture content) and the 440x280 promo tile.
set -eu

cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "Chrome not found; set CHROME=/path/to/chrome" >&2; exit 1; }

ROOT="$(pwd)"
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT

shoot() { # url output width height
  rm -f "$ROOT/$2"
  # --virtual-time-budget lets the page's own timers (gear docking, the
  # scripted clicks, the open animations) run before the capture. New
  # headless Chrome can linger after writing the file, so it's run in the
  # background and stopped once the image has landed (or after 30s).
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --user-data-dir="$PROFILE" --allow-file-access-from-files \
    --force-device-scale-factor=1 --window-size="$3,$4" \
    --virtual-time-budget=4000 --screenshot="$ROOT/$2" "$1" >/dev/null 2>&1 &
  pid=$!
  i=0
  while [ ! -s "$ROOT/$2" ] && [ $i -lt 60 ]; do sleep 0.5; i=$((i + 1)); done
  sleep 0.5 # let the write finish
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  if [ -s "$ROOT/$2" ]; then echo "  $2"; else echo "  FAILED: $2" >&2; exit 1; fi
}

echo "Rendering store images:"
shoot "file://$ROOT/store/demo.html?shot=speed" store/screenshot-1-speed.png 1280 800
shoot "file://$ROOT/store/demo.html?shot=draw" store/screenshot-2-draw.png 1280 800
shoot "file://$ROOT/store/demo.html?shot=calc" store/screenshot-3-calculator.png 1280 800
shoot "file://$ROOT/store/promo-tile.html" store/promo-tile.png 440 280
