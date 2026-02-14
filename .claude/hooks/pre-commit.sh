#!/bin/bash
# =============================================================================
# Pre-Commit Hook for Vecto Pilot
# =============================================================================
# This hook runs automatically before Claude Code commits changes.
# It validates code quality to prevent broken commits.
#
# Exit codes:
#   0 = Success (commit proceeds)
#   1 = Failure (commit blocked)
# =============================================================================

set -e

echo "🔍 Running pre-commit checks..."
echo ""

# Track failures
FAILED=0

# -----------------------------------------------------------------------------
# 1. TypeScript Type Check
# -----------------------------------------------------------------------------
echo "📘 TypeScript: Checking types..."
if npm run typecheck --silent 2>/dev/null; then
    echo "   ✅ No type errors"
else
    echo "   ❌ Type errors found"
    FAILED=1
fi

# -----------------------------------------------------------------------------
# 2. ESLint
# -----------------------------------------------------------------------------
echo "🔎 ESLint: Checking code style..."
if npm run lint --silent 2>/dev/null; then
    echo "   ✅ No lint errors"
else
    echo "   ❌ Lint errors found"
    FAILED=1
fi

# -----------------------------------------------------------------------------
# 3. Check for console.log in production code (warning only)
# -----------------------------------------------------------------------------
echo "🔇 Checking for stray console.log..."
CONSOLE_COUNT=$(grep -r "console\.log" server/lib client/src --include="*.ts" --include="*.tsx" --include="*.js" 2>/dev/null | grep -v "// DEBUG" | wc -l || echo "0")
if [ "$CONSOLE_COUNT" -gt 10 ]; then
    echo "   ⚠️  Warning: $CONSOLE_COUNT console.log statements found (consider cleaning up)"
else
    echo "   ✅ Console.log count acceptable ($CONSOLE_COUNT)"
fi

# -----------------------------------------------------------------------------
# 4. Check for TODO/FIXME (warning only)
# -----------------------------------------------------------------------------
echo "📝 Checking for TODOs..."
TODO_COUNT=$(grep -r "TODO\|FIXME" server client/src --include="*.ts" --include="*.tsx" --include="*.js" 2>/dev/null | wc -l || echo "0")
if [ "$TODO_COUNT" -gt 0 ]; then
    echo "   ⚠️  Warning: $TODO_COUNT TODO/FIXME comments found"
fi

# -----------------------------------------------------------------------------
# 5. Verify no .env files are staged
# -----------------------------------------------------------------------------
echo "🔐 Checking for secrets..."
if git diff --cached --name-only | grep -E '\.env$|credentials|secret' >/dev/null 2>&1; then
    echo "   ❌ Potential secrets detected in staged files!"
    FAILED=1
else
    echo "   ✅ No secrets detected"
fi

# -----------------------------------------------------------------------------
# Result
# -----------------------------------------------------------------------------
echo ""
if [ "$FAILED" -eq 0 ]; then
    echo "✅ All pre-commit checks passed!"
    exit 0
else
    echo "❌ Pre-commit checks failed. Please fix issues before committing."
    exit 1
fi
