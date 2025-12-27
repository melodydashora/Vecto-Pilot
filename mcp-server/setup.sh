#!/bin/bash

# Vecto Pilot MCP Server Setup Script

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "  VECTO PILOT MCP SERVER SETUP"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not installed."
    exit 1
fi

NODE_VERSION=$(node -v)
echo "✓ Node.js $NODE_VERSION found"

# Install dependencies
echo ""
echo "Installing dependencies..."
npm install

# Create memory table if DATABASE_URL is set
if [ -n "$DATABASE_URL" ]; then
    echo ""
    echo "Creating memory table in database..."
    psql "$DATABASE_URL" -c "
    CREATE TABLE IF NOT EXISTS mcp_memory (
      key VARCHAR(255) PRIMARY KEY,
      content TEXT NOT NULL,
      metadata JSONB DEFAULT '{}',
      tags TEXT[] DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_memory_tags ON mcp_memory USING GIN (tags);
    " 2>/dev/null && echo "✓ Memory table ready" || echo "⚠ Could not create memory table (may already exist)"
fi

# Detect REPO_ROOT
if [ -z "$REPO_ROOT" ]; then
    REPO_ROOT="$(dirname "$SCRIPT_DIR")"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  SETUP COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "To start the MCP server:"
echo ""
echo "  cd $SCRIPT_DIR"
echo "  REPO_ROOT=$REPO_ROOT MCP_PORT=3001 npm start"
echo ""
echo "Or run in background:"
echo ""
echo "  REPO_ROOT=$REPO_ROOT MCP_PORT=3001 nohup npm start > mcp.log 2>&1 &"
echo ""
echo "Test with:"
echo ""
echo "  curl http://localhost:3001/health"
echo ""
echo "═══════════════════════════════════════════════════════════════"
