
# 🚀 Deployment Checklist for Vecto Pilot™

## ✅ Pre-Deployment Verification

### Environment Variables (Required)
- [ ] `DATABASE_URL` - PostgreSQL connection string
- [ ] `ANTHROPIC_API_KEY` - Claude Sonnet 4.5
- [ ] `OPENAI_API_KEY` - GPT-5
- [ ] `GEMINI_API_KEY` - Gemini 2.5 Pro
- [ ] `GOOGLE_API_KEY` - Google Maps/Places APIs
- [ ] `AGENT_TOKEN` - Generated with `openssl rand -hex 32`
- [ ] `EIDOLON_TOKEN` - Generated with `openssl rand -hex 32`
- [ ] `ASSISTANT_OVERRIDE_TOKEN` - Generated with `openssl rand -hex 32`
- [ ] `GW_KEY` - Generated with `openssl rand -hex 32`

### Database Setup
- [ ] Run `npm run db:push` to create tables
- [ ] Verify database connection with health check
- [ ] Ensure `PGSSLMODE=require` is set

### Security Configuration
- [ ] All API keys stored in Replit Secrets (not in `.env` file)
- [ ] `NODE_ENV=production` set
- [ ] Rate limiting enabled (already configured)
- [ ] CORS properly configured (already configured)

### Production Settings (Recommended)
```bash
NODE_ENV=production
AGENT_SHELL_WHITELIST=ls,cat,npm,node,git
AGENT_ALLOW_SQL_DDL=false
AGENT_ALLOW_FS_DELETE=false
```

## 🔧 Deployment Configuration

**Run Command**: `npm start`

This will:
1. Start Gateway Server on port 5000
2. Start Eidolon SDK Server on port 3101
3. Start Agent Server on port 43717
4. Serve built client from `/dist`

## 📊 Health Checks

- **Primary**: `GET /health` - Server health status
- **Readiness**: `GET /ready` - Application readiness
- **API Health**: `GET /api/health` - API endpoint status

## 🌐 Deployment Type Recommendations

Based on your architecture:

### **Recommended: Autoscale Deployment**
- ✅ Handles HTTP/WebSocket requests
- ✅ Scales with traffic (cost-effective)
- ✅ 99.95% uptime SLA
- ✅ Multiple instances for high load

### Why Autoscale?
- Your app is a server-based application (Express + React)
- Multi-model AI pipeline benefits from scaling
- GPS/location services have variable traffic
- Cost scales with actual usage

## 🚨 Known Deployment Considerations

1. **Persistent Storage**: Autoscale doesn't have persistent filesystem
   - ✅ You're using PostgreSQL (Neon) - perfect!
   - ✅ All data in database tables
   - ❌ Don't rely on local file storage

2. **Environment Variables**: 
   - Use Replit Secrets UI for all API keys
   - Never commit `.env` to repository

3. **Database Connection**:
   - Ensure connection pooling is configured
   - Use `PGSSLMODE=require` for Neon

4. **Model Timeouts**:
   - Current budget: 120s total (90s for GPT-5)
   - Autoscale timeout: Should handle this fine

## 📝 Deployment Steps

1. **Verify Environment**:
   ```bash
   npm run model:verify
   ```

2. **Build Client**:
   ```bash
   npm run build
   ```

3. **Test Production Build**:
   ```bash
   NODE_ENV=production npm start
   ```

4. **Deploy**:
   - Click **Deploy** button in Replit
   - Select **Autoscale Deployment**
   - Configure domain (optional)
   - Monitor health endpoints

## ✨ Post-Deployment Verification

- [ ] Visit `https://<your-app>.replit.app/health`
- [ ] Test GPS location request
- [ ] Verify AI recommendations generate
- [ ] Check database persistence
- [ ] Monitor error logs
- [ ] Verify API key quotas

## 🔍 Monitoring

**Key Metrics to Watch**:
- Response times (target: p95 ≤ 7s)
- Error rates (target: <1%)
- Database connection pool
- API costs (Claude, GPT-5, Gemini)
- LLM timeout rates

## 📞 Support Resources

- Architecture: `ARCHITECTUREV2.md`
- Deployment Guide: `DEPLOYMENT-README.md`
- Troubleshooting: Check health endpoints and logs

---

**Status**: ✅ Application is deployment-ready with Autoscale configuration
