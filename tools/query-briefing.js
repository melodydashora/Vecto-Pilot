
import { db } from '../server/db/drizzle.js';
import { briefings } from '../shared/schema.js';
import { desc } from 'drizzle-orm';
import { writeFileSync } from 'fs';

async function queryLastBriefing() {
  try {
    console.log('🔍 Querying last briefing row...\n');
    
    const result = await db
      .select()
      .from(briefings)
      .orderBy(desc(briefings.created_at))
      .limit(1);

    if (result.length === 0) {
      console.log('❌ No briefings found in database');
      process.exit(0);
    }

    const briefing = result[0];
    
    // Format output vertically
    let output = '✅ Last Briefing Record\n';
    output += '='.repeat(80) + '\n\n';
    
    // Iterate through each field and format vertically
    for (const [fieldName, data] of Object.entries(briefing)) {
      output += `${fieldName}:\n`;
      
      // Pretty print the data based on type
      if (data === null || data === undefined) {
        output += '  (null)\n';
      } else if (typeof data === 'object') {
        // JSON objects - indent them
        const jsonStr = JSON.stringify(data, null, 2);
        const indented = jsonStr.split('\n').map(line => '  ' + line).join('\n');
        output += indented + '\n';
      } else if (typeof data === 'string') {
        output += `  "${data}"\n`;
      } else {
        output += `  ${data}\n`;
      }
      
      output += '\n';
    }
    
    // Save to file
    const filename = 'briefing-last-row.txt';
    writeFileSync(filename, output, 'utf8');
    
    console.log('✅ Last Briefing Record saved to:', filename);
    console.log('📄 Preview (first 1000 chars):\n');
    console.log(output.substring(0, 1000));
    console.log('\n... (see full output in file)');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error querying briefings:', error);
    process.exit(1);
  }
}

queryLastBriefing();
