#!/bin/bash
echo "🔍 Verifying Phase A Bundle Completeness"
echo "========================================"
echo ""

PHASE_A="audit-export/phase-a-client-location"
MISSING=0

check_file() {
  if [ -f "$1" ]; then
    echo "✅ $1"
  else
    echo "❌ MISSING: $1"
    MISSING=$((MISSING + 1))
  fi
}

echo "Required Phase A Files:"
check_file "$PHASE_A/location-context-clean.tsx"
check_file "$PHASE_A/snapshot.ts"
check_file "$PHASE_A/useGeoPosition.ts"
check_file "$PHASE_A/co-pilot.tsx"
check_file "$PHASE_A/GlobalHeader.tsx"
check_file "$PHASE_A/daypart.ts"
check_file "$PHASE_A/PHASE_A_CONTEXT.md"
check_file "$PHASE_A/PHASE_A_AUDIT_CHECKLIST.md"

echo ""
if [ $MISSING -eq 0 ]; then
  echo "✅ All Phase A files present and ready for audit"
  echo ""
  echo "Next steps:"
  echo "1. Share the PHASE_A_AUDIT_CHECKLIST.md with the auditor"
  echo "2. They'll provide line-referenced patches"
  echo "3. Focus on city='Unknown' root cause"
else
  echo "⚠️  $MISSING files missing - copy from source:"
  echo "   client/src/contexts/location-context-clean.tsx"
  echo "   client/src/lib/snapshot.ts"
  echo "   client/src/hooks/useGeoPosition.ts"
  echo "   client/src/pages/co-pilot.tsx"
  echo "   client/src/components/GlobalHeader.tsx"
  echo "   client/src/lib/daypart.ts"
fi

echo ""
echo "📊 Bundle size:"
du -sh "$PHASE_A" 2>/dev/null || echo "Directory not found"
