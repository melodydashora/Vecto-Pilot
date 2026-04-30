import { db } from '../server/db/drizzle.js';
import { driver_profiles, coach_system_notes, user_intel_notes } from '../shared/schema.js';
import { eq, desc } from 'drizzle-orm';
import fs from 'fs';

async function main() {
  console.log('🔍 Looking up admin user...');
  
  const email = 'melodydashora@gmail.com';
  const adminProfile = await db.select()
    .from(driver_profiles)
    .where(eq(driver_profiles.email, email))
    .limit(1);

  if (!adminProfile || adminProfile.length === 0) {
    console.log(`❌ User ${email} not found in driver_profiles.`);
    return;
  }

  const userId = adminProfile[0].user_id;
  console.log(`✅ Found Admin ID: ${userId}`);

  console.log('\n🔍 Fetching System Notes (Feature Requests/Bugs)...');
  const systemNotes = await db.select()
    .from(coach_system_notes)
    .orderBy(desc(coach_system_notes.created_at));

  console.log(`Found ${systemNotes.length} system notes.`);

  console.log('\n🔍 Fetching User Intel Notes (Coach Memory)...');
  const userNotes = await db.select()
    .from(user_intel_notes)
    .where(eq(user_intel_notes.user_id, userId))
    .orderBy(desc(user_intel_notes.created_at));

  console.log(`Found ${userNotes.length} user notes.`);

  // Generate FEATURESANDNOTES.md content
  let mdContent = `# Features and Notes Log\n\n**Generated:** ${new Date().toLocaleString()}
**Admin:** ${email}\n\n`;

  mdContent += `## 🛠 System Notes (Feature Requests & Observations)\n`;
  if (systemNotes.length > 0) {
    systemNotes.forEach(note => {
      mdContent += `### [${note.type?.toUpperCase()}] ${note.title}\n`;
      mdContent += `- **Category:** ${note.category}\n`;
      mdContent += `- **Description:** ${note.description}\n`;
      if (note.user_quote) mdContent += `- **User Quote:** "${note.user_quote}"\n`;
      mdContent += `- **Date:** ${new Date(note.created_at).toLocaleString()}\n\n`;
    });
  } else {
    mdContent += `_No system notes recorded yet._\n\n`;
  }

  mdContent += `## 🧠 Coach Memory (User Insights)\n`;
  if (userNotes.length > 0) {
    userNotes.forEach(note => {
      mdContent += `### [${note.note_type?.toUpperCase()}] ${note.title}\n`;
      mdContent += `- **Content:** ${note.content}\n`;
      mdContent += `- **Importance:** ${note.importance}/100\n`;
      mdContent += `- **Date:** ${new Date(note.created_at).toLocaleString()}\n\n`;
    });
  } else {
    mdContent += `_No user insights recorded yet._\n\n`;
  }

  fs.writeFileSync('FEATURESANDNOTES.md', mdContent);
  console.log('\n✅ FEATURESANDNOTES.md generated.');
  
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
