# Vecto Pilot - Deployment Configuration

## ✅ Fixes Applied

### 1. **Fast Root Health Check**
- Added smart `/` endpoint handler that responds immediately to health checks
- Detects health check requests via Accept headers or user-agent
- Returns JSON instantly without waiting for static file serving
- Regular browser requests still get the full SPA (single-page app)

### 2. **Graceful Environment Loading**
- Created `start-mono.sh` script that handles missing `mono-mode.env` gracefully
- Uses `set -a && source` instead of `export $(cat ... | xargs)` to support comments
- Provides fallback defaults if env file is missing
- Validates critical environment variables before startup

### 3. **Binding Verification**
- App already binds to `0.0.0.0:5174` correctly ✅
- Also listens on port 80 in production mode for compatibility ✅

---

## 📝 Required Manual .replit Update

**⚠️ You must manually update your `.replit` file** with the following changes:

### Change the `[deployment]` section:

**FROM:**
```toml
[deployment]
build = ["sh", "-c", "npm ci --omit=dev && npm run build"]
run = ["sh", "-c", "export $(cat mono-mode.env | xargs) && node gateway-server.js"]
```

**TO:**
```toml
[deployment]
build = ["sh", "-c", "npm ci --omit=dev && npm run build"]
run = ["sh", "-c", "./start-mono.sh"]
```

### Ensure only ONE `[[ports]]` entry exists:

**KEEP THIS:**
```toml
[[ports]]
localPort = 5174
externalPort = 80
```

**DELETE** any other `[[ports]]` entries (like port 3000 or 5000 mappings).

---

## 🔍 How the Fixes Work

### Fast Health Checks
```javascript
// Deployment health checks hit "/" and get instant 200 response
app.get('/', (req, res, next) => {
  const acceptsJson = req.accepts('json') && !req.accepts('html');
  const isHealthCheck = req.headers['user-agent']?.toLowerCase().includes('health');
  
  if (acceptsJson || isHealthCheck) {
    return res.status(200).json({ ok: true, mode: MODE, app: 'Vecto Pilot' });
  }
  next(); // Normal requests continue to static files
});
```

### Environment Loading
```bash
# start-mono.sh handles missing env file
if [ -f mono-mode.env ]; then
  set -a && source mono-mode.env && set +a
else
  # Fallback to safe defaults
  export APP_MODE=mono
  export PORT=5174
  # ... etc
fi
```

---

## 🚀 Deployment Checklist

- [x] Fast root health check implemented
- [x] Graceful env file loading (start-mono.sh)
- [x] App binds to 0.0.0.0
- [x] Port 80 listener for compatibility
- [ ] **Manual: Update .replit deployment.run to use ./start-mono.sh**
- [ ] **Manual: Remove extra [[ports]] entries from .replit**
- [ ] **Deploy to Autoscale**

---

## 🧪 Test Locally

```bash
# Test the startup script
./start-mono.sh

# Test health check endpoints
curl http://localhost:5174/
curl http://localhost:5174/health
curl http://localhost:5174/healthz

# Test with health check user-agent
curl -H "User-Agent: GoogleHC/1.0" http://localhost:5174/
```

---

## 🌐 Environment Variables

The app requires these variables (set in `mono-mode.env` or deployment secrets):

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `APP_MODE` | `mono` | Yes | Application mode (mono/split) |
| `PORT` | `5174` | No | HTTP server port (Cloud Run overrides this) |
| `DATABASE_URL` | - | Yes | PostgreSQL connection string (pooled) |
| `NODE_ENV` | `production` | Yes | Environment mode |
| `DISABLE_SPAWN_SDK` | `1` | Yes | Disable SDK child process |
| `DISABLE_SPAWN_AGENT` | `1` | Yes | Disable Agent child process |
| `API_PREFIX` | `/api` | No | API route prefix |
| `AGENT_PREFIX` | `/agent` | No | Agent route prefix |

---

## 📊 Port Configuration

- **Development**: Binds to `5174` (configurable via PORT)
- **Production**: Binds to Cloud Run's assigned `$PORT` (usually 8080)
- **Health Checks**: Available on both the main port and port 80
- **Single External Port**: Only port 80 is exposed externally (Autoscale requirement)

---

## 🔧 Troubleshooting

### Health checks still failing?
1. Check deployment logs for startup errors
2. Verify `mono-mode.env` is included in deployment
3. Ensure DATABASE_URL is set in deployment secrets
4. Confirm only ONE `[[ports]]` entry in `.replit`

### App not starting?
1. Check if `start-mono.sh` has execute permissions: `chmod +x start-mono.sh`
2. Verify Node.js version (requires Node 22+)
3. Check that `gateway-server.js` exists
4. Review deployment build logs

### Database connection errors?
1. Verify using **pooled** connection string (ends with `-pooler.neon.tech`)
2. Check connection string includes `?sslmode=require`
3. Ensure DATABASE_URL is set in deployment environment
