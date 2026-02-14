#!/bin/bash
# =============================================================================
# Session Start Hook for Vecto Pilot
# =============================================================================
# This hook runs when a new Claude Code session begins.
# It provides context and checks for pending items.
#
# This is informational only - it doesn't block anything.
# =============================================================================

echo ""
echo "╔══════════════════════════════════════════════════════════════════════════╗"
echo "║                    🚀 VECTO PILOT - SESSION START                        ║"
echo "╚══════════════════════════════════════════════════════════════════════════╝"
echo ""

# -----------------------------------------------------------------------------
# 1. Git Status Summary
# -----------------------------------------------------------------------------
echo "📊 GIT STATUS"
echo "─────────────────────────────────────────"
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "   Branch: $BRANCH"

UNCOMMITTED=$(git status --porcelain 2>/dev/null | wc -l)
if [ "$UNCOMMITTED" -gt 0 ]; then
    echo "   ⚠️  Uncommitted changes: $UNCOMMITTED files"
else
    echo "   ✅ Working tree clean"
fi

UNPUSHED=$(git log origin/$BRANCH..$BRANCH --oneline 2>/dev/null | wc -l)
if [ "$UNPUSHED" -gt 0 ]; then
    echo "   📤 Unpushed commits: $UNPUSHED"
fi
echo ""

# -----------------------------------------------------------------------------
# 2. Check Review Queue
# -----------------------------------------------------------------------------
echo "📋 REVIEW QUEUE"
echo "─────────────────────────────────────────"
PENDING_FILE="docs/review-queue/pending.md"
if [ -f "$PENDING_FILE" ]; then
    PENDING_COUNT=$(grep -c "### Status: PENDING" "$PENDING_FILE" 2>/dev/null || echo "0")
    if [ "$PENDING_COUNT" -gt 0 ]; then
        echo "   ⚠️  $PENDING_COUNT items need review in $PENDING_FILE"
    else
        echo "   ✅ No pending review items"
    fi
else
    echo "   ✅ No review queue file found"
fi
echo ""

# -----------------------------------------------------------------------------
# 3. Recent Commits (for context)
# -----------------------------------------------------------------------------
echo "📝 RECENT COMMITS (last 3)"
echo "─────────────────────────────────────────"
git log --oneline -3 2>/dev/null | while read line; do
    echo "   $line"
done
echo ""

# -----------------------------------------------------------------------------
# 4. Key Reminders
# -----------------------------------------------------------------------------
echo "📌 KEY REMINDERS"
echo "─────────────────────────────────────────"
echo "   • NO FALLBACKS - fail explicitly, no hardcoded defaults"
echo "   • FAIL HARD - block UI for critical data missing"
echo "   • GPS coordinates: 6 decimals precision"
echo "   • Update README.md when modifying folders"
echo "   • Check LESSONS_LEARNED.md for known issues"
echo ""

# -----------------------------------------------------------------------------
# 5. Available Commands
# -----------------------------------------------------------------------------
echo "⌨️  QUICK COMMANDS"
echo "─────────────────────────────────────────"
echo "   npm run dev           Start development server"
echo "   npm run typecheck     Check TypeScript types"
echo "   npm run lint          Run ESLint"
echo "   npm run format        Format code with Prettier"
echo "   npm run test          Run all tests"
echo "   npm run guard         All QA checks"
echo ""

echo "═══════════════════════════════════════════════════════════════════════════"
echo "                         Session ready! Happy coding! 🎯"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
