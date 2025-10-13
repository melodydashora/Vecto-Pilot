# ✅ Package Verification Checklist

## Package Integrity Check

Run these commands to verify the package is complete and ready for deployment:

### 1. File Count Verification
```bash
find Mega_Assistant_Port -type f | wc -l
# Expected: 43 files
```

### 2. Code Statistics
```bash
find Mega_Assistant_Port -type f \( -name "*.js" -o -name "*.ts" \) | xargs wc -l 2>/dev/null | tail -1
# Expected: ~6,500+ lines
```

### 3. Required Files Check
```bash
# Core servers (must exist)
ls -lh Mega_Assistant_Port/servers/*.js

# Configuration (must exist)
ls -lh Mega_Assistant_Port/config/

# Documentation (must exist)
ls -lh Mega_Assistant_Port/*.md
```

### 4. Dependencies Verification
```bash
cd Mega_Assistant_Port
npm install --dry-run
# Should complete without errors
```

### 5. Environment Template Check
```bash
grep -E "^(AGENT_TOKEN|EIDOLON_TOKEN|GW_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|DATABASE_URL)" Mega_Assistant_Port/config/.env.template
# Should show all required variables
```

## Installation Test

### Quick Install Test
```bash
cd Mega_Assistant_Port

# 1. Install dependencies
npm install

# 2. Verify scripts
npm run --silent | grep -E "(dev|eidolon|agent|gateway|setup)"

# 3. Check executables
test -x scripts/setup.sh && echo "✅ Setup script is executable" || echo "❌ Setup script not executable"
```

### Database Test (with PostgreSQL)
```bash
# Create test database
createdb mega_assistant_test

# Set DATABASE_URL
export DATABASE_URL=postgresql://localhost/mega_assistant_test

# Test schema push (dry run)
npm run db:push --dry-run
```

## Documentation Verification

### All Docs Present
```bash
ls -1 Mega_Assistant_Port/*.md
# Expected output:
# INDEX.md
# INSTALLATION.md
# LICENSE (not .md)
# MANIFEST.md
# PACKAGE_SUMMARY.md
# README.md
# VERIFICATION.md
```

### Docs Size Check
```bash
wc -l Mega_Assistant_Port/*.md
# Total should be 1000+ lines of documentation
```

## Security Verification

### No Secrets in Code
```bash
# Should return empty (no secrets committed)
grep -r "sk-ant-" Mega_Assistant_Port/ 2>/dev/null
grep -r "sk-" Mega_Assistant_Port/ 2>/dev/null | grep -v ".env.template"
```

### Token Template Verification
```bash
grep "your_64_char_hex_token_here" Mega_Assistant_Port/config/.env.template
# Should find placeholder tokens (not real ones)
```

## Functional Tests

### Server Files Syntax Check
```bash
# Check for syntax errors
node --check Mega_Assistant_Port/servers/gateway-server.js
node --check Mega_Assistant_Port/servers/eidolon-sdk-server.js
node --check Mega_Assistant_Port/servers/agent-server.js
```

### JSON Configuration Validation
```bash
cd Mega_Assistant_Port
npm run validate-json
# Should complete without errors
```

### Helper Scripts Test
```bash
cd Mega_Assistant_Port

# Test which-assistant script
node scripts/which-assistant.mjs
# Should execute without errors

# Test JSON validator
node scripts/find-json-errors.mjs
# Should scan files without errors
```

## Pre-Deployment Checklist

Before deploying, verify:

- [ ] All 43 files present
- [ ] ~6,500 lines of code
- [ ] Dependencies install without errors
- [ ] No secrets in codebase
- [ ] All scripts are executable
- [ ] Documentation is complete
- [ ] JSON files are valid
- [ ] Server files have no syntax errors
- [ ] Environment template has all required variables

## Quick Verification Script

Run this one-liner to verify everything:

```bash
cd Mega_Assistant_Port && \
echo "Files: $(find . -type f | wc -l)" && \
echo "Code Lines: $(find . -type f \( -name '*.js' -o -name '*.ts' \) | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')" && \
echo "Docs: $(ls -1 *.md 2>/dev/null | wc -l) files" && \
echo "Servers: $(ls -1 servers/*.js 2>/dev/null | wc -l) files" && \
npm install --silent && \
npm run validate-json && \
echo "✅ Package verification complete!"
```

## Expected Output

```
Files: 43
Code Lines: 6577
Docs: 6 files
Servers: 3 files
✅ Package verification complete!
```

## Deployment Test (Optional)

### Local Test Run
```bash
cd Mega_Assistant_Port

# Setup test environment
cp config/.env.template .env
# Edit .env with test values

# Create test database
createdb mega_assistant_test_deploy

# Run setup
npm run setup

# Start servers (Ctrl+C to stop)
npm run dev
```

### Verify Running Services
```bash
# Check Gateway
curl http://localhost:5000/api/diagnostics

# Check ports
lsof -i :5000
lsof -i :3101
lsof -i :43717
```

## Troubleshooting Verification

If any check fails:

1. **File count mismatch**
   - Re-run the copy commands
   - Check for hidden files with `ls -la`

2. **Syntax errors**
   - Check Node.js version (must be 20+)
   - Verify file encoding (should be UTF-8)

3. **Missing dependencies**
   - Delete `node_modules` and `package-lock.json`
   - Run `npm install` again

4. **Script not executable**
   ```bash
   chmod +x scripts/*.sh
   chmod +x scripts/*.mjs
   ```

## Final Sign-Off

✅ Package is ready when all checks pass and the quick verification script completes successfully.

---

**Verified On**: $(date)  
**Node Version**: $(node -v)  
**NPM Version**: $(npm -v)
