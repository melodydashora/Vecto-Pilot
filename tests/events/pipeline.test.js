/**
 * tests/events/pipeline.test.js
 *
 * Integration tests for the canonical ETL pipeline modules:
 * - normalizeEvent.js
 * - validateEvent.js
 * - hashEvent.js
 *
 * Converted to standard Jest format.
 */

import {
  normalizeTitle,
  normalizeVenueName,
  normalizeDate,
  normalizeTime,
  normalizeCategory,
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

describe('ETL Pipeline Integration', () => {

  // =========================================================================
  // NORMALIZATION TESTS
  // =========================================================================

  describe('normalizeEvent.js', () => {
    describe('Title Normalization', () => {
      test('removes surrounding quotes', () => {
        expect(normalizeTitle('"Concert at Stadium"')).toBe('Concert at Stadium');
        expect(normalizeTitle("'Live Show'")).toBe('Live Show');
        expect(normalizeTitle('"Test Event"')).toBe('Test Event');
      });

      test('collapses whitespace', () => {
        expect(normalizeTitle('Concert   at   Stadium')).toBe('Concert at Stadium');
        expect(normalizeTitle('  Trimmed  ')).toBe('Trimmed');
      });

      test('handles null/undefined', () => {
        expect(normalizeTitle(null)).toBe('');
        expect(normalizeTitle(undefined)).toBe('');
        expect(normalizeTitle('')).toBe('');
      });
    });

    describe('Venue Normalization', () => {
      test('extracts venue from combined string', () => {
        expect(normalizeVenueName('Madison Square Garden, 4 Penn Plaza')).toBe('Madison Square Garden');
        expect(normalizeVenueName('The Venue')).toBe('The Venue');
      });

      test('handles null/undefined', () => {
        expect(normalizeVenueName(null)).toBe('');
        expect(normalizeVenueName(undefined)).toBe('');
      });
    });

    describe('Date Normalization', () => {
      test('passes through YYYY-MM-DD', () => {
        expect(normalizeDate('2026-01-15')).toBe('2026-01-15');
        expect(normalizeDate('2025-12-31')).toBe('2025-12-31');
      });

      test('converts MM/DD/YYYY', () => {
        expect(normalizeDate('01/15/2026')).toBe('2026-01-15');
        expect(normalizeDate('12/31/2025')).toBe('2025-12-31');
        expect(normalizeDate('1/5/2026')).toBe('2026-01-05');
      });

      test('parses Month DD, YYYY', () => {
        expect(normalizeDate('January 15, 2026')).toBe('2026-01-15');
      });

      test('returns null for invalid', () => {
        expect(normalizeDate('invalid')).toBeNull();
        expect(normalizeDate(null)).toBeNull();
        expect(normalizeDate('')).toBeNull();
      });
    });

    describe('Time Normalization', () => {
      test('passes through HH:MM', () => {
        expect(normalizeTime('19:00')).toBe('19:00');
        expect(normalizeTime('09:30')).toBe('09:30');
      });

      test('converts 12-hour format', () => {
        expect(normalizeTime('7 PM')).toBe('19:00');
        expect(normalizeTime('7:30 PM')).toBe('19:30');
        expect(normalizeTime('12 PM')).toBe('12:00');
        expect(normalizeTime('12 AM')).toBe('00:00');
        expect(normalizeTime('11 AM')).toBe('11:00');
      });

      test('handles case insensitivity', () => {
        expect(normalizeTime('7pm')).toBe('19:00');
        expect(normalizeTime('7:30PM')).toBe('19:30');
        expect(normalizeTime('7 pm')).toBe('19:00');
      });

      test('returns null for invalid', () => {
        expect(normalizeTime('invalid')).toBeNull();
        expect(normalizeTime(null)).toBeNull();
        expect(normalizeTime('')).toBeNull();
      });
    });

    describe('Category Normalization', () => {
      test('maps concert keywords', () => {
        expect(normalizeCategory('concert')).toBe('concert');
        expect(normalizeCategory('Live Music')).toBe('concert');
        expect(normalizeCategory('Music Festival')).toBe('concert');
      });

      test('maps sports keywords', () => {
        expect(normalizeCategory('sports')).toBe('sports');
        expect(normalizeCategory('NBA Game')).toBe('sports');
        expect(normalizeCategory('NFL Football')).toBe('sports');
      });

      test('defaults to other', () => {
        expect(normalizeCategory('random')).toBe('other');
        expect(normalizeCategory(null)).toBe('other');
      });
    });

    describe('Full Event Normalization', () => {
      test('normalizes complete event', () => {
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

        expect(normalized.title).toBe('Concert at Madison Square Garden');
        expect(normalized.venue_name).toBe('MSG');
        expect(normalized.event_start_date).toBe('2026-01-15');
        expect(normalized.event_start_time).toBe('19:00');
        expect(normalized.city).toBe('New York');
        expect(normalized.state).toBe('NY');
        expect(normalized.category).toBe('concert');
        expect(normalized.expected_attendance).toBe('high');
      });

      test('uses context for city/state', () => {
        const raw = { title: 'Test Event', event_date: '2026-01-15', event_time: '19:00' };
        const normalized = normalizeEvent(raw, { city: 'Dallas', state: 'TX' });

        expect(normalized.city).toBe('Dallas');
        expect(normalized.state).toBe('TX');
      });

      test('normalizes array', () => {
        const rawEvents = [
          { title: 'Event 1', event_date: '2026-01-15', event_time: '7 PM' },
          { title: 'Event 2', event_date: '2026-01-16', event_time: '8 PM' }
        ];

        const normalized = normalizeEvents(rawEvents, { city: 'Dallas', state: 'TX' });

        expect(normalized.length).toBe(2);
        expect(normalized[0].event_start_time).toBe('19:00');
        expect(normalized[1].event_start_time).toBe('20:00');
      });

      test('handles non-array gracefully', () => {
        expect(normalizeEvents(null)).toEqual([]);
        expect(normalizeEvents(undefined)).toEqual([]);
        expect(normalizeEvents('string')).toEqual([]);
      });
    });
  });

  // =========================================================================
  // VALIDATION TESTS
  // =========================================================================

  describe('validateEvent.js', () => {
    describe('Single Event Validation', () => {
      test('passes valid event', () => {
        const event = {
          title: 'Valid Concert',
          venue_name: 'Madison Square Garden',
          address: '4 Penn Plaza, New York, NY',
          event_start_date: '2026-01-15',
          event_start_time: '19:00',
          event_end_time: '22:00'
        };

        const result = validateEvent(event);
        expect(result.valid).toBe(true);
        expect(result.reason).toBeNull();
      });

      test('rejects missing title', () => {
        const event = { venue_name: 'Venue', event_start_date: '2026-01-15', event_start_time: '19:00', event_end_time: '22:00' };
        const result = validateEvent(event);

        expect(result.valid).toBe(false);
        expect(result.reason).toBe('missing_title');
      });

      test('rejects TBD in title', () => {
        const event = {
          title: 'Event TBD',
          venue_name: 'Venue',
          event_start_date: '2026-01-15',
          event_start_time: '19:00',
          event_end_time: '22:00'
        };

        const result = validateEvent(event);
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('tbd_in_title');
      });

      test('rejects missing location', () => {
        const event = {
          title: 'Valid Event',
          event_start_date: '2026-01-15',
          event_start_time: '19:00',
          event_end_time: '22:00'
        };

        const result = validateEvent(event);
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('missing_location');
      });

      test('accepts address-only event', () => {
        const event = {
          title: 'Valid Event',
          address: '123 Main St',
          event_start_date: '2026-01-15',
          event_start_time: '19:00',
          event_end_time: '22:00'
        };

        const result = validateEvent(event);
        expect(result.valid).toBe(true);
      });

      test('rejects missing end time', () => {
        const event = {
          title: 'Valid Event',
          venue_name: 'Venue',
          event_start_date: '2026-01-15',
          event_start_time: '19:00'
        };

        const result = validateEvent(event);
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('missing_end_time');
      });
    });

    describe('Batch Validation', () => {
      test('separates valid and invalid', () => {
        const events = [
          { title: 'Valid 1', venue_name: 'V1', event_start_date: '2026-01-15', event_start_time: '19:00', event_end_time: '22:00' },
          { title: 'TBD Event', venue_name: 'V2', event_start_date: '2026-01-15', event_start_time: '19:00', event_end_time: '22:00' },
          { title: 'Valid 2', venue_name: 'V3', event_start_date: '2026-01-16', event_start_time: '20:00', event_end_time: '23:00' },
          { title: 'No End Time', venue_name: 'V4', event_start_date: '2026-01-15', event_start_time: '19:00' }
        ];

        const result = validateEventsHard(events, { logRemovals: false });

        expect(result.valid.length).toBe(2);
        expect(result.invalid.length).toBe(2);
        expect(result.stats.total).toBe(4);
        expect(result.stats.valid).toBe(2);
        expect(result.stats.invalid).toBe(2);
      });

      test('handles empty array', () => {
        const result = validateEventsHard([], { logRemovals: false });
        expect(result.valid).toEqual([]);
        expect(result.invalid).toEqual([]);
        expect(result.stats.total).toBe(0);
      });

      test('handles null/undefined', () => {
        const result1 = validateEventsHard(null, { logRemovals: false });
        const result2 = validateEventsHard(undefined, { logRemovals: false });

        expect(result1.valid).toEqual([]);
        expect(result2.valid).toEqual([]);
      });
    });

    describe('Schema Versioning', () => {
      test('VALIDATION_SCHEMA_VERSION is defined', () => {
        expect(typeof VALIDATION_SCHEMA_VERSION).toBe('number');
        expect(VALIDATION_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
      });

      test('needsReadTimeValidation: detects legacy data', () => {
        expect(needsReadTimeValidation(undefined)).toBe(true);
        expect(needsReadTimeValidation(null)).toBe(true);
        expect(needsReadTimeValidation(1)).toBe(true);
        expect(needsReadTimeValidation(VALIDATION_SCHEMA_VERSION)).toBe(false);
        expect(needsReadTimeValidation(VALIDATION_SCHEMA_VERSION + 1)).toBe(false);
      });
    });
  });

  // =========================================================================
  // HASHING TESTS
  // =========================================================================

  describe('hashEvent.js', () => {
    describe('Hash Input Building', () => {
      test('creates deterministic input', () => {
        const event = {
          title: 'Concert',
          venue_name: 'Stadium',
          address: '123 Main St',
          event_start_date: '2026-01-15',
          event_start_time: '19:00'
        };

        const input1 = buildHashInput(event);
        const input2 = buildHashInput(event);

        expect(input1).toBe(input2);
        expect(input1).toContain('concert');
        expect(input1).toContain('stadium');
        expect(input1).toContain('2026-01-15');
        expect(input1).toContain('19:00');
      });

      test('strips "at Venue" suffixes', () => {
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

        expect(input1).toBe(input2);
      });

      test('normalizes time for consistent hashing', () => {
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

        expect(input1).toBe(input2);
      });
    });

    describe('Hash Generation', () => {
      test('returns 32-char MD5 hex', () => {
        const event = {
          title: 'Test Event',
          venue_name: 'Test Venue',
          event_start_date: '2026-01-15',
          event_start_time: '19:00'
        };

        const hash = generateEventHash(event);
        expect(hash.length).toBe(32);
        expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
      });

      test('differentiates by time', () => {
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

        expect(hash1).not.toBe(hash2);
      });
    });

    describe('Hash Comparison Utilities', () => {
      test('eventsHaveSameHash detects duplicates', () => {
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

        expect(eventsHaveSameHash(event1, event2)).toBe(true);
      });

      test('groupEventsByHash groups duplicates', () => {
        const events = [
          { title: 'A', venue_name: 'V1', event_start_date: '2026-01-15', event_start_time: '19:00' },
          { title: 'A', venue_name: 'V1', event_start_date: '2026-01-15', event_start_time: '7 PM' },
          { title: 'B', venue_name: 'V2', event_start_date: '2026-01-15', event_start_time: '19:00' },
          { title: 'B', venue_name: 'V2', event_start_date: '2026-01-15', event_start_time: '19:00' }
        ];

        const groups = groupEventsByHash(events);
        expect(groups.size).toBe(2);
      });

      test('findDuplicatesByHash finds duplicate groups', () => {
        const events = [
          { title: 'Unique', venue_name: 'V1', event_start_date: '2026-01-15', event_start_time: '19:00' },
          { title: 'Dup', venue_name: 'V2', event_start_date: '2026-01-15', event_start_time: '19:00' },
          { title: 'Dup', venue_name: 'V2', event_start_date: '2026-01-15', event_start_time: '7 PM' },
          { title: 'Dup', venue_name: 'V2', event_start_date: '2026-01-15', event_start_time: '19:00' }
        ];

        const duplicates = findDuplicatesByHash(events);
        expect(duplicates.length).toBe(1);
        expect(duplicates[0].count).toBe(3);
      });
    });
  });

  // =========================================================================
  // INTEGRATION TESTS
  // =========================================================================

  describe('Full Pipeline Integration', () => {
    test('raw → normalized → validated → hashed', () => {
      const rawEvents = [
        {
          title: '"Taylor Swift Concert at AT&T Stadium"',
          venue: 'AT&T Stadium, Arlington, TX',
          event_date: '01/15/2026',
          event_time: '7 PM',
          event_end_time: '11 PM',
          lat: '32.747778',
          lng: '-97.092778',
          category: 'concert',
          expected_attendance: 'high',
          source_model: 'test-provider'
        },
        {
          title: 'TBD Event',
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
          event_end_time: '10:30 PM',
          category: 'NBA Game',
          expected_attendance: 'large'
        }
      ];

      // Step 1: Normalize
      const normalized = normalizeEvents(rawEvents, { city: 'Dallas', state: 'TX' });
      expect(normalized.length).toBe(3);
      expect(normalized[0].event_start_time).toBe('19:00');
      expect(normalized[2].category).toBe('sports');

      // Step 2: Validate
      const validated = validateEventsHard(normalized, { logRemovals: false });
      expect(validated.valid.length).toBe(2);
      expect(validated.invalid.length).toBe(1);
      expect(validated.invalid[0].reason).toBe('tbd_in_title');

      // Step 3: Hash
      const hashes = validated.valid.map(e => generateEventHash(e));
      expect(hashes.length).toBe(2);
      expect(hashes[0].length).toBe(32);

      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(2);
    });
  });
});