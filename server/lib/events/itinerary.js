// server/lib/events/itinerary.js
// 2026-04-25: AI-assisted itinerary generation for paid mentor sessions.
// Calls Anthropic Haiku directly via the existing adapter for low-latency admin UX.
// Plan: docs/plans/PLAN_event-signup-page-2026-04-25.md

import { callAnthropic } from '../ai/adapters/anthropic-adapter.js';

const ITINERARY_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Generate a markdown itinerary for an event roster.
 * Pickup-route-and-timing plan keyed off attendee pickup addresses.
 *
 * @param {Object} event           hosted_events row
 * @param {Array}  signups         confirmed event_signups rows
 * @returns {Promise<{ok:boolean, markdown?:string, error?:string}>}
 */
export async function generateItinerary(event, signups) {
  if (!event) return { ok: false, error: 'event required' };
  if (!Array.isArray(signups) || signups.length === 0) {
    return { ok: false, error: 'no confirmed signups to plan around' };
  }

  const system = [
    'You are a logistics coordinator for a paid rideshare driver mentorship session.',
    'Given an event location, time, and a roster of attendees with pickup addresses,',
    'produce a concise pickup-and-route itinerary in markdown.',
    'Sections: Summary, Pickup Order (with proposed pickup times), Route Notes, Contingencies.',
    'Keep it actionable and short — operator will share verbatim with attendees.',
    'Do NOT fabricate distances or drive times; describe order and relative timing only.',
  ].join(' ');

  const user = JSON.stringify({
    event: {
      title: event.title,
      date: event.event_date,
      start_time: event.start_time,
      end_time: event.end_time,
      location_name: event.location_name,
      location_address: event.location_address,
      description: event.description,
    },
    attendees: signups.map(s => ({
      name: s.full_name,
      pickup_address: s.pickup_address || null,
      phone: s.phone || null,
      notes: s.notes || null,
    })),
  }, null, 2);

  const res = await callAnthropic({
    model: ITINERARY_MODEL,
    system,
    user,
    maxTokens: 2048,
    temperature: 0.3,
  });

  if (!res.ok) return { ok: false, error: res.error || 'itinerary call failed' };
  return { ok: true, markdown: res.output };
}
