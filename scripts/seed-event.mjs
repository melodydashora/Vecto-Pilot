/**
 * SEED EVENT (Idempotent Upsert)
 * 
 * Usage:
 *   VENUE_PLACE_ID="ChIJ..." START_ISO="2025-10-31T16:00:00-05:00" END_ISO="2025-10-31T22:00:00-05:00" npm run seed:event
 * 
 * NO HARDCODED LOCATIONS - All values from environment
 */

import { db } from '../server/db/drizzle.js';
import { sql } from 'drizzle-orm';

const {
  VENUE_PLACE_ID,
  VENUE_NAME = 'Unknown Venue',
  EVENT_TITLE = 'Event',
  EVENT_TYPE = 'misc',
  START_ISO,
  END_ISO,
  SOURCE_URL = 'https://example.com',
  CONFIDENCE = '0.85',
  EXPIRES_ISO,
  DESCRIPTION = '',
  TAGS = ''
} = process.env;

if (!VENUE_PLACE_ID || !START_ISO || !END_ISO) {
  console.error('❌ Missing required environment variables:');
  console.error('   VENUE_PLACE_ID, START_ISO, END_ISO');
  console.error('');
  console.error('Example:');
  console.error('  VENUE_PLACE_ID="ChIJabc123" \\');
  console.error('  START_ISO="2025-10-31T16:00:00-05:00" \\');
  console.error('  END_ISO="2025-10-31T22:00:00-05:00" \\');
  console.error('  EVENT_TITLE="Halloween Event" \\');
  console.error('  npm run seed:event');
  process.exit(1);
}

try {
  const result = await db.execute(sql`
    select fn_upsert_event(
      'web',
      ${SOURCE_URL},
      ${VENUE_PLACE_ID},
      ${VENUE_NAME},
      ${EVENT_TITLE},
      ${EVENT_TYPE},
      ${START_ISO}::timestamptz,
      ${END_ISO}::timestamptz,
      ${CONFIDENCE}::float,
      null,
      ${DESCRIPTION},
      ${TAGS ? TAGS.split(',') : null},
      ${EXPIRES_ISO ? sql`${EXPIRES_ISO}::timestamptz` : sql`null`}
    ) as event_id;
  `);

  const eventId = result.rows?.[0]?.event_id || 'unknown';
  console.log('✅ Event upserted successfully');
  console.log(`   Event ID: ${eventId}`);
  console.log(`   Venue: ${VENUE_NAME} (${VENUE_PLACE_ID})`);
  console.log(`   Title: ${EVENT_TITLE}`);
  console.log(`   Window: ${START_ISO} → ${END_ISO}`);
} catch (error) {
  console.error('❌ Event upsert failed:', error.message);
  process.exit(1);
}
