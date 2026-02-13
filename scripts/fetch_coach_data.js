
import { db } from '../server/db/drizzle.js';
import { sql } from 'drizzle-orm';

async function fetchCoachData() {
  console.log("--- COACH CONVERSATIONS ---");
  try {
    const conversations = await db.execute(sql`
      SELECT * FROM coach_conversations ORDER BY created_at ASC;
    `);
    if (conversations.rowCount === 0) {
        console.log("No conversations found.");
    } else {
        let currentConversationId = null;
        conversations.rows.forEach(row => {
            if (row.conversation_id !== currentConversationId) {
                console.log(`\n--- Conversation: ${row.conversation_id} ---`);
                currentConversationId = row.conversation_id;
            }
            console.log(`[${row.created_at}] ${row.role}: ${row.content}`);
            if (row.sentiment) console.log(`   Sentiment: ${row.sentiment}`);
        });
    }
  } catch (err) {
    console.error("Error fetching conversations:", err.message);
  }

  console.log("\n--- COACH SYSTEM NOTES ---");
  try {
    const tableCheck = await db.execute(sql`
        SELECT to_regclass('public.coach_system_notes');
    `);
    
    if (tableCheck.rows[0].to_regclass) {
        const systemNotes = await db.execute(sql`
          SELECT * FROM coach_system_notes ORDER BY created_at DESC;
        `);
         if (systemNotes.rowCount === 0) {
            console.log("No system notes found.");
        } else {
            systemNotes.rows.forEach(row => {
                console.log(`\n[${row.created_at}] Type: ${row.note_type}`);
                console.log(`Content: ${row.content}`);
            });
        }
    } else {
        console.log("Table 'coach_system_notes' does not exist.");
    }

  } catch (err) {
    console.error("Error fetching system notes:", err.message);
  }

  console.log("\n--- USER INTEL NOTES ---");
  try {
      const tableCheck = await db.execute(sql`
        SELECT to_regclass('public.user_intel_notes');
    `);

    if (tableCheck.rows[0].to_regclass) {
        const intelNotes = await db.execute(sql`
          SELECT * FROM user_intel_notes ORDER BY created_at DESC;
        `);
        if (intelNotes.rowCount === 0) {
            console.log("No user intel notes found.");
        } else {
            intelNotes.rows.forEach(row => {
                console.log(`\n[${row.created_at}] Category: ${row.category}`);
                console.log(`Title: ${row.title}`);
                console.log(`Content: ${row.content}`);
                console.log(`Confidence: ${row.confidence}`);
            });
        }
    } else {
         console.log("Table 'user_intel_notes' does not exist.");
    }
  } catch (err) {
    console.error("Error fetching user intel notes:", err.message);
  }
  
  process.exit(0);
}

fetchCoachData();
