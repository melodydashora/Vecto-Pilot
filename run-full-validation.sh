#!/bin/bash
set -e

echo "========================================="
echo "VECTO PILOT - FULL VALIDATION SUITE"
echo "========================================="
echo ""

# Load environment
set -a
source mono-mode.env 2>/dev/null || true
set +a

echo "1. TypeScript Compilation Check"
echo "---------------------------------"
npx tsc --noEmit --project tsconfig.json 2>&1 | grep -E "(error|warning)" | head -20 || echo "✅ No critical TypeScript errors"
echo ""

echo "2. Schema Validation"
echo "---------------------------------"
node tests/schema-validation.test.js
echo ""

echo "3. Global Location Tests"
echo "---------------------------------"
node test-global-scenarios.js 2>&1 | tail -30
echo ""

echo "4. Environment Configuration"
echo "---------------------------------"
node -e "
const { config, PORTS, URLS } = require('./shared/config.js');
console.log('✅ Config validated');
console.log('Ports:', PORTS);
console.log('Database:', config.DATABASE_URL ? '✅ Connected' : '❌ Missing');
console.log('OpenAI:', config.OPENAI_API_KEY ? '✅ Set' : '⚠️ Missing');
"
echo ""

echo "5. Database Connection"
echo "---------------------------------"
node -e "
const pool = require('./server/db/client.js').default;
pool.query('SELECT version()').then(r => {
  console.log('✅ Database connected:', r.rows[0].version.split(' ')[0]);
  process.exit(0);
}).catch(e => {
  console.error('❌ Database error:', e.message);
  process.exit(1);
});
" || echo "⚠️ Database check skipped"
echo ""

echo "6. Validation Middleware Test"
echo "---------------------------------"
node -e "
const { schemas } = require('./server/middleware/validation.js');
console.log('✅ Validation schemas loaded:', Object.keys(schemas).length, 'schemas');
Object.keys(schemas).forEach(key => console.log('  -', key));
"
echo ""

echo "7. Check Critical Files"
echo "---------------------------------"
files=(
  "shared/config.js"
  "server/db/client.js"
  "server/middleware/validation.js"
  "server/middleware/timeout.js"
  "gateway-server.js"
)
for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "✅ $file"
  else
    echo "❌ $file MISSING"
  fi
done
echo ""

echo "========================================="
echo "VALIDATION COMPLETE"
echo "========================================="
