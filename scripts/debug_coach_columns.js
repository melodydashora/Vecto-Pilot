import { db } from '../server/db/drizzle.js';
import { sql } from 'drizzle-orm';

async function debugColumns() {
  console.log("--- COACH CONVERSATIONS STRUCTURE ---");
  try {
    const conversations = await db.execute(sql`
      SELECT * FROM coach_conversations LIMIT 1;
    `);
    if (conversations.rowCount > 0) {
        console.log(conversations.rows[0]);
    } else {
        console.log("Table is empty, checking columns via information_schema...");
         const columns = await db.execute(sql`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'coach_conversations';
      `);
      console.log(columns.rows.map(r => r.column_name));
    }
  } catch (err) {
    console.error(err);
  }

  console.log("--- USER INTEL NOTES STRUCTURE ---");
   try {
    const intel = await db.execute(sql`
      SELECT * FROM user_intel_notes LIMIT 1;
    `);
    if (intel.rowCount > 0) {
        console.log(intel.rows[0]);
    } else {
         console.log("Table is empty, checking columns via information_schema...");
         const columns = await db.execute(sql`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'user_intel_notes';
      `);
      console.log(columns.rows.map(r => r.column_name));
    }
  } catch (err) {
    console.error(err);
  }

  process.exit(0);
}

debugColumns();