# DEFINITION OF DONE — FULL SYSTEM VALIDATION

**Execution Mode:** evidence_first  
**AI Parameters:** temp=0.0, reasoning=deep, structured thinking  
**Approach:** Nothing is little - every detail proven with raw evidence

---

## CRITICAL FIXES APPLIED

### 1. Agent Health Endpoint Added
**File:** `agent-server.js:230-238`
```javascript
app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    service: "agent",
    status: "healthy",
    port: PORT,
    t: new Date().toISOString()
  });
});
```

### 2. Snapshot Route Enhanced for Query Params
**File:** `server/routes/snapshot.js:40-47`
```javascript
// Accept lat/lng from query params OR body
const latFromQuery = req.query.lat ? Number(req.query.lat) : null;
const lngFromQuery = req.query.lng ? Number(req.query.lng) : null;

const { lat: latFromBody, lng: lngFromBody, context, meta } = req.body || {};

const lat = latFromQuery ?? latFromBody;
const lng = lngFromQuery ?? lngFromBody;
```

### 3. Snapshot Response Changed to 201 with Artifact Metadata
**File:** `server/routes/snapshot.js:139-154`
```javascript
return res.status(201).json({ 
  ok: true, 
  artifactId: snapshot_id,
  artifactPath: `database://snapshots/${snapshot_id}`,
  snapshot: {
    snapshot_id,
    lat,
    lng,
    city: dbSnapshot.city,
    state: dbSnapshot.state,
    timezone: dbSnapshot.timezone,
    created_at: dbSnapshot.created_at.toISOString()
  },
  received_at: started, 
  req_id: reqId 
});
```

### 4. Diagnostics Routing Fixed
**File:** `gateway-server.js:193`
```javascript
// Before: ['/assistant', '/api', '/socket.io']
// After:  ['/assistant', '/api', '/diagnostics', '/socket.io']
```

### 5. AI Config Loaded and Logged
**Files:** `agent-ai-config.js`, `gateway-server.js:20`, `index.js:66`
- Temperature: 0.0
- Reasoning depth: deep
- Execution mode: evidence_first

---

## VERIFICATION COMMANDS

**IMPORTANT:** Click **Stop** then **Run** button first, wait 30 seconds, then execute:

```bash
# Save all output to evidence file
./test-verification.sh 2>&1 | tee verification-evidence.txt
```

Or run individually:

```bash
# 1. Ports Snapshot #1 (@ T+0s)
lsof -i -P -n | grep LISTEN | grep -E ':(80|3101|43717|5173)'

# 2. Gateway Health (Pre-test)
curl -i http://localhost/healthz

# 3. Comprehensive Status
curl -s http://localhost/status | python3 -m json.tool

# 4. Location API via Gateway
curl -i "http://localhost/api/location/resolve?lat=33.1286&lng=-96.8756"

# 5. Location API Direct to SDK
curl -i "http://127.0.0.1:3101/location/resolve?lat=33.1286&lng=-96.8756"

# 6. Snapshot via Gateway (Query Params)
curl -i -X POST "http://localhost/api/location/snapshot?lat=33.1286&lng=-96.8756"

# 7. Snapshot Direct to SDK (Query Params)
curl -i -X POST "http://127.0.0.1:3101/location/snapshot?lat=33.1286&lng=-96.8756"

# 8. Memory Diagnostics (JSON not HTML)
curl -i http://localhost/diagnostics/memory

# 9. Save Preference
curl -i -X POST http://localhost/diagnostics/prefs \
  -H "Content-Type: application/json" \
  -d '{"key":"driver_mode","value":"tactical"}'

# 10. Agent Health via Gateway
curl -i http://localhost/agent/healthz

# 11. Error Boundary - Unknown API
curl -i http://localhost/api/nonexistent

# 12. Wait 2 minutes for stability
sleep 120

# 13. Ports Snapshot #2 (@ T+120s)
lsof -i -P -n | grep LISTEN | grep -E ':(80|3101|43717|5173)'

