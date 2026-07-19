#!/bin/bash
set -e

echo "=== JAYACLEAN Build ==="

SRC_DIR="blog"
OUT_DIR="public"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# 1. Build Hugo blog
echo "-> Building Hugo blog..."
cd "$SRC_DIR"
hugo --minify --destination "../$OUT_DIR"
cd ..

# 2. Copy root static files
echo "-> Copying root static files..."
for f in index.html success.html test-pay.html favicon.svg sw.js manifest.json theme.css admin-modern.css admin-favicon.svg admin-manifest.json _redirects .nojekyll CNAME jc-api.js; do
  if [ -f "$f" ]; then
    cp "$f" "$OUT_DIR/"
    echo "   $f -> $OUT_DIR/"
  fi
done

# 3. Copy app folders
echo "-> Copying app folders..."
for dir in admin worker customer assets home; do
  if [ -d "$dir" ]; then
    cp -r "$dir" "$OUT_DIR/"
    echo "   $dir/ -> $OUT_DIR/$dir/"
  fi
done

# The customer project keeps only a safe hand-off to the dedicated admin host.
if [ -f "admin-redirect.html" ]; then
  cp "admin-redirect.html" "$OUT_DIR/admin/index.html"
fi

echo "=== Build complete. Deploy folder: $OUT_DIR ==="
