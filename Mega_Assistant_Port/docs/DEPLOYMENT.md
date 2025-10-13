# Deployment Guide - Mega Assistant Port

## Quick Start

### Prerequisites Checklist

- [ ] Node.js 20.x or higher installed
- [ ] PostgreSQL 14+ running
- [ ] API keys for Claude, GPT-5, Gemini
- [ ] 64-character hex tokens generated (3x)

### One-Command Setup

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

## Manual Deployment

### 1. Environment Configuration

```bash
# Copy template
cp config/.env.template .env

# Generate security tokens
openssl rand -hex 32  # For AGENT_TOKEN
openssl rand -hex 32  # For EIDOLON_TOKEN
openssl rand -hex 32  # For GW_KEY

# Edit .env with your values
nano .env
```

### 2. Database Setup

```bash
# Create database
createdb mega_assistant_db

# Update .env with connection string
DATABASE_URL=postgresql://user:password@localhost:5432/mega_assistant_db

# Run migrations
npm run db:push
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Start Servers

**Development**:
```bash
npm run dev
```

**Production**:
```bash
NODE_ENV=production npm start
```

## Production Deployment

### Using PM2 (Recommended)

```bash
# Install PM2
npm install -g pm2

# Create ecosystem.config.js
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [
    {
      name: 'gateway',
      script: './servers/gateway-server.js',
      env: {
        NODE_ENV: 'production',
        GATEWAY_PORT: 5000
      }
    },
    {
      name: 'eidolon',
      script: './servers/eidolon-sdk-server.js',
      env: {
        NODE_ENV: 'production',
        EIDOLON_SDK_PORT: 3101
      }
    },
    {
      name: 'agent',
      script: './servers/agent-server.js',
      env: {
        NODE_ENV: 'production',
        AGENT_SERVER_PORT: 43717
      }
    }
  ]
};
EOF

# Start all servers
pm2 start ecosystem.config.js

# Save configuration
pm2 save

# Setup auto-restart on boot
pm2 startup
```

### Using Docker

```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

EXPOSE 5000 3101 43717

CMD ["npm", "start"]
```

```bash
# Build image
docker build -t mega-assistant .

# Run container
docker run -d \
  -p 5000:5000 \
  -p 3101:3101 \
  -p 43717:43717 \
  --env-file .env \
  --name mega-assistant \
  mega-assistant
```

### Using Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: mega_assistant
      POSTGRES_USER: assistant
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  assistant:
    build: .
    depends_on:
      - postgres
    environment:
      DATABASE_URL: postgresql://assistant:${DB_PASSWORD}@postgres:5432/mega_assistant
      AGENT_TOKEN: ${AGENT_TOKEN}
      EIDOLON_TOKEN: ${EIDOLON_TOKEN}
      GW_KEY: ${GW_KEY}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      GOOGLE_API_KEY: ${GOOGLE_API_KEY}
    ports:
      - "5000:5000"
      - "3101:3101"
      - "43717:43717"
    restart: unless-stopped

volumes:
  postgres_data:
```

```bash
# Start services
docker-compose up -d
```

## Cloud Deployment

### AWS (EC2 + RDS)

```bash
# 1. Launch EC2 instance (Ubuntu 22.04, t3.medium)
# 2. Create RDS PostgreSQL instance
# 3. SSH into EC2

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone/copy your code
git clone <your-repo>
cd Mega_Assistant_Port

# Install dependencies
npm install

# Configure .env with RDS endpoint
DATABASE_URL=postgresql://user:pass@your-rds.amazonaws.com:5432/assistant

# Setup PM2
npm install -g pm2
pm2 start ecosystem.config.js
pm2 startup
pm2 save

# Configure security groups:
# - Allow inbound 5000 (Gateway)
# - Allow inbound 5432 from EC2 security group (PostgreSQL)
```

### Vercel (Gateway Only)

```javascript
// vercel.json
{
  "version": 2,
  "builds": [
    {
      "src": "servers/gateway-server.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "servers/gateway-server.js"
    }
  ],
  "env": {
    "GW_KEY": "@gw-key",
    "EIDOLON_SDK_URL": "@eidolon-url",
    "AGENT_SERVER_URL": "@agent-url"
  }
}
```

### Heroku

```bash
# Create app
heroku create mega-assistant

# Add PostgreSQL
heroku addons:create heroku-postgresql:standard-0

# Set environment variables
heroku config:set AGENT_TOKEN=$(openssl rand -hex 32)
heroku config:set EIDOLON_TOKEN=$(openssl rand -hex 32)
heroku config:set GW_KEY=$(openssl rand -hex 32)
heroku config:set ANTHROPIC_API_KEY=your-key
heroku config:set OPENAI_API_KEY=your-key
heroku config:set GOOGLE_API_KEY=your-key

# Deploy
git push heroku main

# Run migrations
heroku run npm run db:push
```

### Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Add PostgreSQL
railway add -p postgres

# Set environment variables
railway variables set AGENT_TOKEN=$(openssl rand -hex 32)
railway variables set EIDOLON_TOKEN=$(openssl rand -hex 32)
railway variables set GW_KEY=$(openssl rand -hex 32)

# Deploy
railway up
```

## Reverse Proxy Setup

### Nginx

```nginx
# /etc/nginx/sites-available/mega-assistant

upstream gateway {
    server localhost:5000;
}

