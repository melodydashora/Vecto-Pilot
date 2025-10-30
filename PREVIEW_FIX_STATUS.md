# Preview Reliability Fix Status

## ⚠️ PREVIEW NOT YET RESOLVING - Manual Configuration Required

This document provides a transparent status of the preview reliability implementation and what remains to be done.

---

## What Was Built

### ✅ Infrastructure Components Created
1. **`scripts/start-replit.js`** - Health-gated entry point with 15-second timeout
   - Polls `/api/health` before declaring boot success
   - Sets PORT=5000 deterministically
   - Fast-fails on health timeout

2. **`start-clean.sh`** - Zombie process killer
   - Kills leftover `node gateway-server.js` processes
   - Prevents EADDRINUSE port conflicts
   - Cleans `.cache` artifacts

3. **`/api/health` endpoint** - Added to gateway-server.js
   - Returns `{"ok":true,"port":5000,"mode":"mono"}`
   - Responds instantly before other middleware

4. **Strategy provider validation** - Already exists in codebase
   - `assertStrategies()` validates on boot
   - Fast-fails if providers missing

### ✅ Code Hygiene Completed
1. **Removed greyed imports** from `server/lib/venue-enrichment.js`
   - `getPlaceHours`, `findPlaceIdByText` were imported but never used
   - Added annotation documenting removal (CorrelationId: ENRICH-412)
   - Functions still legitimately used in `server/lib/venue-discovery.js`

2. **Documented in replit.md** with strikethrough history
   - New "Code Hygiene & Import Management" section
   - "Import History (Strikethrough Record)" with removal details
   - "Preview Reliability Status" explaining current state

---

## ⚠️ Why Preview Still Not Resolving

### Root Cause
The `.replit` workflow is configured to run `node gateway-server.js` directly WITHOUT using the health-gated entry point we built.

**Current workflow configuration (line 31 in .replit):**
```ini
args = "set -a && source mono-mode.env && set +a && node gateway-server.js"
```

This bypasses:
- Health gate polling
- `scripts/start-replit.js` entry point
- Zombie process cleanup

**Result**: Preview opens before server signals readiness, causing "not resolving" state.

---

## 🔧 Manual Configuration Required

These files are **restricted from automated edits** and require manual updates:

### 1. Update `.replit` File

**Location**: Line 31 in `.replit`

**Change from:**
```ini
[[workflows.workflow.tasks]]
task = "shell.exec"
args = "set -a && source mono-mode.env && set +a && node gateway-server.js"
```

**Change to (Option A - Health-gated entry):**
```ini
[[workflows.workflow.tasks]]
task = "shell.exec"
args = "set -a && source mono-mode.env && set +a && npm run start:replit"
```

**Change to (Option B - With zombie cleanup):**
```ini
[[workflows.workflow.tasks]]
task = "shell.exec"
args = "set -a && source mono-mode.env && set +a && ./start-clean.sh"
```

### 2. Update `package.json` Scripts

**Location**: `package.json` lines 7-9 (scripts section)

**Add these lines:**
```json
"prestart:replit": "npm run agent:build",
"start:replit": "node scripts/start-replit.js",
```

**Full context:**
```json
{
  "scripts": {
    "prestart:replit": "npm run agent:build",
    "start:replit": "node scripts/start-replit.js",
    "start": "NODE_ENV=production node gateway-server.js",
    "dev": "NODE_ENV=development node gateway-server.js",
    // ... rest of scripts
  }
}
```

---

## ✅ Verification Steps (After Manual Configuration)

1. **Restart workflow** via Replit UI
2. **Watch logs** for `[boot] ✅ Health check passed`
3. **Check preview** should auto-resolve when health gate succeeds
4. **Test endpoint:**
   ```bash
   curl http://localhost:5000/api/health
   # Expected: {"ok":true,"port":5000,"mode":"mono"}
   ```

---

## 📋 Current Server Status

### Server IS Running
```bash
$ lsof -i :5000
COMMAND   PID   USER FD   TYPE   DEVICE SIZE/OFF NODE NAME
node    25588 runner 18u  IPv4 78055483      0t0  TCP *:5000 (LISTEN)
```

### Health Endpoint IS Responding
```bash
$ curl http://localhost:5000/api/health
{"ok":true,"port":5000,"mode":"mono"}
```

### Root Endpoint IS Responding
```bash
$ curl -I http://localhost:5000/
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
```

**Conclusion**: Server is healthy, but preview doesn't resolve because workflow doesn't use health gate.

---

## 🎯 Next Steps

1. **User**: Manually update `.replit` line 31 (choose Option A or B above)
2. **User**: Manually add `start:replit` scripts to `package.json`
3. **User**: Restart workflow via Replit UI
4. **Verify**: Preview should auto-resolve
5. **Document**: Update replit.md "Preview Reliability Status" to ✅ when confirmed working

---

## 📝 Documentation Trail

All changes documented in `replit.md`:
- **Section**: "Code Hygiene & Import Management" - Unused import policy
- **Section**: "Import History (Strikethrough Record)" - Greyed import removal
- **Section**: "Preview Reliability Status" - Current state and manual steps

---

## ⚠️ Honest Assessment

**What We Accomplished:**
- Built all infrastructure for reliable preview resolution
- Removed code hygiene issues (greyed imports)
- Documented everything with strikethrough history

**What Remains:**
- Manual `.replit` configuration (file is restricted)
- Manual `package.json` update (file is restricted)
- User verification that preview resolves after changes

**Status**: Infrastructure complete, waiting on manual configuration to activate.
