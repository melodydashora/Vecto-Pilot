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

- [ ] Ran `npm run verify` in an isolated checkout; record actual results below
- [ ] Ran relevant additional integration/E2E checks against an explicitly prepared target, or recorded why they remain unverified
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
- [ ] Added reviewed, versioned SQL migrations; documented the target and rollback/forward-repair plan
- [ ] Updated Drizzle schema in `shared/schema.js`
- [ ] Verified migrations through `npm run db:migrate` against an explicitly prepared disposable database, or recorded that this remains unverified
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

The **Verify** workflow runs JSON syntax, lint, TypeScript, backend/client/UI
fixture tests and the client build. Report its actual result. Live providers,
database migrations, device capture and Playwright E2E remain separate checks;
the workflow does not publish the app.
