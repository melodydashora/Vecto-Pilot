
#!/bin/bash
set -e

echo "🔍 Comprehensive File Validation"
echo "================================="

# TypeScript errors
echo ""
echo "📘 TypeScript Check:"
npx tsc --noEmit 2>&1 | grep -E "error TS" | wc -l | xargs -I {} echo "   {} errors found"

# JavaScript syntax
echo ""
echo "📗 JavaScript Syntax Check:"
find . -name "*.js" -not -path "*/node_modules/*" -not -path "*/dist/*" -exec node --check {} \; 2>&1 | grep -c "SyntaxError" || echo "   0 errors found"

# JSON validation
echo ""
echo "📙 JSON Validation:"
find . -name "*.json" -not -path "*/node_modules/*" -not -path "*/dist/*" -exec sh -c 'jq empty "$1" 2>/dev/null || echo "Invalid: $1"' _ {} \; | grep -c "Invalid" || echo "   0 errors found"

# Config files
echo ""
echo "⚙️  Config File Check:"
files=("tsconfig.json" "package.json" "vite.config.js" "tailwind.config.js")
errors=0
for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    node --check "$file" 2>&1 && echo "   ✓ $file" || { echo "   ✗ $file"; ((errors++)); }
  fi
done
echo "   $errors config errors found"

echo ""
echo "✅ Validation complete!"
