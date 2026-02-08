/**
 * tests/events/pipeline.test.js
 *
 * Integration tests for the canonical ETL pipeline modules:
 * - normalizeEvent.js
 * - validateEvent.js
 * - hashEvent.js
 *
 * Run with: node tests/events/pipeline.test.js
 *
 * @module tests/events/pipeline
 */

import assert from 'node:assert';
import { fileURLToPath } from 'url';

// Import canonical modules
import {
  normalizeTitle,
  normalizeVenueName,
  normalizeDate,
  normalizeTime,
  normalizeCategory,
  normalizeAttendance,
  normalizeEvent,
  normalizeEvents
} from '../../server/lib/events/pipeline/normalizeEvent.js';

import {
  validateEvent,
  validateEventsHard,
  needsReadTimeValidation,
  VALIDATION_SCHEMA_VERSION
} from '../../server/lib/events/pipeline/validateEvent.js';

import {
  buildHashInput,
  generateEventHash,
  eventsHaveSameHash,
  groupEventsByHash,
  findDuplicatesByHash
} from '../../server/lib/events/pipeline/hashEvent.js';

class ETLPipelineTester {
  constructor() {
    this.results = [];
    this.currentSuite = '';
  }

  suite(name) {
    this.currentSuite = name;
    console.log(`\n📋 ${name}`);
    console.log('─'.repeat(50));
  }

  async test(name, testFn) {
    const fullName = `${this.currentSuite}: ${name}`;
    try {
      await testFn();
      this.results.push({ name: fullName, success: true });
      console.log(`  ✅ ${name}`);
    } catch (err) {
      this.results.push({ name: fullName, success: false, error: err.message });
      console.error(`  ❌ ${name}`);
      console.error(`     ${err.message}`);
    }
  }

  // =========================================================================
  // NORMALIZATION TESTS
  // =========================================================================

