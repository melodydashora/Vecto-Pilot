# Vecto Pilot™ Development Tools

This directory contains debugging tools, test scripts, and archived files.

## 📁 Directory Structure

### `/debug/`
Development and debugging utilities:
- **test-v2-router.mjs** - Test LLM router with small prompts
- **hedge-burst-v2.mjs** - Load test router with burst requests
- **test-llm-router.mjs** - Original router test script
- Emergency recovery scripts (eidolon-recovery.sh, cleanup-ports.sh, etc.)
- Port/server debugging tools

### `/archive/`
Archived exports and old versions:
- **vecto-pilot-final.tar.gz** - Project snapshot
- **warehouse/** - Legacy SQL verification queries

## 🧪 Testing LLM Router

**Quick test** (small prompt):
```bash
node tools/debug/test-v2-router.mjs
```

**Load test** (60 concurrent requests):
```bash
node tools/debug/hedge-burst-v2.mjs 60
```

## 🚨 Emergency Recovery

If the Eidolon SDK crashes:
```bash
bash tools/debug/eidolon-recovery.sh
```

If ports are stuck:
```bash
bash tools/debug/cleanup-ports.sh
```

## 📦 Archive

Old exports and legacy code kept for reference only. Not used in production.
