// Reported memos are separate from personal notes and always owned by their author.
import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';

export function createCoachMemoStore(db, table) {
  return {
    list: (userId, limit) => {
      if (!userId) throw new Error('Authenticated memo owner is required');
      return db.select({
        id: table.id, type: table.type, title: table.title, detail: table.detail,
        priority: table.priority, status: table.status, created_at: table.created_at,
      }).from(table).where(eq(table.triggering_user_id, userId))
        .orderBy(desc(table.created_at)).limit(limit);
    },
  };
}

export function createCoachMemosRouter(store) {
  const router = Router();
  router.get('/', async (req, res) => {
    if (!req.auth?.userId) return res.status(401).json({ error: 'Authentication required' });
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    try {
      const memos = await store.list(req.auth.userId, limit);
      res.json({ ok: true, memos });
    } catch (_error) {
      res.status(500).json({ ok: false, error: 'Reported memos could not be loaded. Please retry.' });
    }
  });
  return router;
}

// A receipt is constructed only after the durable write returns a real row.
export async function saveMemoWithReceipt(saveMemo, data, { userId, conversationId, snapshotId }) {
  if (!userId) throw new Error('Authenticated memo owner is required');
  const row = await saveMemo({
    ...data,
    triggering_user_id: userId,
    triggering_conversation_id: conversationId ?? null,
    triggering_snapshot_id: snapshotId ?? null,
  });
  if (!row?.id) throw new Error('Memo write did not return a saved record');
  return { id: row.id, type: row.type, title: row.title, created_at: row.created_at };
}
