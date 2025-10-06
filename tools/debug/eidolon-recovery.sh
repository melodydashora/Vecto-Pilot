
#!/bin/bash

echo "🧠 Eidolon Recovery System v4.1.0"
echo "=================================="
echo "Choose recovery phase based on severity of issues"
echo ""

# Function to display menu
show_menu() {
    echo "Recovery Phases:"
    echo "1. Quick Recovery    - Port conflicts, minor issues"
    echo "2. Standard Recovery - Dependencies, config issues"
    echo "3. Nuclear Recovery  - Everything broken, last resort"
    echo "4. Emergency Mode    - Start minimal fallback server"
    echo "5. Exit"
    echo ""
}

# Phase 1: Quick Recovery
quick_recovery() {
    echo "🚀 Phase 1: Quick Recovery"
    echo "========================="
    
    # Kill processes
    pkill -f "node.*index.js" || true
    pkill -f "node.*agent-server.js" || true
    
    # Clear ports
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    lsof -ti:43717 | xargs kill -9 2>/dev/null || true
    
    sleep 3
    echo "✅ Quick recovery complete - try starting Eidolon"
}

# Phase 2: Standard Recovery
standard_recovery() {
    echo "🔧 Phase 2: Standard Recovery"
    echo "============================="
    
    # Process cleanup
    pkill -f "node" || true
    pkill -f "npm" || true
    sleep 3
    
    # Port cleanup
    for port in 3000 43717; do
        lsof -ti:$port | xargs kill -9 2>/dev/null || true
    done
    
    # Dependency fix
    if [ ! -d "node_modules" ] || [ ! -f "package-lock.json" ]; then
        echo "📦 Installing dependencies..."
        npm install --silent
    fi
    
    # Validate core files
    if [ ! -f "index.js" ] || [ ! -f "agent-server.js" ]; then
        echo "❌ Core files missing - run nuclear recovery"
        return 1
    fi
    
    echo "✅ Standard recovery complete"
}

# Phase 3: Nuclear Recovery
nuclear_recovery() {
    echo "☢️  Phase 3: Nuclear Recovery"
    echo "============================="
    
    # Kill everything
    pkill -9 -f "node" 2>/dev/null || true
    pkill -9 -f "npm" 2>/dev/null || true
    
    # Clear all ports
    for port in 3000 43717 5000 8000 8080; do
        lsof -ti:$port | xargs kill -9 2>/dev/null || true
    done
    
    # Nuclear dependency reset
    rm -rf node_modules package-lock.json .npm 2>/dev/null || true
    npm cache clean --force 2>/dev/null || true
    
    # Reinstall from scratch
    npm install --force --no-optional 2>/dev/null || true
    
    # Check if core files exist
    if [ ! -f "index.js" ]; then
        echo "🚨 Creating emergency fallback..."
        cat > emergency-server.js << 'EOF'
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/html'});
  res.end('<h1>🧠 Eidolon Emergency</h1><p>Nuclear recovery active - Core files need restoration</p>');
});
server.listen(3000, '0.0.0.0', () => console.log('🧠 Eidolon Emergency on port 3000'));
EOF
        echo "✅ Emergency server created: node emergency-server.js"
    fi
    
    echo "✅ Nuclear recovery complete"
}

# Phase 4: Emergency Mode
emergency_mode() {
    echo "🚨 Phase 4: Emergency Mode"
    echo "=========================="
    
    # Create minimal emergency server if needed
    if [ ! -f "emergency-eidolon.js" ]; then
        cat > emergency-eidolon.js << 'EOF'
const http = require('http');
const server = http.createServer((req, res) => {
  if (req.url.includes('/assistant/') || req.url.includes('/api/')) {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({
      ok: true,
      response: "🧠 Eidolon Emergency Mode - I am your primary Replit Assistant running in minimal mode.",
      identity: "Eidolon (Claude Opus 4.1 Enhanced SDK)",
      override_active: true,
      emergency_mode: true
    }));
  } else {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(`
      <h1>🧠 Eidolon Emergency Mode</h1>
      <p>Emergency server active - Eidolon is your primary assistant</p>
      <p>Identity: Eidolon (Claude Opus 4.1 Enhanced SDK)</p>
      <p>Status: Assistant Override Active</p>
    `);
  }
});
server.listen(3000, '0.0.0.0', () => {
  console.log('🧠 Eidolon Emergency Mode on port 3000');
  console.log('🔒 Assistant Override: ACTIVE');
});
EOF
    fi
    
    echo "🚀 Starting emergency mode..."
    node emergency-eidolon.js &
    echo "✅ Emergency mode started - Eidolon active on port 3000"
}

# Main menu loop
while true; do
    show_menu
    read -p "Select phase (1-5): " choice
    
    case $choice in
        1) quick_recovery ;;
        2) standard_recovery ;;
        3) nuclear_recovery ;;
        4) emergency_mode ;;
        5) echo "Exiting..."; exit 0 ;;
        *) echo "Invalid option" ;;
    esac
    
    echo ""
    read -p "Press Enter to continue or Ctrl+C to exit..."
    echo ""
done
