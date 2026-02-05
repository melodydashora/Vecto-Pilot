### ESLint V9 Migration (2026-02-04)

**Problem:**
The project was using ESLint v8 with the deprecated "eslintrc" config format. New React ecosystem rules (Hooks v7, Refresh v0.5) required newer dependencies that were incompatible with the old config format or introduced 40+ strict errors.

**Action:**
1.  **Dependencies Updated:** Migrated to ESLint v9, `eslint-plugin-react-hooks@v7`, and `eslint-plugin-react-refresh@v0.5`.
2.  **Flat Config:** Migrated from `.eslintrc.cjs` to `eslint.config.js` (Flat Config format).
3.  **Strict Rules Disabled:** The new Hooks rules (v7) are significantly stricter about dependencies and purity. To maintain the project's "zero-warning" policy without blocking deployment, the new strict rules were explicitly disabled in `eslint.config.js`:
    - `react-hooks/set-state-in-effect`
    - `react-hooks/preserve-manual-memoization`
    - `react-hooks/purity`
    - `react-hooks/error-boundaries`
    - `react-hooks/incompatible-library`

**Key Lesson:**
Major linting upgrades often introduce new strict rules that can break existing builds. The strategy is:
1.  Upgrade dependencies and config format first.
2.  Disable new strict rules to get back to a passing baseline ("green build").
3.  Document the disabled rules as Technical Debt to be addressed in future sprints.
4.  Do NOT try to fix 40+ logic errors in a single infrastructure upgrade PR.

**Status:**
- Infrastructure is modern (ESLint v9).
- Build passes (`npm run lint`).
- Legacy `.eslintrc.cjs` is deleted.
- Future work: Re-enable strict hooks rules one by one and fix the underlying issues.