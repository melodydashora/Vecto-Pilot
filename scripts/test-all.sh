#!/bin/bash
# scripts/test-all.sh
# Complete test suite: Seed + Unit Tests + E2E Tests

set -e  # Exit on error

echo "🧪 Vecto Pilot - Complete Test Suite"
echo "===================================="
echo ""

# Step 1: Seed development data
echo "📝 Step 1/3: Seeding development data..."
node scripts/seed-dev.js

echo ""
echo "✅ Step 1 complete!"
echo ""

# Step 2: Unit tests (Jest - Block Schema Contract)
echo "🔬 Step 2/3: Running unit tests (Jest)..."
TEST_SNAPSHOT_ID=test-snapshot-001 NODE_OPTIONS='--experimental-vm-modules' npx jest tests/blocksApi.test.js --verbose

echo ""
echo "✅ Step 2 complete!"
echo ""

# Step 3: E2E tests (Playwright - CoPilot UI)
echo "🎭 Step 3/3: Running E2E tests (Playwright)..."
npx playwright test tests/e2e/copilot.spec.ts

echo ""
echo "✅ Step 3 complete!"
echo ""
echo "================================================"
echo "✅ ALL TESTS PASSED! 🎉"
echo "================================================"
echo ""
echo "📊 Summary:"
echo "  ✓ Database seeded with test data"
echo "  ✓ Block schema contract validated (Jest)"
echo "  ✓ CoPilot UI rendering verified (Playwright)"
echo ""
