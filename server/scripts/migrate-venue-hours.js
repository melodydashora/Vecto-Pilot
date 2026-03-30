/**
 * Migration Script: Parse business_hours text → hours_full_week JSON
 *
 * Converts text like "Mon-Thu: 4pm-2am, Fri-Sat: 11am-2am"
 * To structured JSON for programmatic isOpen() queries
 *
 * Usage: node server/scripts/migrate-venue-hours.js [--dry-run]
 *
 * 2026-01-08: Created for venue hours standardization
 */

import { db } from '../db/drizzle.js';
import { venue_catalog } from '../../shared/schema.js';
import { isNull, isNotNull, sql } from 'drizzle-orm';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_ABBREVS = {
  'sun': 'sunday', 'mon': 'monday', 'tue': 'tuesday', 'wed': 'wednesday',
  'thu': 'thursday', 'fri': 'friday', 'sat': 'saturday',
  'sunday': 'sunday', 'monday': 'monday', 'tuesday': 'tuesday',
  'wednesday': 'wednesday', 'thursday': 'thursday', 'friday': 'friday', 'saturday': 'saturday'
};

/**
 * Parse time string like "4pm", "11am", "2:00 AM", "14:00" to 24-hour "HH:MM"
 */
function parseTime(timeStr) {
  if (!timeStr) return null;

  timeStr = timeStr.toLowerCase().trim();

  // Already 24-hour format
  if (/^\d{1,2}:\d{2}$/.test(timeStr)) {
    const [h, m] = timeStr.split(':').map(Number);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  // Parse 12-hour format: "4pm", "11am", "2:00 PM", "12:30am"
  const match = timeStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const period = match[3]?.toLowerCase();

  if (period === 'pm' && hour !== 12) hour += 12;
  if (period === 'am' && hour === 12) hour = 0;

  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

/**
 * Determine if close time is after midnight (next day)
 * e.g., open=16:00, close=02:00 → closes_next_day=true
 */
function closesNextDay(openTime, closeTime) {
  if (!openTime || !closeTime) return false;
  const [openH] = openTime.split(':').map(Number);
  const [closeH] = closeTime.split(':').map(Number);
  // If close hour is less than open hour, it closes next day
  // e.g., open=16, close=2 → true; open=11, close=23 → false
  return closeH < openH;
}

/**
 * Expand day range like "Mon-Thu" to ["monday", "tuesday", "wednesday", "thursday"]
 */
function expandDayRange(rangeStr) {
  rangeStr = rangeStr.toLowerCase().trim();

  // Single day
  if (DAY_ABBREVS[rangeStr]) {
    return [DAY_ABBREVS[rangeStr]];
  }

  // Range like "Mon-Thu" or "Friday-Saturday"
  const rangeMatch = rangeStr.match(/^(\w+)\s*[-–—]\s*(\w+)$/);
  if (rangeMatch) {
    const startDay = DAY_ABBREVS[rangeMatch[1].slice(0, 3)];
    const endDay = DAY_ABBREVS[rangeMatch[2].slice(0, 3)];
    if (!startDay || !endDay) return [];

    const startIdx = DAY_NAMES.indexOf(startDay);
    const endIdx = DAY_NAMES.indexOf(endDay);
    if (startIdx === -1 || endIdx === -1) return [];

    const days = [];
    let i = startIdx;
    while (true) {
      days.push(DAY_NAMES[i]);
      if (i === endIdx) break;
      i = (i + 1) % 7;
    }
    return days;
  }

  return [];
}

/**
 * Parse business_hours text to structured JSON
 * Input: "Mon-Thu: 4pm-2am, Fri-Sat: 11am-2am, Sun: 11am-12am"
 * Output: { monday: { open: "16:00", close: "02:00", closes_next_day: true }, ... }
 */
function parseBusinessHours(hoursText) {
  if (!hoursText) return null;

  // Handle both string and object (JSONB might already be parsed)
  if (typeof hoursText === 'object') {
    // Already structured - check if valid
    if (hoursText.monday || hoursText.sunday) return hoursText;
    // Might be array format
    if (Array.isArray(hoursText)) {
      hoursText = hoursText.join(', ');
    } else {
      return null;
    }
  }

  const result = {};
  DAY_NAMES.forEach(day => {
    result[day] = { closed: true };
  });

  // Split by comma or semicolon
  const segments = hoursText.split(/[,;]/).map(s => s.trim()).filter(Boolean);

  for (const segment of segments) {
    // Match patterns like "Mon-Thu: 4pm-2am" or "Friday: 11am-2am"
    const match = segment.match(/^([A-Za-z\s\-–—]+):\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–—]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i);

    if (match) {
      const days = expandDayRange(match[1]);
      const openTime = parseTime(match[2]);
      const closeTime = parseTime(match[3]);

      if (days.length > 0 && openTime && closeTime) {
        const closesNext = closesNextDay(openTime, closeTime);
        days.forEach(day => {
          result[day] = {
            open: openTime,
            close: closeTime,
            closes_next_day: closesNext,
            closed: false
          };
        });
      }
    }
  }

  // Check if any days were successfully parsed
  const hasOpenDays = Object.values(result).some(d => !d.closed);
  return hasOpenDays ? result : null;
}

/**
 * Main migration function
 */
async function migrateVenueHours(dryRun = false) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('VENUE HOURS MIGRATION: business_hours → hours_full_week');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (will update DB)'}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Find venues with business_hours but no hours_full_week
  const venues = await db.select({
    venue_id: venue_catalog.venue_id,
    venue_name: venue_catalog.venue_name,
    business_hours: venue_catalog.business_hours,
    hours_full_week: venue_catalog.hours_full_week
  })
  .from(venue_catalog)
  .where(isNotNull(venue_catalog.business_hours));

  console.log(`Found ${venues.length} venues with business_hours\n`);

  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (const venue of venues) {
    const { venue_id, venue_name, business_hours, hours_full_week } = venue;

    // Skip if already has hours_full_week
    if (hours_full_week && typeof hours_full_week === 'object' && hours_full_week.monday) {
      skipCount++;
      continue;
    }

    const parsed = parseBusinessHours(business_hours);

    if (parsed) {
      console.log(`✅ ${venue_name}`);
      console.log(`   Input: ${JSON.stringify(business_hours)}`);
      console.log(`   Output: ${JSON.stringify(parsed)}\n`);

      if (!dryRun) {
        await db.update(venue_catalog)
          .set({
            hours_full_week: parsed,
            updated_at: new Date()
          })
          .where(sql`${venue_catalog.venue_id} = ${venue_id}`);
      }
      successCount++;
    } else {
      console.log(`❌ ${venue_name} - Could not parse: ${JSON.stringify(business_hours)}\n`);
      failCount++;
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('MIGRATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`✅ Parsed successfully: ${successCount}`);
  console.log(`⏭️  Already had hours_full_week: ${skipCount}`);
  console.log(`❌ Failed to parse: ${failCount}`);
  console.log(`Total processed: ${venues.length}`);
  if (dryRun) {
    console.log('\n⚠️  DRY RUN - No changes made. Run without --dry-run to apply.');
  }
}

// CLI execution
const isDryRun = process.argv.includes('--dry-run');
migrateVenueHours(isDryRun)
  .then(() => {
    console.log('\nMigration complete.');
    process.exit(0);
  })
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
