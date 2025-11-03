# Contributing to Vecto Pilot

Thank you for your interest in contributing to Vecto Pilot! This document provides guidelines and requirements for contributors.

---

## 🚦 Quick Start for Contributors

Before opening a PR, ensure you complete these steps:

### 1. Run Database Migrations
```bash
npm run db:push
```

If you encounter data-loss warnings, force the push:
```bash
npm run db:push --force
```

### 2. Seed the Database
```bash
node scripts/seed-dev.js
```

This creates test data:
- Snapshot: `test-snapshot-001`
- Strategy with consolidated text
- Briefing data

### 3. Run All Tests
```bash
# Complete test suite (recommended)
./scripts/test-all.sh

# Or run individually:
npm run test:blocks           # Jest unit tests (19)
npx playwright test           # Playwright E2E tests (14)
```

### 4. Code Quality Checks
```bash
# TypeScript compilation
npm run typecheck

# ESLint validation
npm run lint
```

### 5. Check CI Badge

Your PR will **not be merged** unless the CI badge is green ✅.

[![CI](https://github.com/YOUR-ORG/vecto-pilot/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR-ORG/vecto-pilot/actions/workflows/ci.yml)

Clicking the badge shows you the GitHub Actions run logs.

---

## ✅ CI Enforcement

Our CI pipeline enforces:

- ✅ **Schema contract** (Jest unit tests)
- ✅ **Block API contract** (Jest unit tests)
- ✅ **UI rendering** (Playwright E2E tests)
- ✅ **End-to-end workflow** (Seed → API → UI)
- ✅ **TypeScript compilation** (no errors)
- ✅ **ESLint validation** (code quality)

---

## 🔒 Workflow Contract Rules

### Critical: Respect the Workflow Contract

**1. Never Overwrite Rows**
- Retries always create **new snapshots**
- Strategy history is **immutable**
- Each retry gets a unique snapshot ID

**2. Only Allowed Status Transitions**
```
pending → complete
pending → failed
pending → write_failed
```

Invalid transitions will be rejected by the database.

**3. SSE (`strategy_ready`) is Single Source of Truth**
- Frontend listens to SSE events only
- No polling the database
- Status updates emit NOTIFY events

**4. Update Documentation**
- If you add new statuses, update `/docs/StrategyWorkflow.md`
- If you add new block types, update `/docs/BLOCK-SCHEMA-CONTRACT.md`

---

## 📝 Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Formatting, missing semicolons, etc.
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: Performance improvement
- `test`: Adding missing tests
- `chore`: Updating build tasks, package manager configs, etc.

### Examples
```bash
feat(blocks): add image block type with caption support

fix(strategy): ensure summary field is always populated

docs(testing): update Playwright E2E test guide

test(api): add contract validation for quote blocks
```

---

## 🌿 Branch Naming Convention

```
<type>/<short-description>
```

### Examples
```bash
feature/image-block-type
fix/strategy-summary-missing
docs/update-contributing-guide
test/add-quote-block-validation
```

---

## 🔧 Development Workflow

### 1. Fork and Clone
```bash
git clone https://github.com/YOUR-USERNAME/vecto-pilot.git
cd vecto-pilot
```

### 2. Create Feature Branch
```bash
git checkout -b feature/amazing-feature
```

### 3. Make Changes
- Edit code
- Add tests
- Update documentation

### 4. Test Locally
```bash
./scripts/test-all.sh
```

### 5. Commit Changes
```bash
git add .
git commit -m "feat: add amazing feature"
```

### 6. Push to Fork
```bash
git push origin feature/amazing-feature
```

### 7. Create Pull Request
- Go to GitHub
- Click "New Pull Request"
- Fill out PR template
- Wait for CI checks ✅

---

## 🧪 Testing Requirements

### All PRs Must Include Tests

**For new features:**
- Add Jest unit tests for API contracts
- Add Playwright E2E tests for UI components
- Update test documentation

**For bug fixes:**
- Add regression tests
- Ensure fix doesn't break existing tests

**For refactoring:**
- All existing tests must pass
- No decrease in test coverage

### Test File Locations
```
tests/
├── blocksApi.test.js       # Jest unit tests
├── e2e/
│   └── copilot.spec.ts     # Playwright E2E tests
└── README-BLOCKS.md         # Test documentation
```

---

## 📦 Adding a New Block Type

If you're adding a new block type, you **must** update:

### 1. Schema Definition
Update `tests/blocksApi.test.js`:
```javascript
const blockSchema = {
  base: ["id", "type", "order"],
  types: {
    // ... existing types
    newType: ["requiredField1", "requiredField2"]
  }
};
```

### 2. SmartBlock Component
Update `client/src/components/SmartBlock.tsx`:
```tsx
case 'newType':
  return (
    <div data-testid={`block-${block.id}`}>
      {block.requiredField1}
    </div>
  );
```

### 3. Content Blocks API
Update `server/routes/content-blocks.js`:
```javascript
blocks.push({
  id: `b${order++}`,
  type: 'newType',
  order: blocks.length + 1,
  requiredField1: 'value',
  requiredField2: 'value'
});
```

### 4. Tests
Add validation tests:
```javascript
it("validates newType block", () => {
  const validBlock = {
    id: "b1",
    type: "newType",
    order: 1,
    requiredField1: "test",
    requiredField2: "test"
  };
  
  expect(() => validateBlock(validBlock)).not.toThrow();
});
```

### 5. Documentation
Update `docs/BLOCK-SCHEMA-CONTRACT.md` with new block type specification.

---

## 🗄️ Database Changes

### Schema Modifications

**1. Edit Drizzle Schema**
```typescript
// shared/schema.js
export const myTable = pgTable("my_table", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // ... more fields
});
```

**2. Push Changes**
```bash
npm run db:push
```

If you get data-loss warning:
```bash
npm run db:push --force
```

**3. Update Seed Script**
If needed, update `scripts/seed-dev.js` to include new tables/fields.

### Migration Best Practices

- ✅ **Never** manually write SQL migrations
- ✅ **Always** use Drizzle schema + `npm run db:push`
- ✅ **Test** migrations locally before pushing
- ✅ **Document** schema changes in PR description
- ✅ **Update** TypeScript types if needed

---

## 🎨 Code Style

### TypeScript

```typescript
// Good
interface Block {
  id: string;
  type: BlockType;
  order: number;
}

// Bad
interface Block {
  id:string;type:BlockType;order:number
}
```

### React Components

```tsx
// Good - Functional components with TypeScript
interface Props {
  block: Block;
}

export function SmartBlock({ block }: Props) {
  return <div>{block.text}</div>;
}

// Bad - No types
export function SmartBlock({ block }) {
  return <div>{block.text}</div>;
}
```

### Async/Await

```javascript
// Good
async function fetchData() {
  try {
    const result = await apiCall();
    return result;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

// Bad
function fetchData() {
  return apiCall().then(result => {
    return result;
  }).catch(error => {
    console.error('Error:', error);
  });
}
```

---

## 📋 Pull Request Checklist

Before submitting your PR, verify:

- [ ] Code follows project style guidelines
- [ ] All tests pass locally (`./scripts/test-all.sh`)
- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] ESLint passes (`npm run lint`)
- [ ] Added tests for new features/fixes
- [ ] Updated documentation if needed
- [ ] Commit messages follow conventional format
- [ ] PR description explains what/why
- [ ] Linked related issues
- [ ] CI badge is green ✅

---

## 🐛 Reporting Bugs

### Before Reporting

1. Check existing issues
2. Try latest version
3. Run `./scripts/test-all.sh` locally

### Bug Report Template

```markdown
**Describe the bug**
A clear description of what the bug is.

**To Reproduce**
Steps to reproduce:
1. Go to '...'
2. Click on '....'
3. See error

**Expected behavior**
What you expected to happen.

**Screenshots**
If applicable, add screenshots.

**Environment:**
- OS: [e.g. macOS, Ubuntu]
- Node version: [e.g. 20.0.0]
- Browser: [e.g. Chrome, Firefox]

**Additional context**
Any other context about the problem.
```

---

## 💡 Suggesting Features

### Feature Request Template

```markdown
**Is your feature request related to a problem?**
A clear description of what the problem is.

**Describe the solution**
What you want to happen.

**Describe alternatives**
Alternative solutions you've considered.

**Additional context**
Any other context or screenshots.
```

---

## 📚 Documentation

### Required Documentation Updates

When you change:
- **API contracts** → Update `docs/api/`
- **Block schema** → Update `docs/BLOCK-SCHEMA-CONTRACT.md`
- **Workflow logic** → Update `docs/StrategyWorkflow.md`
- **Testing** → Update `tests/README-BLOCKS.md` or `tests/e2e/README.md`
- **CI/CD** → Update `docs/CI-CD.md`

---

## 🤝 Code Review Process

### For Reviewers

1. **Check CI Status**: Must be green ✅
2. **Review Code**: Check for quality, security, performance
3. **Test Locally**: Run `./scripts/test-all.sh`
4. **Check Documentation**: Ensure docs are updated
5. **Approve or Request Changes**

### For Contributors

1. **Address Feedback**: Make requested changes
2. **Update PR**: Push changes to same branch
3. **Re-request Review**: Notify reviewers
4. **Be Patient**: Reviews take time

---

## ⚡ Performance Guidelines

### Frontend

- ✅ Use React.memo() for expensive components
- ✅ Lazy load routes with React.lazy()
- ✅ Optimize images (WebP format)
- ✅ Minimize bundle size

### Backend

- ✅ Use database indexes
- ✅ Implement caching where appropriate
- ✅ Batch database queries
- ✅ Use connection pooling

### Testing

- ✅ Keep unit tests under 1 second each
- ✅ Keep E2E tests under 30 seconds total
- ✅ Use test data seeding for consistency

---

## 🔒 Security

### Never Commit

- ❌ API keys
- ❌ Passwords
- ❌ Database credentials
- ❌ Private keys
- ❌ Access tokens

### Use Environment Variables

```bash
# .env (git ignored)
DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-...
```

### Security Checklist

- [ ] No secrets in code
- [ ] Input validation on all endpoints
- [ ] SQL injection prevention (use Drizzle ORM)
- [ ] XSS prevention (React escapes by default)
- [ ] CORS configured properly

---

## 📞 Getting Help

### Resources

- **Documentation**: `docs/` directory
- **Issues**: [GitHub Issues](https://github.com/YOUR-ORG/vecto-pilot/issues)
- **Discussions**: [GitHub Discussions](https://github.com/YOUR-ORG/vecto-pilot/discussions)

### Before Asking

1. Read relevant documentation
2. Search existing issues
3. Try debugging locally
4. Provide minimal reproducible example

---

## 🎓 Learning Resources

### New to the Stack?

- [React Documentation](https://react.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Playwright Testing](https://playwright.dev/)
- [Jest Testing](https://jestjs.io/)

### Project-Specific

- [Block Schema Contract](BLOCK-SCHEMA-CONTRACT.md)
- [Testing Guide](TESTING-GUIDE.md)
- [CI/CD Documentation](CI-CD.md)
- [Architecture Overview](ARCHITECTURE.md)

---

## 🙏 Thank You!

Every contribution makes Vecto Pilot better for rideshare drivers worldwide. We appreciate your time and effort!

---

**Questions?** Open a [discussion](https://github.com/YOUR-ORG/vecto-pilot/discussions) or [issue](https://github.com/YOUR-ORG/vecto-pilot/issues).
