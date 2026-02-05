
import { db } from '../server/db/drizzle.js';
import { sql } from 'drizzle-orm';

async function checkTable() {
  try {
    const result = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'coach_conversations';
    `);
    
    if (result.rowCount > 0) {
      console.log("✅ Table 'coach_conversations' exists.");
      
      // Check columns
      const columns = await db.execute(sql`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'coach_conversations';
      `);
      console.log("Columns:", columns.rows);
    } else {
      console.log("❌ Table 'coach_conversations' DOES NOT exist.");
    }
  } catch (err) {
    console.error("Error checking table:", err);
  }
  process.exit(0);
}

checkTable();
