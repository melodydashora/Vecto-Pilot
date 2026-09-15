import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createAnonymousToken, validateAnonymousToken, parseConciergeCoordinates } from '../server/lib/concierge/anonymous-token.js';

const ask = jest.fn(async () => ({ ok: true, answer: 'Local answer' }));
const timezoneLookup = jest.fn(async () => 'Etc/UTC');
jest.unstable_mockModule('../server/lib/concierge/concierge-service.js', () => ({
  searchNearby: jest.fn(async () => ({ venues: [], events: [] })),
  askConcierge: ask,
  buildConciergeSystemPrompt: jest.fn(),
}));
jest.unstable_mockModule('../server/lib/location/geocode.js', () => ({ getTimezoneForCoords: timezoneLookup }));
const { default: router } = await import('../server/api/concierge/concierge.js');
const app = express().use(express.json()).use('/api/concierge', router);

beforeEach(() => {
  process.env.JWT_SECRET = 'test-only-concierge-signing-key';
  ask.mockClear();
  timezoneLookup.mockClear();
});

describe('anonymous concierge bookmarks', () => {
  test('assigns unique signed tokens without driver identity or an expiry', () => {
    const one = createAnonymousToken();
    expect(one).not.toBe(createAnonymousToken());
    expect(validateAnonymousToken(one)).toBe(true);
    expect(validateAnonymousToken(one.slice(0, -1) + (one.endsWith('a') ? 'b' : 'a'))).toBe(false);
    expect(validateAnonymousToken('old_driver_share')).toBe(false);
    process.env.JWT_SECRET = 'rotated-test-key';
    expect(validateAnonymousToken(one)).toBe(false);
  });

  test('creates and reopens a bookmark with no profile fields', async () => {
    const result = await request(app).post('/api/concierge/session').send({ user_id: 'ignored', name: 'ignored' }).expect(200);
    expect(Object.keys(result.body).sort()).toEqual(['ok', 'token']);
    const reopened = await request(app).get(`/api/concierge/p/${result.body.token}`).expect(200);
    expect(reopened.body).toEqual({ ok: true, anonymous: true });
    expect(reopened.headers['cache-control']).toBe('no-store');
  });

  test('retires driver sharing and feedback without changing stored profiles', async () => {
    for (const path of ['/token', '/preview', '/feedback', '/p/legacy/feedback']) {
      await request(app).get(`/api/concierge${path}`).expect(410);
    }
  });

  test('requires a valid signed bookmark before location or model calls', async () => {
    await request(app).post('/api/concierge/p/invalid/ask').send({ question: 'Hello', lat: 0, lng: 0 }).expect(404);
    expect(ask).not.toHaveBeenCalled();
    expect(timezoneLookup).not.toHaveBeenCalled();
  });

  test('rounds GPS to six decimals, resolves timezone server-side, and never forwards driver fields', async () => {
    const token = createAnonymousToken();
    await request(app).post(`/api/concierge/p/${token}/ask`).send({ question: 'Hello', lat: 1.12345678, lng: -2.23456789, timezone: 'invented', driver_id: 'ignored' }).expect(200);
    expect(ask).toHaveBeenCalledWith({ question: 'Hello', lat: 1.123457, lng: -2.234568, timezone: 'Etc/UTC', venueContext: '', eventContext: '' });
  });

  test.each([[null, 0], ['', 0], [true, 0], [91, 0], [0, -181], [Infinity, 0]])('rejects invalid GPS without treating it as zero: %p, %p', (lat, lng) => {
    expect(() => parseConciergeCoordinates(lat, lng)).toThrow();
  });
  test('retains valid zero coordinates', () => {
    expect(parseConciergeCoordinates(0, 0)).toEqual({ lat: 0, lng: 0 });
  });
});
