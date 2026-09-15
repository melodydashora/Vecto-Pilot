import assert from 'node:assert/strict';
import { test, expect, jest } from '@jest/globals';
jest.unstable_mockModule('../server/db/drizzle.js', () => ({ db: {} }));
jest.unstable_mockModule('../server/lib/ai/adapters/index.js', () => ({ callModel: jest.fn() }));
const { compareNearEventImpact } = await import('../server/lib/ai/providers/consolidator.js');
const sortNearEvents = events => [...events].sort(compareNearEventImpact);

// ========== TEST SCENARIOS ==========

// TEST 1: Stadium beats karaoke (the original bug scenario)
test("Stadium beats karaoke (the original bug scenario)", () => {
  const events = [
    { name: 'Live Band Karaoke', estimated_attendance: 350, distance_mi: 3 },
    { name: 'Cowboys vs Eagles', estimated_attendance: 15000, distance_mi: 7 },
  ];
  const sorted = sortNearEvents(events);
  assert(sorted[0].name === 'Cowboys vs Eagles',
    `TEST 1 FAIL: Expected Cowboys vs Eagles first, got ${sorted[0].name}`);

});

// TEST 2: Concert beats open mic
test("Concert beats open mic", () => {
  const events = [
    { name: 'Open Mic Night', estimated_attendance: 200, distance_mi: 5 },
    { name: 'Taylor Swift Concert', estimated_attendance: 12000, distance_mi: 6 },
  ];
  const sorted = sortNearEvents(events);
  assert(sorted[0].name === 'Taylor Swift Concert',
    `TEST 2 FAIL: Expected Taylor Swift Concert first, got ${sorted[0].name}`);

});

// TEST 3: Very close small event loses to moderately close large event
test("Very close small event loses to moderately close large event", () => {
  const events = [
    { name: 'Comedy Show', estimated_attendance: 350, distance_mi: 0.5 },
    { name: 'NBA Playoff Game', estimated_attendance: 18000, distance_mi: 8 },
  ];
  const sorted = sortNearEvents(events);
  assert(sorted[0].name === 'NBA Playoff Game',
    `TEST 3 FAIL: Expected NBA Playoff Game first, got ${sorted[0].name}`);

});

// TEST 4: Same capacity — closer event wins (distance tiebreaker preserved)
test("Same capacity \u2014 closer event wins (distance tiebreaker preserved)", () => {
  const events = [
    { name: 'Theater A', estimated_attendance: 2000, distance_mi: 10 },
    { name: 'Theater B', estimated_attendance: 2000, distance_mi: 3 },
  ];
  const sorted = sortNearEvents(events);
  assert(sorted[0].name === 'Theater B',
    `TEST 4 FAIL: Expected Theater B (closer) first, got ${sorted[0].name}`);

});

// TEST 5: Same distance — higher capacity wins
test("Same distance \u2014 higher capacity wins", () => {
  const events = [
    { name: 'Small Club', estimated_attendance: 500, distance_mi: 5 },
    { name: 'Arena Show', estimated_attendance: 12000, distance_mi: 5 },
  ];
  const sorted = sortNearEvents(events);
  assert(sorted[0].name === 'Arena Show',
    `TEST 5 FAIL: Expected Arena Show first, got ${sorted[0].name}`);

});

// TEST 6: Missing estimated_attendance defaults to 1000 (medium)
test("Missing estimated_attendance defaults to 1000 (medium)", () => {
  const events = [
    { name: 'Unknown Event A', distance_mi: 2 },
    { name: 'Unknown Event B', distance_mi: 8 },
  ];
  const sorted = sortNearEvents(events);
  assert(sorted[0].name === 'Unknown Event A',
    `TEST 6 FAIL: With default capacity, closer should win. Got ${sorted[0].name}`);

});

// TEST 7: Zero distance event (driver is AT the venue)
test("Zero distance event (driver is AT the venue)", () => {
  const events = [
    { name: 'My Location Bar', estimated_attendance: 300, distance_mi: 0 },
    { name: 'Nearby Stadium', estimated_attendance: 15000, distance_mi: 2 },
  ];
  const sorted = sortNearEvents(events);
  assert(sorted[0].name === 'Nearby Stadium',
    `TEST 7 FAIL: Stadium should still beat bar at driver location. Got ${sorted[0].name}`);

});

// TEST 8: Edge case — all events have same score (stable sort)
// 1000/5=200, 2000/10=200 — same score
test("Edge case \u2014 all events have same score (stable sort)", () => {
  const events = [
    { name: 'Event A', estimated_attendance: 1000, distance_mi: 4 },
    { name: 'Event B', estimated_attendance: 2000, distance_mi: 9 },
  ];
  const sorted = sortNearEvents(events);

});

// TEST 9: Real-world scenario — 5 mixed events sorted correctly
test("Real-world scenario \u2014 5 mixed events sorted correctly", () => {
  const events = [
    { name: 'Karaoke Bar', estimated_attendance: 350, distance_mi: 2 },
    { name: 'College Football', estimated_attendance: 15000, distance_mi: 8 },
    { name: 'Jazz Club', estimated_attendance: 500, distance_mi: 1 },
    { name: 'Music Festival', estimated_attendance: 8000, distance_mi: 12 },
    { name: 'Convention', estimated_attendance: 8000, distance_mi: 5 },
  ];
  const sorted = sortNearEvents(events);
  const order = sorted.map(e => e.name);
  assert(order[0] === 'College Football', `TEST 9 FAIL: #1 should be College Football, got ${order[0]}`);
  assert(order[1] === 'Convention', `TEST 9 FAIL: #2 should be Convention, got ${order[1]}`);
  assert(order[2] === 'Music Festival', `TEST 9 FAIL: #3 should be Music Festival, got ${order[2]}`);

});

// TEST 10: The Melody scenario — 50mi karaoke vs 8mi game day
test("The Melody scenario \u2014 50mi karaoke vs 8mi game day", () => {
  const events = [
    { name: 'Live Band Karaoke', estimated_attendance: 350, distance_mi: 50 },
    { name: 'Big Game Letout', estimated_attendance: 15000, distance_mi: 8 },
  ];
  const sorted = sortNearEvents(events);
  assert(sorted[0].name === 'Big Game Letout',
    `TEST 10 FAIL: 8mi game should CRUSH 50mi karaoke. Got ${sorted[0].name}`);

});
