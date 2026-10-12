import { sql } from 'drizzle-orm';
import { snapshots } from '../../../shared/schema.js';

// Legacy rows have no purpose marker. Keep those in existing workflow/history
// readers while preventing independent Coach captures from becoming MAIN state.
export const excludeCoachSnapshots = (permissions = snapshots.permissions) =>
  sql`${permissions}->>'context_kind' IS DISTINCT FROM 'coach'`;