  async testNormalization() {
    this.suite('normalizeEvent.js - Title Normalization');

    await this.test('normalizeTitle: removes surrounding quotes', () => {
      assert.strictEqual(normalizeTitle('"Concert at Stadium"'), 'Concert at Stadium');
      assert.strictEqual(normalizeTitle("'Live Show'"), 'Live Show');
      assert.strictEqual(normalizeTitle('"Test Event"'), 'Test Event');
    });

    await this.test('normalizeTitle: collapses whitespace', () => {
      assert.strictEqual(normalizeTitle('Concert   at   Stadium'), 'Concert at Stadium');
      assert.strictEqual(normalizeTitle('  Trimmed  '), 'Trimmed');
    });

    await this.test('normalizeTitle: handles null/undefined', () => {
      assert.strictEqual(normalizeTitle(null), '');
      assert.strictEqual(normalizeTitle(undefined), '');
      assert.strictEqual(normalizeTitle(''), '');
    });

    this.suite('normalizeEvent.js - Venue Normalization');

    await this.test('normalizeVenueName: extracts venue from combined string', () => {
      assert.strictEqual(normalizeVenueName('Madison Square Garden, 4 Penn Plaza'), 'Madison Square Garden');
      assert.strictEqual(normalizeVenueName('The Venue'), 'The Venue');
    });

    await this.test('normalizeVenueName: handles null/undefined', () => {
      assert.strictEqual(normalizeVenueName(null), '');
      assert.strictEqual(normalizeVenueName(undefined), '');
    });

    this.suite('normalizeEvent.js - Date Normalization');

    await this.test('normalizeDate: passes through YYYY-MM-DD', () => {
      assert.strictEqual(normalizeDate('2026-01-15'), '2026-01-15');
      assert.strictEqual(normalizeDate('2025-12-31'), '2025-12-31');
    });

    await this.test('normalizeDate: converts MM/DD/YYYY', () => {
      assert.strictEqual(normalizeDate('01/15/2026'), '2026-01-15');
      assert.strictEqual(normalizeDate('12/31/2025'), '2025-12-31');
      assert.strictEqual(normalizeDate('1/5/2026'), '2026-01-05');
    });

    await this.test('normalizeDate: parses Month DD, YYYY', () => {
      const result = normalizeDate('January 15, 2026');
      assert.strictEqual(result, '2026-01-15');
    });

    await this.test('normalizeDate: returns null for invalid', () => {
      assert.strictEqual(normalizeDate('invalid'), null);
      assert.strictEqual(normalizeDate(null), null);
      assert.strictEqual(normalizeDate(''), null);
    });

    this.suite('normalizeEvent.js - Time Normalization');

    await this.test('normalizeTime: passes through HH:MM', () => {
      assert.strictEqual(normalizeTime('19:00'), '19:00');
      assert.strictEqual(normalizeTime('09:30'), '09:30');
    });

    await this.test('normalizeTime: converts 12-hour format', () => {
      assert.strictEqual(normalizeTime('7 PM'), '19:00');
      assert.strictEqual(normalizeTime('7:30 PM'), '19:30');
      assert.strictEqual(normalizeTime('12 PM'), '12:00');
      assert.strictEqual(normalizeTime('12 AM'), '00:00');
      assert.strictEqual(normalizeTime('11 AM'), '11:00');
    });

    await this.test('normalizeTime: handles case insensitivity', () => {
      assert.strictEqual(normalizeTime('7pm'), '19:00');
      assert.strictEqual(normalizeTime('7:30PM'), '19:30');
      assert.strictEqual(normalizeTime('7 pm'), '19:00');
    });

    await this.test('normalizeTime: returns null for invalid', () => {
      assert.strictEqual(normalizeTime('invalid'), null);
      assert.strictEqual(normalizeTime(null), null);
      assert.strictEqual(normalizeTime(''), null);
    });

    this.suite('normalizeEvent.js - Category Normalization');

    await this.test('normalizeCategory: maps concert keywords', () => {
      assert.strictEqual(normalizeCategory('concert'), 'concert');
      assert.strictEqual(normalizeCategory('Live Music'), 'concert');
      assert.strictEqual(normalizeCategory('Music Festival'), 'concert');
    });

    await this.test('normalizeCategory: maps sports keywords', () => {
      assert.strictEqual(normalizeCategory('sports'), 'sports');
      assert.strictEqual(normalizeCategory('NBA Game'), 'sports');
      assert.strictEqual(normalizeCategory('NFL Football'), 'sports');
    });

    await this.test('normalizeCategory: defaults to other', () => {
      assert.strictEqual(normalizeCategory('random'), 'other');
      assert.strictEqual(normalizeCategory(null), 'other');
    });

    this.suite('normalizeEvent.js - Full Event Normalization');

    await this.test('normalizeEvent: normalizes complete event', () => {
      // Raw LLM input uses old field names (event_date, event_time)
      // normalizeEvent converts to new symmetric names (event_start_date, event_start_time)
      const raw = {
        title: '"Concert at Madison Square Garden"',
        venue: 'MSG, 4 Penn Plaza',
        address: '4 Pennsylvania Plaza, New York, NY',
        event_date: '01/15/2026',
        event_time: '7 PM',
        lat: '40.750504',
        lng: '-73.993439',
        category: 'concert',
        expected_attendance: 'high',
        source_model: 'test'
      };

      const normalized = normalizeEvent(raw, { city: 'New York', state: 'NY' });

      assert.strictEqual(normalized.title, 'Concert at Madison Square Garden');
      assert.strictEqual(normalized.venue_name, 'MSG');
      assert.strictEqual(normalized.event_start_date, '2026-01-15');
      assert.strictEqual(normalized.event_start_time, '19:00');
      assert.strictEqual(normalized.city, 'New York');
      assert.strictEqual(normalized.state, 'NY');
      assert.strictEqual(normalized.category, 'concert');
      assert.strictEqual(normalized.expected_attendance, 'high');
    });

    await this.test('normalizeEvent: uses context for city/state', () => {
      // Raw input uses old field names; normalizer accepts both for flexibility
      const raw = { title: 'Test Event', event_date: '2026-01-15', event_time: '19:00' };
      const normalized = normalizeEvent(raw, { city: 'Dallas', state: 'TX' });

      assert.strictEqual(normalized.city, 'Dallas');
      assert.strictEqual(normalized.state, 'TX');
    });

    await this.test('normalizeEvents: normalizes array', () => {
      // Raw LLM input uses old field names (event_date, event_time)
      const rawEvents = [
        { title: 'Event 1', event_date: '2026-01-15', event_time: '7 PM' },
        { title: 'Event 2', event_date: '2026-01-16', event_time: '8 PM' }
      ];

      const normalized = normalizeEvents(rawEvents, { city: 'Dallas', state: 'TX' });

      assert.strictEqual(normalized.length, 2);
      // 2026-01-10: Normalized output uses symmetric names (event_start_time)
      assert.strictEqual(normalized[0].event_start_time, '19:00');
      assert.strictEqual(normalized[1].event_start_time, '20:00');
    });

    await this.test('normalizeEvents: handles non-array gracefully', () => {
      assert.deepStrictEqual(normalizeEvents(null), []);
      assert.deepStrictEqual(normalizeEvents(undefined), []);
      assert.deepStrictEqual(normalizeEvents('string'), []);
    });
  }

