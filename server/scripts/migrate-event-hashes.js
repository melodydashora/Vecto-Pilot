/**
 * Migration Script: Re-hash discovered_events + consolidate duplicates
 *
 * Per PLAN_events-dedup-architectural-2026-04-30.md §2 (Choice A).
 *
 * Updates every row's event_hash using the v3 generateEventHash logic
 * (Choice A normalization parity with deduplicateEvents). Where multiple
 * rows now produce the same new hash, keeps the OLDEST (preserving FK
 * references) and deletes the rest. Within each duplicate group, DELETEs
 * always run BEFORE the survivor's UPDATE (per plan §2 nuance — defends
 * against rare cross-row hash collision during migration).
 *
 * Usage:
 *   node server/scripts/migrate-event-hashes.js --dry-run    # report only
 *   node server/scripts/migrate-event-hashes.js              # execute
 *
 * Companion: claude_memory rows 268-271, plan doc.
 */

import { db } from '../db/drizzle.js';
import { discovered_events } from '../../shared/schema.js';
import { generateEventHash } from '../lib/events/pipeline/hashEvent.js';
import { eq, inArray } from 'drizzle-orm';

const isDryRun = process.argv.includes('--dry-run');

async function migrate() {
  const mode = isDryRun ? 'DRY-RUN' : 'EXECUTE';
  console.log(`[MIGRATE-HASHES] Mode: ${mode}`);

  console.log('[MIGRATE-HASHES] Reading all rows from discovered_events...');
  const rows = await db.select().from(discovered_events);
  console.log(`[MIGRATE-HASHES] Loaded ${rows.length} rows`);

  console.log('[MIGRATE-HASHES] Computing new hashes and grouping...');
  const groups = new Map();
  for (const row of rows) {
    const newHash = generateEventHash(row);
    if (!groups.has(newHash)) groups.set(newHash, []);
    groups.get(newHash).push(row);
  }

  let singletons = 0;
  let singletonsRehashed = 0;
  let dupeGroups = 0;
  let dupesDeleted = 0;
  let survivorsRehashed = 0;
  const sampleDeletions = [];

  for (const [newHash, group] of groups) {
    if (group.length === 1) {
      singletons++;
      const row = group[0];
      if (row.event_hash !== newHash) {
        if (!isDryRun) {
          await db.update(discovered_events)
            .set({ event_hash: newHash })
            .where(eq(discovered_events.id, row.id));
        }
        singletonsRehashed++;
      }
      continue;
    }

    dupeGroups++;
    group.sort((a, b) => new Date(a.discovered_at) - new Date(b.discovered_at));
    const survivor = group[0];
    const dupeIds = group.slice(1).map(r => r.id);

    if (sampleDeletions.length < 5) {
      sampleDeletions.push({
        title: survivor.title,
        venue: survivor.venue_name,
        date: survivor.event_start_date,
        kept_id: survivor.id,
        dupe_count: dupeIds.length,
        sample_dupe_titles: group.slice(1).map(r => r.title),
      });
    }

    if (!isDryRun) {
      await db.delete(discovered_events).where(inArray(discovered_events.id, dupeIds));
    }
    dupesDeleted += dupeIds.length;

    if (survivor.event_hash !== newHash) {
      if (!isDryRun) {
        await db.update(discovered_events)
          .set({ event_hash: newHash })
          .where(eq(discovered_events.id, survivor.id));
      }
      survivorsRehashed++;
    }
  }

  console.log('');
  console.log('[MIGRATE-HASHES] Summary:');
  console.log(`  Total rows scanned:        ${rows.length}`);
  console.log(`  Unique groups (new hash):  ${groups.size}`);
  console.log(`  Singletons:                ${singletons}`);
  console.log(`    of which rehashed:       ${singletonsRehashed}`);
  console.log(`  Duplicate groups:          ${dupeGroups}`);
  console.log(`  Duplicate rows deleted:    ${dupesDeleted}`);
  console.log(`  Survivor hashes updated:   ${survivorsRehashed}`);
  console.log(`  Final row count (expected): ${rows.length - dupesDeleted}`);

  if (sampleDeletions.length > 0) {
    console.log('');
    console.log('[MIGRATE-HASHES] Sample duplicate groups (up to 5):');
    for (const s of sampleDeletions) {
      console.log(`  - "${s.title}" @ ${s.venue} on ${s.date}`);
      console.log(`      kept ${s.kept_id}, would delete ${s.dupe_count} dupe(s):`);
      for (const t of s.sample_dupe_titles) {
        console.log(`        · "${t}"`);
      }
    }
  }

  if (!isDryRun) {
    console.log('');
    const finalCount = await db.select().from(discovered_events);
    console.log(`[MIGRATE-HASHES] Verified final row count: ${finalCount.length}`);
  } else {
    console.log('');
    console.log('[MIGRATE-HASHES] DRY-RUN — no writes performed. Re-run without --dry-run to execute.');
  }
}

migrate()
  .then(() => {
    console.log('[MIGRATE-HASHES] Done');
    process.exit(0);
  })
  .catch(err => {
    console.error('[MIGRATE-HASHES] Failed:', err);
    process.exit(1);
  });
