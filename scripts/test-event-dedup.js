/**
 * Test event deduplication logic
 * Run: node scripts/test-event-dedup.js
 */

function normalizeEventName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/["'"]/g, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+(at|in|from|@)\s+.+$/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAddress(address) {
  if (!address) return '';
  const lower = address.toLowerCase();
  const streetMatch = lower.match(/\d+\s+(.+?)(?:,|$)/);
  const streetName = streetMatch ? streetMatch[1].split(/[,#]/)[0].trim() : lower;
  return streetName.split(/\s+/).slice(0, 2).join(' ');
}

function normalizeTime(timeStr) {
  if (!timeStr) return '';
  const match = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
  if (!match) return timeStr.toLowerCase();
  let hour = parseInt(match[1]);
  const min = match[2] || '00';
  const period = (match[3] || '').toLowerCase();
  if (period === 'pm' && hour !== 12) hour += 12;
  if (period === 'am' && hour === 12) hour = 0;
  return `${hour.toString().padStart(2, '0')}${min}`;
}

// Test cases from user's data
const testNames = [
  '"O" by Cirque du Soleil in Shared Reality',
  'O by Cirque du Soleil in Shared Reality',
  '"O" by Cirque du Soleil (Shared Reality) at Cosm',
  '"O" by Cirque du Soleil at Cosm (Shared Reality)',
  'The Matrix in Shared Reality',
  'The Matrix in Shared Reality at Cosm'
];

console.log('=== Name Normalization Test ===');
testNames.forEach(n => {
  console.log(`"${n}"`);
  console.log(`  -> "${normalizeEventName(n)}"\n`);
});

console.log('=== Address Normalization Test ===');
const addresses = [
  '5776 Grandscape Blvd, The Colony, TX 75056',
  '5752 Grandscape Blvd, The Colony, TX 75056'
];
addresses.forEach(a => console.log(`"${a}" -> "${normalizeAddress(a)}"`));

console.log('\n=== Time Normalization Test ===');
const times = ['3:30 PM', '3:30 pm', '15:30', '8:30 PM'];
times.forEach(t => console.log(`"${t}" -> "${normalizeTime(t)}"`));

// Simulate actual event deduplication
console.log('\n=== Full Deduplication Simulation ===');
const events = [
  { title: '"O" by Cirque du Soleil in Shared Reality', address: '5776 Grandscape Blvd, The Colony, TX 75056', event_time: '3:30 PM', impact: 'high' },
  { title: 'O by Cirque du Soleil in Shared Reality', address: '5776 Grandscape Blvd, The Colony, TX 75056', event_time: '3:30 PM', impact: 'medium' },
  { title: '"O" by Cirque du Soleil (Shared Reality) at Cosm', address: '5752 Grandscape Blvd, The Colony, TX 75056', event_time: '3:30 PM', impact: 'high' },
  { title: 'The Matrix in Shared Reality', address: '5776 Grandscape Blvd, The Colony, TX 75056', event_time: '8:30 PM', impact: 'medium' },
  { title: 'The Matrix in Shared Reality at Cosm', address: '5776 Grandscape Blvd, The Colony, TX 75056', event_time: '8:30 PM', impact: 'high' },
  { title: 'Skate the Square (Outdoor Ice Rink)', address: 'Corner of Main St & Coleman Blvd, Frisco, TX', event_time: '2:00 PM', impact: 'high' },
];

function getDedupeKey(event) {
  return `${normalizeEventName(event.title)}|${normalizeAddress(event.address)}|${normalizeTime(event.event_time)}`;
}

// Group by key
const groups = new Map();
events.forEach(e => {
  const key = getDedupeKey(e);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(e);
});

console.log(`\nInput: ${events.length} events`);
console.log(`Output: ${groups.size} unique events\n`);

for (const [key, group] of groups) {
  if (group.length > 1) {
    console.log(`📦 GROUP (${group.length} duplicates) - Key: "${key}"`);
    group.forEach((e, i) => console.log(`   ${i + 1}. "${e.title}" (${e.impact})`));
    console.log(`   ✅ KEPT: "${group.sort((a,b) => (b.impact === 'high' ? 1 : 0) - (a.impact === 'high' ? 1 : 0))[0].title}"\n`);
  } else {
    console.log(`✅ UNIQUE: "${group[0].title}"`);
  }
}

console.log('\n🎉 Test complete!');
