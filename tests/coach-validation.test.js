// tests/coach-validation.test.js
// Unit tests for AI Coach validation schemas
// Created: 2026-01-05

import {
  validateAction,
  marketSlugSchema,
  noteSchema,
  eventDeactivationSchema,
  zoneIntelSchema,
  systemNoteSchema
} from '../server/api/coach/validate.js';

async function testValidation() {
  console.log('[coach-validation] Starting validation schema tests...');
  let passed = 0;
  let failed = 0;

  // Helper to run test
  const test = (name, fn) => {
    try {
      fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (err) {
      console.log(`  ❌ ${name}: ${err.message}`);
      failed++;
    }
  };

  const assert = (condition, msg) => {
    if (!condition) throw new Error(msg);
  };

  // ============================================================================
  // Market Slug Validation
  // ============================================================================
  console.log('\n[coach-validation] Testing marketSlugSchema...');

  test('accepts valid market slug: dallas-tx', () => {
    const result = marketSlugSchema.safeParse('dallas-tx');
    assert(result.success, 'Should accept dallas-tx');
  });

  test('accepts valid market slug: new-york-ny', () => {
    const result = marketSlugSchema.safeParse('new-york-ny');
    assert(result.success, 'Should accept new-york-ny');
  });

  test('rejects uppercase: Dallas-TX', () => {
    const result = marketSlugSchema.safeParse('Dallas-TX');
    assert(!result.success, 'Should reject uppercase');
  });

  test('rejects spaces: dallas tx', () => {
    const result = marketSlugSchema.safeParse('dallas tx');
    assert(!result.success, 'Should reject spaces');
  });

  test('rejects underscores: dallas_tx', () => {
    const result = marketSlugSchema.safeParse('dallas_tx');
    assert(!result.success, 'Should reject underscores');
  });

  test('rejects too short: ab', () => {
    const result = marketSlugSchema.safeParse('ab');
    assert(!result.success, 'Should reject too short');
  });

  // ============================================================================
  // Note Schema Validation
  // ============================================================================
  console.log('\n[coach-validation] Testing noteSchema...');

  test('accepts valid note', () => {
    const result = noteSchema.safeParse({
      note_type: 'preference',
      title: 'Prefers mornings',
      content: 'Driver mentioned they like 5-10am shifts'
    });
    assert(result.success, 'Should accept valid note');
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
    assert(result.success, 'Should accept note with all fields');
  });

  test('rejects invalid note_type', () => {
    const result = noteSchema.safeParse({
      note_type: 'invalid',
      title: 'Test',
      content: 'Test content'
    });
    assert(!result.success, 'Should reject invalid note_type');
  });

  test('rejects missing title', () => {
    const result = noteSchema.safeParse({
      note_type: 'tip',
      content: 'Test content'
    });
    assert(!result.success, 'Should reject missing title');
  });

  test('rejects empty content', () => {
    const result = noteSchema.safeParse({
      note_type: 'tip',
      title: 'Test',
      content: ''
    });
    assert(!result.success, 'Should reject empty content');
  });

  test('rejects importance > 100', () => {
    const result = noteSchema.safeParse({
      note_type: 'tip',
      title: 'Test',
      content: 'Test content',
      importance: 150
    });
    assert(!result.success, 'Should reject importance > 100');
  });

  // ============================================================================
  // Event Deactivation Schema
  // ============================================================================
  console.log('\n[coach-validation] Testing eventDeactivationSchema...');

  test('accepts valid event deactivation', () => {
    const result = eventDeactivationSchema.safeParse({
      event_title: 'Taylor Swift Concert',
      reason: 'event_ended'
    });
    assert(result.success, 'Should accept valid deactivation');
  });

  test('accepts with event_id', () => {
    const result = eventDeactivationSchema.safeParse({
      event_id: '123e4567-e89b-12d3-a456-426614174000',
      event_title: 'Concert',
      reason: 'cancelled',
      notes: 'Cancelled due to weather'
    });
    assert(result.success, 'Should accept with UUID');
  });

  test('rejects invalid reason', () => {
    const result = eventDeactivationSchema.safeParse({
      event_title: 'Concert',
      reason: 'just_because'
    });
    assert(!result.success, 'Should reject invalid reason');
  });

  test('rejects invalid UUID', () => {
    const result = eventDeactivationSchema.safeParse({
      event_id: 'not-a-uuid',
      event_title: 'Concert',
      reason: 'event_ended'
    });
    assert(!result.success, 'Should reject invalid UUID');
  });

  // ============================================================================
  // Zone Intel Schema
  // ============================================================================
  console.log('\n[coach-validation] Testing zoneIntelSchema...');

  test('accepts valid zone intel', () => {
    const result = zoneIntelSchema.safeParse({
      zone_type: 'honey_hole',
      zone_name: 'Deep Ellum',
      market_slug: 'dallas-tx',
      reason: 'Great for short rides on weekends'
    });
    assert(result.success, 'Should accept valid zone intel');
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
    assert(result.success, 'Should accept with coordinates');
  });

  test('rejects missing market_slug', () => {
    const result = zoneIntelSchema.safeParse({
      zone_type: 'dead_zone',
      zone_name: 'Industrial Area',
      reason: 'No rides here'
    });
    assert(!result.success, 'Should reject missing market_slug');
  });

  test('rejects invalid zone_type', () => {
    const result = zoneIntelSchema.safeParse({
      zone_type: 'good_zone',
      zone_name: 'Test',
      market_slug: 'dallas-tx',
      reason: 'Test'
    });
    assert(!result.success, 'Should reject invalid zone_type');
  });

  // ============================================================================
  // System Note Schema
  // ============================================================================
  console.log('\n[coach-validation] Testing systemNoteSchema...');

  test('accepts valid system note', () => {
    const result = systemNoteSchema.safeParse({
      type: 'feature_request',
      category: 'coach',
      title: 'Multi-stop routing',
      description: 'User wants to plan routes with multiple pickups'
    });
    assert(result.success, 'Should accept valid system note');
  });

  test('accepts with user_quote', () => {
    const result = systemNoteSchema.safeParse({
      type: 'pain_point',
      category: 'ui',
      title: 'Map is confusing',
      description: 'User struggled to find venue markers',
      user_quote: 'Where are the bars on this map?'
    });
    assert(result.success, 'Should accept with user_quote');
  });

  test('rejects invalid type', () => {
    const result = systemNoteSchema.safeParse({
      type: 'complaint',
      category: 'coach',
      title: 'Test',
      description: 'Test'
    });
    assert(!result.success, 'Should reject invalid type');
  });

  // ============================================================================
  // validateAction function
  // ============================================================================
  console.log('\n[coach-validation] Testing validateAction()...');

  test('validateAction returns ok for valid SAVE_NOTE', () => {
    const result = validateAction('SAVE_NOTE', {
      note_type: 'tip',
      title: 'Test',
      content: 'Test content'
    });
    assert(result.ok, 'Should return ok: true');
    assert(result.data, 'Should include validated data');
  });

  test('validateAction returns errors for invalid action', () => {
    const result = validateAction('SAVE_NOTE', {
      note_type: 'invalid',
      title: '',
      content: ''
    });
    assert(!result.ok, 'Should return ok: false');
    assert(Array.isArray(result.errors), 'Should include errors array');
    assert(result.errors.length > 0, 'Should have at least one error');
  });

  test('validateAction rejects unknown action type', () => {
    const result = validateAction('UNKNOWN_ACTION', { foo: 'bar' });
    assert(!result.ok, 'Should return ok: false');
    assert(result.errors[0].field === 'action_type', 'Should flag action_type');
  });

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('\n[coach-validation] ================================');
  console.log(`[coach-validation] Tests: ${passed + failed} total`);
  console.log(`[coach-validation] Passed: ${passed}`);
  console.log(`[coach-validation] Failed: ${failed}`);
  console.log('[coach-validation] ================================');

  return { ok: failed === 0, passed, failed };
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testValidation().then(result => {
    process.exit(result.ok ? 0 : 1);
  });
}

export default testValidation;
