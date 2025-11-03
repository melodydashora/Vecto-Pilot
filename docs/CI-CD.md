# CI/CD Pipeline Documentation

## 🎯 Overview

Vecto Pilot uses **GitHub Actions** for continuous integration and deployment, ensuring code quality and contract compliance through automated testing.

## 📋 Workflow Architecture

### Three-Tier Workflow Strategy

| Workflow | Trigger | Duration | Purpose |
|----------|---------|----------|---------|
| **PR Checks** | Pull request opened/updated | ~2 min | Quick linting & TypeScript |
| **CI Tests** | Push to main/merge | ~8 min | Full test suite (Jest + Playwright) |
| **Deploy Preview** | Pull request | ~1 min | Deployment preview comment |

---

## 🔧 Workflow Files

### 1. Main CI Workflow
**File**: `.github/workflows/ci.yml`

**Triggers**:
- Push to `main` or `master` branch
- Pull request to `main` or `master`

**Steps**:
1. ✅ Checkout code
2. ✅ Setup Node.js 20 with npm cache
3. ✅ Install dependencies (`npm ci`)
4. ✅ Spin up PostgreSQL 15 service
5. ✅ Run database migrations (`npm run db:push`)
6. ✅ Seed test database (`node scripts/seed-dev.js`)
7. ✅ Run Jest unit tests (19 tests)
8. ✅ Install Playwright browsers
9. ✅ Start dev server (background)
10. ✅ Wait for server readiness
11. ✅ Run Playwright E2E tests (14 tests)
12. ✅ Upload test artifacts (reports, screenshots)
13. ✅ Generate test summary

**Total**: 33 automated tests (19 Jest + 14 Playwright)

**Environment Variables**:
```yaml
DATABASE_URL: postgresql://dev:dev@localhost:5432/vecto_ci
NODE_ENV: test
CI: true
```

---

### 2. PR Quick Checks
**File**: `.github/workflows/pr-checks.yml`

**Triggers**:
- Pull request opened
- Pull request synchronized (new commits)
- Pull request reopened

**Steps**:
1. ✅ TypeScript compilation check
2. ✅ ESLint validation
3. ✅ Package.json change detection
4. ✅ Generate PR summary

**Purpose**: Fast feedback loop (~2 minutes) to catch syntax errors before full CI runs.

---

### 3. Deploy Preview
**File**: `.github/workflows/deploy-preview.yml`

**Triggers**:
- Pull request opened/updated

**Steps**:
1. ✅ Post deployment preview comment
2. ✅ Include testing checklist
3. ✅ Provide local testing commands

**Purpose**: Guide developers through testing and deployment process.

---

## 🗃️ PostgreSQL Service

### Configuration
```yaml
services:
  postgres:
    image: postgres:15
    env:
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: vecto_ci
    ports:
      - 5432:5432
    options: >-
      --health-cmd="pg_isready -U dev -d vecto_ci"
      --health-interval=10s
      --health-timeout=5s
      --health-retries=5
```

### Features
- ✅ **PostgreSQL 15**: Latest stable version
- ✅ **Health checks**: Ensures database is ready before tests
- ✅ **Isolated environment**: Fresh database per workflow run
- ✅ **Fast startup**: ~10 seconds with health checks

---

## 📊 Test Execution

### Jest Unit Tests
```bash
TEST_SNAPSHOT_ID=test-snapshot-001 \
NODE_OPTIONS='--experimental-vm-modules' \
npx jest tests/blocksApi.test.js --ci --runInBand --verbose
```

**Flags**:
- `--ci`: Optimized for CI environment
- `--runInBand`: Run serially (avoid race conditions)
- `--verbose`: Detailed output

**Coverage**: 19 tests validating Block Schema Contract

---

### Playwright E2E Tests
```bash
npx playwright test tests/e2e/copilot.spec.ts
```

**Features**:
- ✅ Chromium browser testing
- ✅ Screenshots on failure
- ✅ Test traces for debugging
- ✅ Parallel execution

**Coverage**: 14 tests validating UI rendering

---

## 🚀 Local Development Workflow

### Before Pushing Code

```bash
# 1. Run complete test suite
./scripts/test-all.sh

# 2. Check TypeScript
npm run typecheck

# 3. Run linter
npm run lint

# 4. Review changes
git diff

# 5. Commit and push
git add .
git commit -m "feat: add new block type"
git push origin feature-branch
```

---

## 🔄 PR → Merge → Deploy Flow

### Step 1: Create Pull Request
```bash
git checkout -b feature/new-block-type
# ... make changes ...
git push origin feature/new-block-type
# Create PR on GitHub
```

**Automatic Actions**:
- ✅ PR Checks workflow runs (~2 min)
- ✅ Deploy Preview posts comment
- ✅ CI workflow runs full tests (~8 min)

### Step 2: Review & Address Feedback
- Check CI status badge
- Review test results
- Fix any failures
- Push updates (triggers re-run)

### Step 3: Merge to Main
```bash
# After approval, merge PR
```

**Automatic Actions**:
- ✅ CI workflow runs on main branch
- ✅ Full test suite validates merge
- ✅ Deployment triggered (if configured)

