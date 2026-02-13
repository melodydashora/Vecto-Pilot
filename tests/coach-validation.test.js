// tests/coach-validation.test.js
// Unit tests for AI Coach validation schemas
// Converted to standard Jest format

import {
  validateAction,
  marketSlugSchema,
  noteSchema,
  eventDeactivationSchema,
  zoneIntelSchema,
  systemNoteSchema
} from '../server/api/coach/validate.js';

describe('Coach Validation', () => {

  // ============================================================================
  // Market Slug Validation
  // ============================================================================
  describe('marketSlugSchema', () => {
    test('accepts valid market slug: dallas-tx', () => {
      const result = marketSlugSchema.safeParse('dallas-tx');
      expect(result.success).toBe(true);
    });

    test('accepts valid market slug: new-york-ny', () => {
      const result = marketSlugSchema.safeParse('new-york-ny');
      expect(result.success).toBe(true);
    });

    test('rejects uppercase: Dallas-TX', () => {
      const result = marketSlugSchema.safeParse('Dallas-TX');
      expect(result.success).toBe(false);
    });

    test('rejects spaces: dallas tx', () => {
      const result = marketSlugSchema.safeParse('dallas tx');
      expect(result.success).toBe(false);
    });

    test('rejects underscores: dallas_tx', () => {
      const result = marketSlugSchema.safeParse('dallas_tx');
      expect(result.success).toBe(false);
    });

    test('rejects too short: ab', () => {
      const result = marketSlugSchema.safeParse('ab');
      expect(result.success).toBe(false);
    });
  });

  // ============================================================================
  // Note Schema Validation
  // ============================================================================
  describe('noteSchema', () => {
    test('accepts valid note', () => {
      const result = noteSchema.safeParse({
        note_type: 'preference',
        title: 'Prefers mornings',
        content: 'Driver mentioned they like 5-10am shifts'
      });
      expect(result.success).toBe(true);
    });

    test('accepts note with all optional fields', () => {
      const result = noteSchema.safeParse({
        note_type: 'insight',
        category: 'timing',
        title: 'Surge pattern',
        content: 'Airport surge at 6am on weekdays',
        importance: 80,
        confidence: 90,
        market_slug: 'dallas-tx',
        neighborhoods: ['downtown', 'uptown'],
        context: 'Learned from 3 weeks of tracking'
      });
      expect(result.success).toBe(true);
    });

    test('rejects invalid note_type', () => {
      const result = noteSchema.safeParse({
        note_type: 'invalid',
        title: 'Test',
        content: 'Test content'
      });
      expect(result.success).toBe(false);
    });

    test('rejects missing title', () => {
      const result = noteSchema.safeParse({
        note_type: 'tip',
        content: 'Test content'
      });
      expect(result.success).toBe(false);
    });

    test('rejects empty content', () => {
      const result = noteSchema.safeParse({
        note_type: 'tip',
        title: 'Test',
        content: ''
      });
      expect(result.success).toBe(false);
    });

    test('rejects importance > 100', () => {
      const result = noteSchema.safeParse({
        note_type: 'tip',
        title: 'Test',
        content: 'Test content',
        importance: 150
      });
      expect(result.success).toBe(false);
    });
  });

  // ============================================================================
  // Event Deactivation Schema
  // ============================================================================
  describe('eventDeactivationSchema', () => {
    test('accepts valid event deactivation', () => {
      const result = eventDeactivationSchema.safeParse({
        event_title: 'Taylor Swift Concert',
        reason: 'event_ended'
      });
      expect(result.success).toBe(true);
    });

    test('accepts with event_id', () => {
      const result = eventDeactivationSchema.safeParse({
        event_id: '123e4567-e89b-12d3-a456-426614174000',
        event_title: 'Concert',
        reason: 'cancelled',
        notes: 'Cancelled due to weather'
      });
      expect(result.success).toBe(true);
    });

    test('rejects invalid reason', () => {
      const result = eventDeactivationSchema.safeParse({
        event_title: 'Concert',
        reason: 'just_because'
      });
      expect(result.success).toBe(false);
    });

    test('rejects invalid UUID', () => {
      const result = eventDeactivationSchema.safeParse({
        event_id: 'not-a-uuid',
        event_title: 'Concert',
        reason: 'event_ended'
      });
      expect(result.success).toBe(false);
    });
  });

  // ============================================================================
  // Zone Intel Schema
  // ============================================================================
  describe('zoneIntelSchema', () => {
    test('accepts valid zone intel', () => {
      const result = zoneIntelSchema.safeParse({
        zone_type: 'honey_hole',
        zone_name: 'Deep Ellum',
        market_slug: 'dallas-tx',
        reason: 'Great for short rides on weekends'
      });
      expect(result.success).toBe(true);
    });

    test('accepts with coordinates', () => {
      const result = zoneIntelSchema.safeParse({
        zone_type: 'staging_spot',
        zone_name: 'DFW Terminal A',
        market_slug: 'dallas-tx',
        reason: 'Good cell signal and bathroom nearby',
        lat: 32.8998,
        lng: -97.0403
      });
      expect(result.success).toBe(true);
    });

    test('rejects missing market_slug', () => {
      const result = zoneIntelSchema.safeParse({
        zone_type: 'dead_zone',
        zone_name: 'Industrial Area',
        reason: 'No rides here'
      });
      expect(result.success).toBe(false);
    });

    test('rejects invalid zone_type', () => {
      const result = zoneIntelSchema.safeParse({
        zone_type: 'good_zone',
        zone_name: 'Test',
        market_slug: 'dallas-tx',
        reason: 'Test'
      });
      expect(result.success).toBe(false);
    });
  });

  // ============================================================================
  // System Note Schema
  // ============================================================================
  describe('systemNoteSchema', () => {
    test('accepts valid system note', () => {
      const result = systemNoteSchema.safeParse({
        type: 'feature_request',
        category: 'coach',
        title: 'Multi-stop routing',
        description: 'User wants to plan routes with multiple pickups'
      });
      expect(result.success).toBe(true);
    });

    test('accepts with user_quote', () => {
      const result = systemNoteSchema.safeParse({
        type: 'pain_point',
        category: 'ui',
        title: 'Map is confusing',
        description: 'User struggled to find venue markers',
        user_quote: 'Where are the bars on this map?'
      });
      expect(result.success).toBe(true);
    });

    test('rejects invalid type', () => {
      const result = systemNoteSchema.safeParse({
        type: 'complaint',
        category: 'coach',
        title: 'Test',
        description: 'Test'
      });
      expect(result.success).toBe(false);
    });
  });

  // ============================================================================
  // validateAction function
  // ============================================================================
  describe('validateAction', () => {
    test('returns ok for valid SAVE_NOTE', () => {
      const result = validateAction('SAVE_NOTE', {
        note_type: 'tip',
        title: 'Test',
        content: 'Test content'
      });
      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
    });

    test('returns errors for invalid action', () => {
      const result = validateAction('SAVE_NOTE', {
        note_type: 'invalid',
        title: '',
        content: ''
      });
      expect(result.ok).toBe(false);
      expect(Array.isArray(result.errors)).toBe(true);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('rejects unknown action type', () => {
      const result = validateAction('UNKNOWN_ACTION', { foo: 'bar' });
      expect(result.ok).toBe(false);
      expect(result.errors[0].field).toBe('action_type');
    });
  });
});