# Coach Memo Runbook

Copy-paste commands for testing the coach memo pipeline end-to-end.

---

## 1. Write a memo (dev workspace)

From the Coach chat UI, say something like "remember that I prefer XL rides after 9pm" — the Coach emits `[COACH_MEMO]` or `[SAVE_NOTE]` tags automatically.

To write directly via Node (no AI call):

```bash
node -e "
import { rideshareCoachDAL } from './server/lib/ai/rideshare-coach-dal.js';
const row = await rideshareCoachDAL.saveCoachMemo({
  type: 'feature_request',
  title: 'Test memo',
  detail: 'Testing the write path',
  priority: 'low'
});
console.log('Inserted:', row.id, 'status:', row.status);
process.exit(0);
"
```

## 2. Verify it landed

```bash
psql "$DATABASE_URL" -c "SELECT id, type, title, status, created_at FROM coach_memos ORDER BY created_at DESC LIMIT 5;"
```

In workspace: `status='exported'` (pre-marked, won't be re-pulled).
In prod: `status='new'` (waiting for pull).

## 3. Pull from prod

```bash
# Preview (no writes):
PROD_DATABASE_URL='<neon-url>' npm run pull-coach-memos -- --dry-run

# Real pull:
PROD_DATABASE_URL='<neon-url>' npm run pull-coach-memos

# Pull from dev DB instead:
npm run pull-coach-memos -- --dev
```

The Neon prod URL is in Replit Secrets (`PROD_DATABASE_URL`). If not set in your shell, paste it inline.

## 4. Read what was pulled

```bash
tail -40 docs/coach-inbox.md
```

Or search for a specific keyword:

```bash
grep -i "voice\|tts\|hands-free" docs/coach-inbox.md
```

## 5. Where errors surface

| Failure | Where to look | Exit code |
|---------|--------------|:---------:|
| `PROD_DATABASE_URL` not set | stderr: "PROD_DATABASE_URL not set" | 1 |
| Can't connect to DB | stderr: connection error | 1 |
| File write failed | stderr: "Failed to write" — DB rows NOT marked exported, safe to retry | 2 |
| DB update failed after file write | stderr: lists affected IDs + manual fix SQL | 3 |
| Coach didn't emit `[COACH_MEMO]` | Check server logs: `grep "COACH.*MEMO" <logfile>` — Coach may have used `[SYSTEM_NOTE]` instead (known preference, see audit §5A) | — |

## 6. Quick health check

```bash
# Row counts across all coach tables:
psql "$DATABASE_URL" -c "
SELECT 'coach_memos' t, COUNT(*) n FROM coach_memos
UNION ALL SELECT 'coach_system_notes', COUNT(*) FROM coach_system_notes
UNION ALL SELECT 'user_intel_notes', COUNT(*) FROM user_intel_notes
UNION ALL SELECT 'coach_conversations', COUNT(*) FROM coach_conversations
UNION ALL SELECT 'coach_offer_decisions', COUNT(*) FROM coach_offer_decisions
ORDER BY t;"
```