### Step 4: Verify Deployment
- Check production deployment
- Verify features work
- Monitor error logs

---

## 📈 CI Status Badges

Add to your `README.md`:

```markdown
![CI Status](https://github.com/YOUR-USERNAME/YOUR-REPO/workflows/CI/badge.svg)
```

Shows:
- ✅ Green: All tests passing
- ❌ Red: Tests failing
- 🟡 Yellow: Tests running

---

## 🐛 Troubleshooting CI Failures

### Jest Tests Failing

**Symptom**: "Missing base field: id"
```bash
# Fix: Check API response structure
curl http://localhost:5000/api/blocks/strategy/test-snapshot-001
```

**Symptom**: "Unknown block type"
```javascript
// Fix: Update schema in tests/blocksApi.test.js
const blockSchema = {
  types: {
    newType: ["requiredField"]
  }
};
```

---

### Playwright Tests Failing

**Symptom**: "Timeout waiting for element"
```yaml
# Fix: Increase server wait time in ci.yml
- name: Wait for server to be ready
  run: |
    for i in {1..60}; do  # Increased from 30
      # ... wait logic ...
    done
```

**Symptom**: "Browser not found"
```yaml
# Fix: Ensure browsers installed
- name: Install Playwright browsers
  run: npx playwright install --with-deps chromium
```

---

### Database Migration Failures

**Symptom**: "relation does not exist"
```bash
# Fix: Force push schema changes
npm run db:push --force
```

**Symptom**: "Connection refused"
```yaml
# Fix: Check PostgreSQL service health
services:
  postgres:
    options: >-
      --health-cmd="pg_isready -U dev -d vecto_ci"
```

---

## 📦 Artifacts

### Test Reports
- **Playwright HTML Report**: Detailed test results with screenshots
- **Retention**: 7 days
- **Access**: Download from workflow run

### Screenshots
- **When**: Only on test failure
- **Format**: PNG images
- **Location**: `test-results/` directory
- **Retention**: 7 days

---

## 🔒 Security Best Practices

### Secrets Management
```yaml
# Never commit secrets to code
# Use GitHub Secrets for sensitive values
env:
  API_KEY: ${{ secrets.API_KEY }}
  DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

### Database Security
- ✅ Isolated test database per run
- ✅ Temporary credentials (dev/dev)
- ✅ No production data in CI
- ✅ Database destroyed after workflow

---

## ⚙️ Configuration Files

### Required Files
```
.github/
├── workflows/
│   ├── ci.yml              # Main CI workflow
│   ├── pr-checks.yml       # Quick PR validation
│   └── deploy-preview.yml  # Deployment comments
├── PULL_REQUEST_TEMPLATE.md
└── dependabot.yml          # (optional) Dependency updates
```

### Test Files
```
tests/
├── blocksApi.test.js       # Jest unit tests
├── e2e/
│   ├── copilot.spec.ts     # Playwright E2E tests
│   └── README.md
└── README-BLOCKS.md

scripts/
├── seed-dev.js             # Test data seeding
├── test-with-seed.sh       # Jest test runner
└── test-all.sh             # Complete test suite
```

---

## 📊 Performance Metrics

### Typical Workflow Times

| Stage | Duration | Parallel |
|-------|----------|----------|
| Checkout & Setup | 30s | No |
| Install Dependencies | 45s | No |
| Database Setup | 10s | No |
| Migrations | 15s | No |
| Seed Data | 5s | No |
| Jest Tests | 30s | No |
| Playwright Install | 60s | No |
| Server Startup | 20s | No |
| Playwright Tests | 90s | Yes |
| Artifact Upload | 15s | No |
| **Total** | **~8 min** | Mixed |

### Optimization Tips
1. Use `npm ci` instead of `npm install` (faster, deterministic)
2. Cache npm dependencies with `cache: 'npm'`
3. Run tests in parallel when possible
4. Use `--runInBand` for database-dependent tests
5. Skip Playwright install on PR checks (use main CI only)

---

## 🎯 Success Criteria

Your CI pipeline should:
- ✅ Complete in under 10 minutes
- ✅ Catch schema drift before merge
- ✅ Validate both contract and UX
- ✅ Provide clear failure messages
- ✅ Upload artifacts for debugging
- ✅ Generate test summaries

---

## 🔗 Related Documentation

- [Testing Guide](TESTING-GUIDE.md) - Complete testing overview
- [Block Schema Contract](BLOCK-SCHEMA-CONTRACT.md) - Contract specification
- [Jest Tests README](../tests/README-BLOCKS.md) - Unit test details
- [Playwright Tests README](../tests/e2e/README.md) - E2E test details

---

## 📞 Support

### GitHub Actions Documentation
- [Workflow syntax](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions)
- [PostgreSQL service](https://docs.github.com/en/actions/using-containerized-services/creating-postgresql-service-containers)
- [Artifacts](https://docs.github.com/en/actions/using-workflows/storing-workflow-data-as-artifacts)

### Debugging Workflows
```bash
# Enable debug logging
# Settings → Secrets → New repository secret
# Name: ACTIONS_RUNNER_DEBUG
# Value: true
```

---

**Version**: 1.0.0  
**Last Updated**: 2025-11-03  
**Status**: Production Ready ✅
