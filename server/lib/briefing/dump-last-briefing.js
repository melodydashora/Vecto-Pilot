// Diagnostic artifact retained from memory #218; not an exact Strategist prompt.
// The filename is historical and ignored by Git. Every row is tied to the
// caller's snapshot, never a global latest row belonging to another run.
import { db } from '../../db/drizzle.js';
import { briefings, snapshots, strategies } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

let pendingWrite = Promise.resolve();

export function dumpLastBriefingRow(snapshotId) {
  if (typeof snapshotId !== 'string' || !snapshotId.trim()) return Promise.resolve(false);
  const write = pendingWrite.then(async () => {
    const [briefing] = await db.select().from(briefings)
      .where(eq(briefings.snapshot_id, snapshotId)).limit(1);
    if (!briefing || briefing.snapshot_id !== snapshotId) return false;
    const [snapshot] = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    const [strategy] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId)).limit(1);
    if (!snapshot || snapshot.snapshot_id !== snapshotId ||
        (strategy && strategy.snapshot_id !== snapshotId)) return false;
    const output = JSON.stringify({
      description: 'Saved Briefing diagnostic, not the exact Strategist prompt. Rows were read separately; strategy may still be pending.',
      captured_at: new Date().toISOString(), snapshot_id: snapshotId,
      snapshot, briefing, strategy: strategy || null,
    }, null, 2) + '\n';
    const target = join(process.cwd(), 'sent-to-strategist.txt');
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      // A complete private file replaces the old diagnostic atomically. Concurrent
      // processes can choose the final writer, but cannot interleave file contents.
      await writeFile(temporary, output, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temporary, target);
      return true;
    } finally {
      await unlink(temporary).catch(() => {});
    }
  });
  pendingWrite = write.catch(() => {
    console.error('[AGENT] [DUMP] Could not save Briefing diagnostic');
    return false;
  });
  return pendingWrite;
}