# 14. Gateway Health (Post-test)
curl -i http://localhost/healthz
```

---

## EXPECTED RESULTS CHECKLIST

### ✅ Ports Stable
- **Requirement:** 4 ports listening (80, 3101, 43717, 5173) twice, ≥2min apart
- **Evidence Required:** Two lsof outputs showing all 4 LISTEN states
- **Pass Criteria:** Same 4 ports in both snapshots

### ✅ Gateway Health
- **Requirement:** `/healthz` returns 200 JSON pre and post tests
- **Evidence Required:** Two curl -i outputs with HTTP/1.1 200 OK
- **Pass Criteria:** `{"ok":true,"gateway":true,"t":"..."}`

### ✅ API JSON via Gateway  
- **Requirement:** `/api/location/resolve` returns 200, Content-Type: application/json
- **Evidence Required:** curl -i output with headers + body
- **Pass Criteria:** `{"city":"Frisco","state":"TX",...}`

### ✅ API JSON Direct to SDK
- **Requirement:** Direct SDK call returns matching JSON
- **Evidence Required:** curl -i output
- **Pass Criteria:** Same keys as gateway response

### ✅ Snapshot Creation Parity
- **Requirement:** Both gateway and direct return 201 with artifactId, artifactPath, snapshot
- **Evidence Required:** Two curl -i outputs (gateway + direct)
- **Pass Criteria:** `HTTP/1.1 201`, `{"ok":true,"artifactId":"...","artifactPath":"database://snapshots/...","snapshot":{...}}`

### ✅ Diagnostics JSON (Not HTML)
- **Requirement:** `/diagnostics/memory` returns JSON
- **Evidence Required:** curl -i output with Content-Type: application/json
- **Pass Criteria:** `{"ok":true,"recent":[...],"agentMem":{...},"summary":{...}}`

### ✅ Agent Health via Gateway
- **Requirement:** `/agent/healthz` returns 200 JSON  
- **Evidence Required:** curl -i output
- **Pass Criteria:** `{"ok":true,"service":"agent","status":"healthy",...}`

### ✅ Process Lifetime
- **Requirement:** Gateway foreground, no restarts, stable PIDs
- **Evidence Required:** ps output, gateway console timestamps
- **Pass Criteria:** Continuous output, no "restarting" messages

### ✅ Error Boundaries
- **Requirement:** Unknown `/api/*` returns 404 JSON (not HTML)
- **Evidence Required:** curl -i http://localhost/api/nonexistent
- **Pass Criteria:** `HTTP/1.1 404`, `Content-Type: application/json`, `{"error":"not_found",...}`

### ✅ Memory Live
- **Requirement:** No unused imports, diagnostics functional
- **Evidence Required:** LSP clean, curl outputs showing paths/counters
- **Pass Criteria:** All memory imports referenced, diagnostics return data

### ✅ AI Config Active
- **Requirement:** Loaded and logged at boot
- **Evidence Required:** Gateway console shows `[gateway] AI Config: {...}`
- **Pass Criteria:** `temperature: 0`, `reasoning_depth: "deep"`, `execution_mode: "evidence_first"`

### ✅ Dev/Prod Parity
- **Requirement:** No publish/deploy used
- **Evidence:** This validation runs on localhost development environment
- **Parity Plan:** Same routing, guards, memory, and error handling in both

---

## REPORT FORMAT

After running all commands, fill in:

**PASSING:** [X/12]

**FAILING:** [X/12]

**First Failure:** [Check name if any]

**Smallest Fix Needed:** [Specific code change if failing]

**Evidence Files:** 
- verification-evidence.txt
- Gateway console output
- .logs/sdk.log
- .logs/agent.log

**Conclusion:** [Single sentence: PASS or FAIL with reason]

**Parity Note:** No publish/deploy used. All validation performed on localhost development environment.

**Humility Line:** If any check regresses, I will stop and present raw evidence plus the smallest fix.

---

## SYNTAX VERIFICATION (Pre-restart)

```
✓ agent-server.js syntax OK
✓ snapshot.js syntax OK  
✓ gateway-server.js syntax OK
✓ LSP diagnostics: CLEAN (0 errors)
```

All critical files verified. Ready for restart and validation.