server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://gateway;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/mega-assistant /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### SSL with Let's Encrypt

```bash
# Install certbot
sudo apt-get install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal is configured automatically
```

## Environment-Specific Configuration

### Development

```bash
NODE_ENV=development
LOG_LEVEL=debug
ENABLE_DIAGNOSTICS=true
```

### Staging

```bash
NODE_ENV=staging
LOG_LEVEL=info
ENABLE_DIAGNOSTICS=true
DATABASE_URL=postgresql://...staging-db...
```

### Production

```bash
NODE_ENV=production
LOG_LEVEL=error
ENABLE_DIAGNOSTICS=false
DATABASE_URL=postgresql://...prod-db...
RATE_LIMIT_MAX_REQUESTS=100
```

## Health Checks

### Endpoint

```bash
curl -H "X-Gateway-Key: $GW_KEY" http://localhost:5000/api/diagnostics
```

### Expected Response

```json
{
  "status": "healthy",
  "servers": {
    "gateway": "running",
    "eidolon": "running",
    "agent": "running"
  },
  "database": {
    "connected": true,
    "latency_ms": 5
  },
  "memory": {
    "heapUsed": 145.2,
    "heapTotal": 256.0
  }
}
```

### Monitoring Script

```bash
#!/bin/bash
# health-check.sh

while true; do
    STATUS=$(curl -s -H "X-Gateway-Key: $GW_KEY" http://localhost:5000/api/diagnostics | jq -r '.status')
    
    if [ "$STATUS" != "healthy" ]; then
        echo "ALERT: System unhealthy - $STATUS"
        # Send alert (email, Slack, PagerDuty, etc.)
    fi
    
    sleep 60
done
```

## Database Backup

### Automated Backup

```bash
#!/bin/bash
# backup.sh

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/mega-assistant"
DB_URL="$DATABASE_URL"

mkdir -p $BACKUP_DIR

# Backup database
pg_dump $DB_URL > $BACKUP_DIR/backup_$TIMESTAMP.sql

# Compress
gzip $BACKUP_DIR/backup_$TIMESTAMP.sql

# Keep last 30 days
find $BACKUP_DIR -name "backup_*.sql.gz" -mtime +30 -delete

echo "Backup completed: backup_$TIMESTAMP.sql.gz"
```

### Cron Job

```bash
# Add to crontab
crontab -e

# Daily backup at 2 AM
0 2 * * * /path/to/backup.sh >> /var/log/assistant-backup.log 2>&1
```

## Troubleshooting

### Servers Won't Start

```bash
# Check ports are free
lsof -i :5000
lsof -i :3101
lsof -i :43717

# Check logs
pm2 logs
```

### Database Connection Failed

```bash
# Test connection
psql $DATABASE_URL

# Check PostgreSQL is running
sudo systemctl status postgresql
```

### Memory Issues

```bash
# Increase Node.js memory limit
NODE_OPTIONS="--max-old-space-size=4096" npm start

# Compact memory
npm run compact-memory
```

### API Rate Limits

```bash
# Adjust in .env
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=200
```

## Security Hardening

### Firewall

```bash
# Allow only necessary ports
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS
sudo ufw enable
```

### Token Rotation

```bash
# Generate new tokens
NEW_TOKEN=$(openssl rand -hex 32)

# Update .env
sed -i "s/AGENT_TOKEN=.*/AGENT_TOKEN=$NEW_TOKEN/" .env

# Restart services
pm2 restart all
```

### Database Encryption

```bash
# Enable SSL in PostgreSQL
# postgresql.conf
ssl = on
ssl_cert_file = '/path/to/cert.pem'
ssl_key_file = '/path/to/key.pem'

# Update DATABASE_URL
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
```

## Performance Optimization

### Database Indexing

```sql
-- Add indexes for better query performance
CREATE INDEX idx_conversations_thread ON assistant_conversations(thread_id);
CREATE INDEX idx_conversations_user ON assistant_conversations(user_id);
CREATE INDEX idx_conversations_created ON assistant_conversations(created_at DESC);
CREATE INDEX idx_sessions_activity ON assistant_sessions(last_activity DESC);
```

### Connection Pooling

```javascript
// Add to server config
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

### Caching

```javascript
// Redis cache (optional)
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

// Cache user preferences
const prefs = await redis.get(`prefs:${userId}`);
if (!prefs) {
  const dbPrefs = await db.query(...);
  await redis.setex(`prefs:${userId}`, 3600, JSON.stringify(dbPrefs));
}
```

## Monitoring & Logging

### Application Monitoring

```bash
# Install monitoring tools
npm install @sentry/node pino

# Configure Sentry
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV
});
```

### Log Aggregation

```bash
# Use structured logging
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true
    }
  }
});
```

## Scaling Strategies

### Horizontal Scaling

```bash
# Run multiple Gateway instances behind load balancer
pm2 start servers/gateway-server.js -i max  # Cluster mode
```

### Load Balancing

```nginx
# Nginx load balancer
upstream gateway_cluster {
    least_conn;
    server localhost:5000;
    server localhost:5001;
    server localhost:5002;
}
```

### Database Scaling

```bash
# PostgreSQL read replicas
# Primary: Write operations
# Replicas: Read operations

# Split read/write in code
const writeDB = new Pool({ connectionString: PRIMARY_DB_URL });
const readDB = new Pool({ connectionString: REPLICA_DB_URL });
```
