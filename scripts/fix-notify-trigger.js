// scripts/fix-notify-trigger.js
// Fix the database trigger to send notifications on correct channel

import { db } from '../server/db/drizzle.js';
import { sql } from 'drizzle-orm';

async function fixTrigger() {
  console.log('🔧 Fixing database trigger for strategy_ready notifications...');
  
  try {
    // Drop old trigger if exists
    await db.execute(sql`DROP TRIGGER IF EXISTS trg_strategy_update ON strategies`);
    console.log('✅ Dropped old trigger');
    
    // Create new trigger function
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION notify_strategy_update() RETURNS trigger AS $$
      BEGIN
        -- Send notification on strategy_ready channel (used by SSE)
        PERFORM pg_notify('strategy_ready', json_build_object('snapshot_id', NEW.snapshot_id, 'status', NEW.status)::text);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log('✅ Created new trigger function');
    
    // Create trigger
    await db.execute(sql`
      CREATE TRIGGER trg_strategy_update
      AFTER INSERT OR UPDATE OF
        minstrategy, briefing_news, briefing_events, briefing_traffic, consolidated_strategy, status
      ON strategies
      FOR EACH ROW EXECUTE FUNCTION notify_strategy_update();
    `);
    console.log('✅ Created new trigger');
    
    console.log('');
    console.log('🎉 Database trigger fixed!');
    console.log('');
    console.log('The trigger now sends notifications to the "strategy_ready" channel');
    console.log('which matches what the SSE listener expects.');
    console.log('');
    console.log('✅ Loading bar will now update in real-time!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fixing trigger:', error);
    process.exit(1);
  }
}

fixTrigger();
