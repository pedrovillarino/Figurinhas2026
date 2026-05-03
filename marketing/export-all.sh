#!/bin/bash
# Export all slides to PNG using Chrome headless
# Run: bash marketing/export-all.sh

DIR="$(cd "$(dirname "$0")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

for i in $(seq 1 8); do
  echo "Exporting slide-${i}..."
  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --screenshot="${DIR}/slide-${i}.png" \
    --window-size=1080,1080 \
    --default-background-color=0 \
    "file://${DIR}/slide-${i}.html" 2>/dev/null
done

echo ""
echo "✅ 8 slides exportados em marketing/"
ls -lh "${DIR}"/slide-*.png
