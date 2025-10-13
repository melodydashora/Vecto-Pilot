#!/bin/bash

# ============================================================
# MEGA ASSISTANT PORT - Automated Setup Script
# ============================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

# Banner
echo -e "${BLUE}"
cat << "EOF"
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║        MEGA ASSISTANT PORT - SETUP WIZARD               ║
║                                                          ║
║  Enterprise AI Assistant with Enhanced Memory & Atlas   ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

# Step 1: Check Node.js version
log_info "Checking Node.js version..."
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    log_error "Node.js 20.x or higher required. Current: $(node -v)"
    exit 1
fi
log_success "Node.js $(node -v) detected"

# Step 2: Check PostgreSQL
log_info "Checking PostgreSQL availability..."
if command -v psql &> /dev/null; then
    log_success "PostgreSQL found"
else
    log_warning "PostgreSQL not found. You'll need to install it separately."
fi

# Step 3: Install dependencies
log_info "Installing npm dependencies..."
npm install --silent
log_success "Dependencies installed"

# Step 4: Environment setup
if [ ! -f .env ]; then
    log_info "Creating .env file from template..."
    cp config/.env.template .env
    log_success ".env created"
    
    log_warning "IMPORTANT: Edit .env file with your actual values:"
    echo ""
    echo "  1. Generate security tokens:"
    echo "     ${YELLOW}openssl rand -hex 32${NC}  (run 3 times for AGENT_TOKEN, EIDOLON_TOKEN, GW_KEY)"
    echo ""
    echo "  2. Add your AI provider API keys:"
    echo "     - ANTHROPIC_API_KEY (Claude)"
    echo "     - OPENAI_API_KEY (GPT-5)"
    echo "     - GOOGLE_API_KEY (Gemini)"
    echo ""
    echo "  3. Set DATABASE_URL to your PostgreSQL connection string"
    echo ""
    
    read -p "Press Enter when you've configured .env..."
else
    log_success ".env already exists"
fi

# Step 5: Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Step 6: Check required environment variables
log_info "Validating environment configuration..."
MISSING_VARS=()

[ -z "$AGENT_TOKEN" ] && MISSING_VARS+=("AGENT_TOKEN")
[ -z "$EIDOLON_TOKEN" ] && MISSING_VARS+=("EIDOLON_TOKEN")
[ -z "$GW_KEY" ] && MISSING_VARS+=("GW_KEY")
[ -z "$ANTHROPIC_API_KEY" ] && MISSING_VARS+=("ANTHROPIC_API_KEY")
[ -z "$OPENAI_API_KEY" ] && MISSING_VARS+=("OPENAI_API_KEY")
[ -z "$DATABASE_URL" ] && MISSING_VARS+=("DATABASE_URL")

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    log_error "Missing required environment variables:"
    for var in "${MISSING_VARS[@]}"; do
        echo "  - $var"
    done
    exit 1
fi
log_success "Environment configured"

# Step 7: Database setup
log_info "Setting up database..."
if [ -n "$DATABASE_URL" ]; then
    # Test database connection
    if psql "$DATABASE_URL" -c "SELECT 1" &> /dev/null; then
        log_success "Database connection verified"
        
        # Run migrations
        log_info "Running database migrations..."
        npm run db:push --silent || npm run db:push:force --silent
        log_success "Database schema updated"
    else
        log_warning "Could not connect to database. Please verify DATABASE_URL"
    fi
else
    log_warning "DATABASE_URL not set. Skipping database setup."
fi

# Step 8: Validate configuration
log_info "Validating configuration files..."
if [ -f config/assistant-policy.json ]; then
    log_success "Policy configuration found"
else
    log_error "Missing config/assistant-policy.json"
    exit 1
fi

# Step 9: Summary
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                                          ║${NC}"
echo -e "${GREEN}║              SETUP COMPLETE! 🚀                          ║${NC}"
echo -e "${GREEN}║                                                          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

log_info "Next steps:"
echo ""
echo "  1. Start all servers:"
echo "     ${YELLOW}npm run dev${NC}"
echo ""
echo "  2. Or start individually:"
echo "     ${YELLOW}npm run eidolon${NC}   # Eidolon SDK (Port 3101)"
echo "     ${YELLOW}npm run agent${NC}     # Agent Server (Port 43717)"
echo "     ${YELLOW}npm run gateway${NC}   # Gateway Server (Port 5000)"
echo ""
echo "  3. Test the system:"
echo "     ${YELLOW}curl -H 'X-Gateway-Key: \$GW_KEY' http://localhost:5000/api/diagnostics${NC}"
echo ""
echo "  4. Check which assistant is running:"
echo "     ${YELLOW}npm run which-assistant${NC}"
echo ""

log_success "Happy building! 🎉"
