#!/bin/bash
# scripts/test-with-seed.sh
# Seed development data and run block schema tests

set -e  # Exit on error

echo "🌱 Step 1: Seeding development data..."
node scripts/seed-dev.js

echo ""
echo "🧪 Step 2: Running block schema tests..."
TEST_SNAPSHOT_ID=test-snapshot-001 NODE_OPTIONS='--experimental-vm-modules' npx jest tests/blocksApi.test.js --verbose

echo ""
echo "✅ All tests passed!"
