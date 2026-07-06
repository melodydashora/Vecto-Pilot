// 2026-07-06: Holiday moved OFF the snapshot into the briefing pipeline
// (Melody's direction — todo #21). The snapshot stays purely deterministic
// (GPS → Google APIs); holiday is LLM-involved (BRIEFING_HOLIDAY role for
// non-static dates), so it belongs here with the other model-backed sections.
// A model outage now degrades this section with a recorded reason instead of
// blocking snapshot creation/login.
//
// Owns: holiday section of the briefings row + briefing_holiday_ready channel.
//
// Section shape (briefings.holiday, jsonb):
//   success: { holiday: string, is_holiday: boolean, detectedAt: iso }
//            — holiday 'none' means VERIFIED not-a-holiday (detector doctrine)
//   failure: errorMarker → { _generationFailed: true, error, failedAt }
//            — never a fabricated 'none'; the reason is the record
//
// Detection input is the COMPLETE snapshot row (per the waterfall rule:
// "once it is done, the snapshot row is sent with all calls after it").
//
// Logging tag: [BRIEFING][HOLIDAY]

import { detectHoliday } from '../../location/holiday-detector.js';
import { writeSectionAndNotify, CHANNELS, errorMarker } from '../briefing-notify.js';

/**
 * Pipeline contract: detect holiday context for a snapshot.
 *
 * Calls the hardened detector (static calendar → override config →
 * BRIEFING_HOLIDAY role; throws HolidayDetectionError on any failure — no
 * silent 'none'), writes the holiday section, fires CHANNELS.HOLIDAY,
 * returns { holiday, reason }.
 *
 * IMPORTANT (Melody, 2026-07-06): the progressive write below is the lossy
 * streaming channel — the aggregator's final atomic write MUST also include
 * this section (it does; see briefingData.holiday in briefing-aggregator.js).
 * Data must never exist only in the swallowed-error channel.
 *
 * @param {object} args
 * @param {object} args.snapshot - COMPLETE snapshot row (all fields populated)
 * @param {string} args.snapshotId - snapshot UUID
 * @returns {Promise<{ holiday: object, reason: string|null }>}
 */
export async function discoverHoliday({ snapshot, snapshotId }) {
  let holiday;
  let reason = null;

  try {
    const result = await detectHoliday({
      created_at: snapshot.created_at,
      city: snapshot.city,
      state: snapshot.state,
      country: snapshot.country,
      timezone: snapshot.timezone,
      formattedAddress: snapshot.formatted_address,
      lat: snapshot.lat,
      lng: snapshot.lng,
    });
    holiday = { ...result, detectedAt: new Date().toISOString() };
    await writeSectionAndNotify(snapshotId, { holiday }, CHANNELS.HOLIDAY);
  } catch (err) {
    holiday = errorMarker(err);
    reason = err.message;
    await writeSectionAndNotify(snapshotId, { holiday }, CHANNELS.HOLIDAY);
    throw err;
  }

  return { holiday, reason };
}
