
#!/bin/bash

echo "🔧 Workspace Startup - Running Self-Healing Checks..."
echo ""

# Wait for database to be ready
echo "⏳ Waiting for database connection..."
for i in {1..10}; do
  if node -e "import('pg').then(({default: {Client}}) => {const c = new Client({connectionString: process.env.DATABASE_URL}); c.connect().then(() => {c.end(); process.exit(0)}).catch(() => process.exit(1))})" 2>/dev/null; then
    echo "✅ Database connected"
    break
  fi
  if [ $i -eq 10 ]; then
    echo "❌ Database connection timeout"
    exit 1
  fi
  sleep 2
done

echo ""

# Run self-healing monitor
echo "🏥 Running self-healing monitor..."
node --no-warnings server/scripts/self-healing-monitor.js

HEAL_EXIT=$?

if [ $HEAL_EXIT -eq 0 ]; then
  echo ""
  echo "✅ Workspace health check passed"
  echo ""
else
  echo ""
  echo "⚠️ Workspace health check found issues - check logs above"
  echo ""
  # Don't exit with error code to allow workspace to start
  echo "ℹ️  Continuing workspace startup despite health check warnings..."
  echo ""
fi
