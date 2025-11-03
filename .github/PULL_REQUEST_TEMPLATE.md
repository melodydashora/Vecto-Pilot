# Pull Request

## Description
<!-- Briefly describe what this PR does and why -->

## Type of Change
<!-- Mark with [x] the type that applies -->

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Test update
- [ ] Refactoring (no functional changes)

## Changes Made
<!-- List the main changes in this PR -->

- 
- 
- 

## Testing
<!-- Describe how you tested these changes -->

- [ ] Ran seed script: `node scripts/seed-dev.js`
- [ ] Jest tests pass: `npm run test:blocks`
- [ ] Playwright tests pass: `npx playwright test`
- [ ] Full test suite: `./scripts/test-all.sh`
- [ ] Manual testing in browser
- [ ] Tested on mobile/responsive

## Block Schema Contract
<!-- If this PR affects block types or API contracts -->

- [ ] No changes to block schema
- [ ] Updated SmartBlock component for new block types
- [ ] Updated content-blocks API for new fields
- [ ] Added/updated Jest schema validation tests
- [ ] Added/updated Playwright E2E tests
- [ ] Updated documentation

## Database Changes
<!-- If this PR modifies the database schema -->

- [ ] No database changes
- [ ] Added new columns/tables (ran `npm run db:push`)
- [ ] Updated Drizzle schema in `shared/schema.js`
- [ ] Tested migration locally
- [ ] Updated seed script if needed

## Checklist
<!-- Mark items completed with [x] -->

- [ ] Code follows project conventions
- [ ] Self-reviewed my own code
- [ ] Commented complex/non-obvious code
- [ ] Updated relevant documentation
- [ ] Tests added/updated for changes
- [ ] All tests pass locally
- [ ] No console errors or warnings
- [ ] Checked LSP diagnostics (no TypeScript errors)

## Screenshots
<!-- If applicable, add screenshots of UI changes -->

## Related Issues
<!-- Link to related issues/tickets -->

Fixes #
Related to #

## Notes for Reviewers
<!-- Any additional context for reviewers -->

---

**CI Status**: GitHub Actions will automatically run:
- ✅ TypeScript & ESLint checks (PR)
- ✅ Jest unit tests (on merge)
- ✅ Playwright E2E tests (on merge)
