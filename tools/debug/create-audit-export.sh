#!/bin/bash
# Create clean audit export (source code only, no dependencies/cache)

EXPORT_NAME="vecto-pilot-audit-$(date +%Y%m%d-%H%M%S).zip"

echo "📦 Creating audit-ready export: $EXPORT_NAME"

# Create zip excluding unnecessary files
zip -r "$EXPORT_NAME" . \
  -x "node_modules/*" \
  -x ".local/*" \
  -x ".config/*" \
  -x ".cache/*" \
  -x "dist/*" \
  -x ".git/*" \
  -x "*.zip" \
  -x ".gitignore" \
  -x "package-lock.json" \
  -x ".replit" \
  -x ".replit-assistant-override.json" \
  -x "attached_assets/*" \
  -x "data/context-snapshots/*.json" \
  -x ".nix-node/*" \
  -x ".npm/*" \
  -x ".upm/*" \
  -x "warehouse/*" \
  -x "tests/*" \
  -q

SIZE=$(du -h "$EXPORT_NAME" | cut -f1)
FILES=$(unzip -l "$EXPORT_NAME" | tail -1 | awk '{print $2}')

echo "✅ Export created: $EXPORT_NAME"
echo "📊 Size: $SIZE"
echo "📁 Files: $FILES"
echo ""
echo "Contents include:"
echo "  ✓ Source code (client/, server/, shared/)"
echo "  ✓ Configuration (package.json, vite.config.js, etc.)"
echo "  ✓ Gateway & main files"
echo "  ✓ Database schema"
echo ""
echo "Excluded (reinstallable/cache):"
echo "  ✗ node_modules/ (727MB)"
echo "  ✗ .local/ .config/ (856MB cache)"
echo "  ✗ dist/ build artifacts"
echo "  ✗ .git/ history"

