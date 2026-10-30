#!/bin/sh
# Renders the app icons (icons/*.png) from icons/icon.svg and icons/icon-maskable.svg
# with headless Chrome (macOS), then scales the small sizes with sips.
set -e
cd "$(dirname "$0")/../icons"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PROFILE="$(mktemp -d)"
render() {
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --user-data-dir="$PROFILE" \
    --screenshot="$PWD/$2" --window-size=512,512 "file://$PWD/$1" >/dev/null 2>&1
}
# Headless Chrome does not draw windows smaller than ~500 px: render at 512 and scale down
render icon.svg icon-512.png
render icon-maskable.svg icon-maskable-512.png
cp icon-512.png icon-192.png && sips -z 192 192 icon-192.png >/dev/null
cp icon-maskable-512.png apple-touch-icon.png && sips -z 180 180 apple-touch-icon.png >/dev/null
rm -rf "$PROFILE"
