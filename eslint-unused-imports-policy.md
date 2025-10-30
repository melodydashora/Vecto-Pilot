# ESLint Unused Imports Policy

## Enforce "Use It, Remove It, or Annotate It"

### Install Required Packages

```bash
npm install --save-dev eslint-plugin-unused-imports
```

### ESLint Configuration

Add to `.eslintrc.json` or `eslint.config.js`:

```json
{
  "plugins": ["unused-imports"],
  "rules": {
    "no-unused-vars": "off",
    "unused-imports/no-unused-imports": "error",
    "unused-imports/no-unused-vars": [
      "warn",
      {
        "vars": "all",
        "varsIgnorePattern": "^_",
        "args": "after-used",
        "argsIgnorePattern": "^_"
      }
    ]
  }
}
```

### CI/CD Integration

```bash
# In .github/workflows/ci.yml or package.json scripts
npm run lint -- --max-warnings=0
```

### Pre-commit Hook (Optional)

```bash
# .husky/pre-commit
#!/bin/sh
npm run lint -- --max-warnings=0 || {
  echo "❌ Lint failed: Fix unused imports or add @reason + expiry annotations"
  exit 1
}
```

### Annotation Format for Intentional Staging

When keeping unused imports intentionally:

```javascript
// @reason Hours normalization moved server-side; client will consume normalized API
// expiry: 2025-11-15 (CorrelationId: HRS-217)
// eslint-disable-next-line unused-imports/no-unused-imports
import { getPlaceHours, findPlaceIdByText } from './places-hours.js';
```

### Detection Endpoint (Development Only)

Add to your dev server:

```javascript
// server/routes/dev.js
app.get('/api/dev/unused-imports', async (req, res) => {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint();
  const results = await eslint.lintFiles(['server/**/*.js', 'client/**/*.js']);
  
  const unusedImports = results
    .filter(r => r.messages.some(m => m.ruleId === 'unused-imports/no-unused-imports'))
    .map(r => ({
      file: r.filePath,
      issues: r.messages.filter(m => m.ruleId === 'unused-imports/no-unused-imports')
    }));
  
  res.json({ unusedImports });
});
```

### Recommended Workflow

1. **Before commit**: Run `npm run lint` locally
2. **In PR**: CI fails if unused imports detected without @reason
3. **Monthly audit**: Review all @reason annotations and check expiry dates
4. **Quarterly cleanup**: Remove expired staged imports or extend with justification

This prevents greyed imports from silently accumulating.