  // =========================================================================
  // VALIDATION TESTS
  // =========================================================================

  async testValidation() {
    this.suite('validateEvent.js - Single Event Validation');

    await this.test('validateEvent: passes valid event', () => {
      // 2026-01-10: Use symmetric field names (event_start_date, event_start_time)
      const event = {
        title: 'Valid Concert',
        venue_name: 'Madison Square Garden',
        address: '4 Penn Plaza, New York, NY',
        event_start_date: '2026-01-15',
        event_start_time: '19:00',
        event_end_time: '22:00'  // 2026-01-10: Required by frontend contract
      };

      const result = validateEvent(event);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.reason, null);
    });

    await this.test('validateEvent: rejects missing title', () => {
      const event = { venue_name: 'Venue', event_start_date: '2026-01-15', event_start_time: '19:00', event_end_time: '22:00' };
      const result = validateEvent(event);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'missing_title');
    });

    await this.test('validateEvent: rejects TBD in title', () => {
      const event = {
        title: 'Event TBD',
        venue_name: 'Venue',
        event_start_date: '2026-01-15',
        event_start_time: '19:00',
        event_end_time: '22:00'
      };

      const result = validateEvent(event);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'tbd_in_title');
    });

    await this.test('validateEvent: rejects TBD in venue', () => {
      const event = {
        title: 'Valid Event',
        venue_name: 'Venue TBD',
        event_start_date: '2026-01-15',
        event_start_time: '19:00',
        event_end_time: '22:00'
      };

      const result = validateEvent(event);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'tbd_in_venue');
    });

    await this.test('validateEvent: rejects unknown patterns', () => {
      const event = {
        title: 'Unknown Event',
        venue_name: 'Venue',
        event_start_date: '2026-01-15',
        event_start_time: '19:00',
        event_end_time: '22:00'
      };

      const result = validateEvent(event);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'tbd_in_title');
    });

    await this.test('validateEvent: rejects missing location', () => {
      const event = {
        title: 'Valid Event',
        event_start_date: '2026-01-15',
        event_start_time: '19:00',
        event_end_time: '22:00'
      };

      const result = validateEvent(event);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'missing_location');
    });

    await this.test('validateEvent: accepts address-only event', () => {
      const event = {
        title: 'Valid Event',
        address: '123 Main St',
        event_start_date: '2026-01-15',
        event_start_time: '19:00',
        event_end_time: '22:00'
      };

      const result = validateEvent(event);
      assert.strictEqual(result.valid, true);
    });

    await this.test('validateEvent: rejects missing end time', () => {
      const event = {
        title: 'Valid Event',
        venue_name: 'Venue',
        event_start_date: '2026-01-15',
        event_start_time: '19:00'
        // Missing event_end_time
      };

      const result = validateEvent(event);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'missing_end_time');
    });

    await this.test('validateEvent: rejects TBD in end time', () => {
      const event = {
        title: 'Valid Event',
        venue_name: 'Venue',
        event_start_date: '2026-01-15',
        event_start_time: '19:00',
        event_end_time: 'TBD'
      };

      const result = validateEvent(event);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'tbd_in_end_time');
    });

    await this.test('validateEvent: rejects missing time', () => {
      const event = {
        title: 'Valid Event',
        venue_name: 'Venue',
        event_start_date: '2026-01-15',
        event_end_time: '22:00'
        // Missing event_start_time
      };

      const result = validateEvent(event);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'missing_start_time');
    });

    await this.test('validateEvent: rejects missing date', () => {
      const event = {
        title: 'Valid Event',
        venue_name: 'Venue',
        event_start_time: '19:00',
        event_end_time: '22:00'
        // Missing event_start_date
      };

      const result = validateEvent(event);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'missing_start_date');
    });

    await this.test('validateEvent: rejects invalid date format', () => {
      const event = {
        title: 'Valid Event',
        venue_name: 'Venue',
        event_start_date: '01/15/2026', // Not YYYY-MM-DD
        event_start_time: '19:00',
        event_end_time: '22:00'
      };

      const result = validateEvent(event);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'invalid_date_format');
    });

    this.suite('validateEvent.js - Batch Validation');

    await this.test('validateEventsHard: separates valid and invalid', () => {
      // 2026-01-10: Use symmetric field names
      const events = [
        { title: 'Valid 1', venue_name: 'V1', event_start_date: '2026-01-15', event_start_time: '19:00', event_end_time: '22:00' },
        { title: 'TBD Event', venue_name: 'V2', event_start_date: '2026-01-15', event_start_time: '19:00', event_end_time: '22:00' },
        { title: 'Valid 2', venue_name: 'V3', event_start_date: '2026-01-16', event_start_time: '20:00', event_end_time: '23:00' },
        { title: 'No End Time', venue_name: 'V4', event_start_date: '2026-01-15', event_start_time: '19:00' }  // Missing end_time
      ];

      const result = validateEventsHard(events, { logRemovals: false });

      assert.strictEqual(result.valid.length, 2);
      assert.strictEqual(result.invalid.length, 2);
      assert.strictEqual(result.stats.total, 4);
      assert.strictEqual(result.stats.valid, 2);
      assert.strictEqual(result.stats.invalid, 2);
    });

    await this.test('validateEventsHard: handles empty array', () => {
      const result = validateEventsHard([], { logRemovals: false });

      assert.deepStrictEqual(result.valid, []);
      assert.deepStrictEqual(result.invalid, []);
      assert.strictEqual(result.stats.total, 0);
    });

    await this.test('validateEventsHard: handles null/undefined', () => {
      const result1 = validateEventsHard(null, { logRemovals: false });
      const result2 = validateEventsHard(undefined, { logRemovals: false });

      assert.deepStrictEqual(result1.valid, []);
      assert.deepStrictEqual(result2.valid, []);
    });

    this.suite('validateEvent.js - Schema Versioning');

    await this.test('VALIDATION_SCHEMA_VERSION is defined', () => {
      assert.strictEqual(typeof VALIDATION_SCHEMA_VERSION, 'number');
      assert.ok(VALIDATION_SCHEMA_VERSION >= 1);
    });

    await this.test('needsReadTimeValidation: detects legacy data', () => {
      assert.strictEqual(needsReadTimeValidation(undefined), true);
      assert.strictEqual(needsReadTimeValidation(null), true);
      assert.strictEqual(needsReadTimeValidation(1), true);
      assert.strictEqual(needsReadTimeValidation(VALIDATION_SCHEMA_VERSION), false);
      assert.strictEqual(needsReadTimeValidation(VALIDATION_SCHEMA_VERSION + 1), false);
    });
  }

  // =========================================================================
  // HASHING TESTS
  // =========================================================================

  async testHashing() {
    this.suite('hashEvent.js - Hash Input Building');

    await this.test('buildHashInput: creates deterministic input', () => {
      const event = {
        title: 'Concert',
        venue_name: 'Stadium',
        address: '123 Main St',
        event_start_date: '2026-01-15',
        event_start_time: '19:00'
      };

      const input1 = buildHashInput(event);
      const input2 = buildHashInput(event);

      assert.strictEqual(input1, input2);
      assert.ok(input1.includes('concert'));
      assert.ok(input1.includes('stadium'));
      assert.ok(input1.includes('2026-01-15'));
      assert.ok(input1.includes('19:00'));
    });

    await this.test('buildHashInput: strips "at Venue" suffixes', () => {
      const event1 = {
        title: 'Cirque du Soleil',
        venue_name: 'Cosm',
        address: 'Dallas, TX',
        event_start_date: '2026-01-15',
        event_start_time: '19:00'
      };

      const event2 = {
        title: 'Cirque du Soleil at Cosm',
        venue_name: 'Cosm',
        address: 'Dallas, TX',
        event_start_date: '2026-01-15',
        event_start_time: '19:00'
      };

      const input1 = buildHashInput(event1);
      const input2 = buildHashInput(event2);

      // Both should produce same hash input after stripping " at Cosm"
      assert.strictEqual(input1, input2);
    });

    await this.test('buildHashInput: strips "@ Venue" suffixes', () => {
      const event1 = {
        title: 'DJ Night',
        venue_name: 'The Club',
        address: 'Dallas, TX',
        event_start_date: '2026-01-15',
        event_start_time: '21:00'
      };

      const event2 = {
        title: 'DJ Night @ The Club',
        venue_name: 'The Club',
        address: 'Dallas, TX',
        event_start_date: '2026-01-15',
        event_start_time: '21:00'
      };

      const input1 = buildHashInput(event1);
      const input2 = buildHashInput(event2);

      assert.strictEqual(input1, input2);
    });

    await this.test('buildHashInput: strips "- Venue" suffixes', () => {
      const event1 = {
        title: 'Festival',
        venue_name: 'City Park',
        address: 'Dallas, TX',
        event_start_date: '2026-01-15',
        event_start_time: '12:00'
      };

      const event2 = {
        title: 'Festival - City Park',
        venue_name: 'City Park',
        address: 'Dallas, TX',
        event_start_date: '2026-01-15',
        event_start_time: '12:00'
      };

      const input1 = buildHashInput(event1);
      const input2 = buildHashInput(event2);

      assert.strictEqual(input1, input2);
    });

    await this.test('buildHashInput: normalizes time for consistent hashing', () => {
      const event1 = {
        title: 'Concert',
        venue_name: 'Arena',
        event_start_date: '2026-01-15',
        event_start_time: '19:00'
      };

      const event2 = {
        title: 'Concert',
        venue_name: 'Arena',
        event_start_date: '2026-01-15',
        event_start_time: '7 PM'
      };

      const input1 = buildHashInput(event1);
      const input2 = buildHashInput(event2);

      assert.strictEqual(input1, input2);
    });

    this.suite('hashEvent.js - Hash Generation');

    await this.test('generateEventHash: returns 32-char MD5 hex', () => {
      const event = {
        title: 'Test Event',
        venue_name: 'Test Venue',
        event_start_date: '2026-01-15',
        event_start_time: '19:00'
      };

      const hash = generateEventHash(event);

      assert.strictEqual(hash.length, 32);
      assert.ok(/^[a-f0-9]+$/.test(hash));
    });

    await this.test('generateEventHash: is deterministic', () => {
      const event = {
        title: 'Test Event',
        venue_name: 'Test Venue',
        event_start_date: '2026-01-15',
        event_start_time: '19:00'
      };

      const hash1 = generateEventHash(event);
      const hash2 = generateEventHash(event);

      assert.strictEqual(hash1, hash2);
    });

    await this.test('generateEventHash: differentiates by time', () => {
      const event1 = {
        title: 'Show',
        venue_name: 'Theater',
        event_start_date: '2026-01-15',
        event_start_time: '14:00' // Matinee
      };

      const event2 = {
        title: 'Show',
        venue_name: 'Theater',
        event_start_date: '2026-01-15',
        event_start_time: '20:00' // Evening
      };

      const hash1 = generateEventHash(event1);
      const hash2 = generateEventHash(event2);

      assert.notStrictEqual(hash1, hash2);
    });

    await this.test('generateEventHash: differentiates by date', () => {
      const event1 = {
        title: 'Show',
        venue_name: 'Theater',
        event_start_date: '2026-01-15',
        event_start_time: '19:00'
      };

      const event2 = {
        title: 'Show',
        venue_name: 'Theater',
        event_start_date: '2026-01-16',
        event_start_time: '19:00'
      };

      const hash1 = generateEventHash(event1);
      const hash2 = generateEventHash(event2);

      assert.notStrictEqual(hash1, hash2);
    });

    this.suite('hashEvent.js - Hash Comparison Utilities');

    await this.test('eventsHaveSameHash: detects duplicates', () => {
      const event1 = {
        title: 'Concert at Venue',
        venue_name: 'Venue',
        event_start_date: '2026-01-15',
        event_start_time: '19:00'
      };

      const event2 = {
        title: 'Concert',
        venue_name: 'Venue',
        event_start_date: '2026-01-15',
        event_start_time: '7 PM'
      };

      assert.strictEqual(eventsHaveSameHash(event1, event2), true);
    });

    await this.test('eventsHaveSameHash: detects differences', () => {
      const event1 = {
        title: 'Concert A',
        venue_name: 'Venue',
        event_start_date: '2026-01-15',
        event_start_time: '19:00'
      };

      const event2 = {
        title: 'Concert B',
        venue_name: 'Venue',
        event_start_date: '2026-01-15',
        event_start_time: '19:00'
      };

      assert.strictEqual(eventsHaveSameHash(event1, event2), false);
    });

    await this.test('groupEventsByHash: groups duplicates', () => {
      const events = [
        { title: 'A', venue_name: 'V1', event_start_date: '2026-01-15', event_start_time: '19:00' },
        { title: 'A', venue_name: 'V1', event_start_date: '2026-01-15', event_start_time: '7 PM' }, // Duplicate
        { title: 'B', venue_name: 'V2', event_start_date: '2026-01-15', event_start_time: '19:00' },
        { title: 'B', venue_name: 'V2', event_start_date: '2026-01-15', event_start_time: '19:00' }  // Duplicate
      ];

      const groups = groupEventsByHash(events);

      assert.strictEqual(groups.size, 2); // 2 unique hashes
    });

    await this.test('findDuplicatesByHash: finds duplicate groups', () => {
      const events = [
        { title: 'Unique', venue_name: 'V1', event_start_date: '2026-01-15', event_start_time: '19:00' },
        { title: 'Dup', venue_name: 'V2', event_start_date: '2026-01-15', event_start_time: '19:00' },
        { title: 'Dup', venue_name: 'V2', event_start_date: '2026-01-15', event_start_time: '7 PM' }, // Same hash
        { title: 'Dup', venue_name: 'V2', event_start_date: '2026-01-15', event_start_time: '19:00' }  // Same hash
      ];

      const duplicates = findDuplicatesByHash(events);

      assert.strictEqual(duplicates.length, 1); // One group with duplicates
      assert.strictEqual(duplicates[0].count, 3); // 3 events in the duplicate group
    });

    await this.test('findDuplicatesByHash: handles no duplicates', () => {
      const events = [
        { title: 'Event 1', venue_name: 'V1', event_start_date: '2026-01-15', event_start_time: '19:00' },
        { title: 'Event 2', venue_name: 'V2', event_start_date: '2026-01-16', event_start_time: '20:00' },
        { title: 'Event 3', venue_name: 'V3', event_start_date: '2026-01-17', event_start_time: '21:00' }
      ];

      const duplicates = findDuplicatesByHash(events);

      assert.strictEqual(duplicates.length, 0);
    });
  }

  // =========================================================================
  // INTEGRATION TESTS
  // =========================================================================

  async testIntegration() {
    this.suite('ETL Integration - Full Pipeline');

    await this.test('Full pipeline: raw → normalized → validated → hashed', () => {
      // Simulate raw events from provider (uses old field names: event_date, event_time)
      const rawEvents = [
        {
          title: '"Taylor Swift Concert at AT&T Stadium"',
          venue: 'AT&T Stadium, Arlington, TX',
          event_date: '01/15/2026',
          event_time: '7 PM',
          event_end_time: '11 PM',  // 2026-01-10: Required by validation
          lat: '32.747778',
          lng: '-97.092778',
          category: 'concert',
          expected_attendance: 'high',
          source_model: 'test-provider'
        },
        {
          title: 'TBD Event',  // Should be filtered (TBD in title)
          venue: 'Unknown',
          event_date: '01/16/2026',
          event_time: '8 PM',
          event_end_time: '11 PM'
        },
        {
          title: '"Dallas Mavericks vs Lakers"',
          venue: 'American Airlines Center',
          address: '2500 Victory Ave, Dallas, TX',
          event_date: '01/17/2026',
          event_time: '7:30 PM',
          event_end_time: '10:30 PM',  // 2026-01-10: Required by validation
          category: 'NBA Game',
          expected_attendance: 'large'
        }
      ];

      // Step 1: Normalize
      const normalized = normalizeEvents(rawEvents, { city: 'Dallas', state: 'TX' });
      assert.strictEqual(normalized.length, 3);
      // 2026-01-10: Use symmetric field name in normalized output
      assert.strictEqual(normalized[0].event_start_time, '19:00');
      assert.strictEqual(normalized[2].category, 'sports');

      // Step 2: Validate
      const validated = validateEventsHard(normalized, { logRemovals: false });
      assert.strictEqual(validated.valid.length, 2);
      assert.strictEqual(validated.invalid.length, 1);
      assert.strictEqual(validated.invalid[0].reason, 'tbd_in_title');

      // Step 3: Hash
      const hashes = validated.valid.map(e => generateEventHash(e));
      assert.strictEqual(hashes.length, 2);
      assert.strictEqual(hashes[0].length, 32);

      // Verify hashes are unique
      const uniqueHashes = new Set(hashes);
      assert.strictEqual(uniqueHashes.size, 2);
    });

    await this.test('Idempotency: normalization is stable', () => {
      // Raw LLM input uses old field names
      const raw = {
        title: 'Test Event',
        venue: 'Test Venue',
        event_date: '01/15/2026',
        event_time: '7 PM'
      };

      // First normalization: raw (event_date, event_time) → normalized (event_start_date, event_start_time)
      const first = normalizeEvent(raw);
      // Second normalization: should be stable (normalizer accepts both old and new field names)
      const second = normalizeEvent(first);

      assert.strictEqual(first.title, second.title);
      // 2026-01-10: Use symmetric field names in normalized output
      assert.strictEqual(first.event_start_date, second.event_start_date);
      assert.strictEqual(first.event_start_time, second.event_start_time);
    });

    await this.test('Hash stability: venue suffix stripping prevents duplicates', () => {
      // These are the SAME event discovered differently by different providers
      const serpApiEvent = {
        title: 'Cirque du Soleil',
        venue_name: 'Cosm Dallas',
        address: 'The Colony, TX',
        event_start_date: '2026-01-15',
        event_start_time: '19:00'
      };

      const geminiEvent = {
        title: 'Cirque du Soleil at Cosm Dallas',
        venue_name: 'Cosm Dallas',
        address: 'The Colony, TX',
        event_start_date: '2026-01-15',
        event_start_time: '7 PM'
      };

      const hash1 = generateEventHash(serpApiEvent);
      const hash2 = generateEventHash(geminiEvent);

      assert.strictEqual(hash1, hash2, 'Same event should produce same hash regardless of title format');
    });
  }

  // =========================================================================
  // TEST RUNNER
  // =========================================================================

  async runAll() {
    console.log('\n🚀 ETL Pipeline Integration Tests');
    console.log('═'.repeat(60));

    await this.testNormalization();
    await this.testValidation();
    await this.testHashing();
    await this.testIntegration();

    this.printSummary();
  }

  printSummary() {
    console.log('\n' + '═'.repeat(60));
    console.log('📊 ETL PIPELINE TEST SUMMARY');
    console.log('═'.repeat(60));

    const passed = this.results.filter(r => r.success).length;
    const failed = this.results.filter(r => !r.success);
    const total = this.results.length;
    const percentage = ((passed / total) * 100).toFixed(1);

    console.log(`\n✅ Passed: ${passed}/${total} (${percentage}%)`);

    if (failed.length > 0) {
      console.log('\n❌ Failed tests:');
      failed.forEach(f => {
        console.log(`   - ${f.name}`);
        console.log(`     ${f.error}`);
      });
    }

    if (passed === total) {
      console.log('\n🎉 ALL ETL PIPELINE TESTS PASSED!');
      process.exit(0);
    } else {
      console.log('\n⚠️ Some tests failed. Review output above.');
      process.exit(1);
    }
  }
}

// Run if executed directly
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const tester = new ETLPipelineTester();
  tester.runAll().catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
  });
}

export default ETLPipelineTester;
