
import { db } from '../server/db/drizzle.js';
import { sql } from 'drizzle-orm';

async function checkSystemNotes() {
  try {
    const result = await db.execute(sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'coach_system_notes';
    `);
    console.log("coach_system_notes columns:", result.rows);
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}

checkSystemNotes();
