#!/bin/sh
# Builds the browser preview (sample data, no Patreon account) into the given folder (default dist/web).
set -e
cd "$(dirname "$0")/.."
OUT="${1:-dist/web}"
rm -rf "$OUT"
mkdir -p "$OUT/js" "$OUT/mock-media"
cp -r app/css app/vendor "$OUT/"
cp app/js/*.js "$OUT/js/"
cp tools/mock/mock.js "$OUT/js/mock.js"
cp tools/mock/video.webm "$OUT/mock-media/"
cp tools/web/index.html "$OUT/index.html"
echo "Built browser preview in $OUT"
