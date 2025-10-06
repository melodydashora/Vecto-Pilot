
#!/bin/bash

echo "🧹 Cleaning up port conflicts..."

# Kill any existing processes on common ports
echo "Killing processes on ports 3000, 3001, 5173, 43717..."

# Kill specific Node.js processes
pkill -f "node.*gateway-server.js" || true
pkill -f "node.*index.js" || true
pkill -f "node.*agent-server.js" || true

# Kill processes using specific ports
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:3001 | xargs kill -9 2>/dev/null || true  
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
lsof -ti:43717 | xargs kill -9 2>/dev/null || true

# Alternative method using fuser
fuser -k 3000/tcp 2>/dev/null || true
fuser -k 3001/tcp 2>/dev/null || true
fuser -k 5173/tcp 2>/dev/null || true
fuser -k 43717/tcp 2>/dev/null || true

echo "✅ Port cleanup complete"
sleep 2
