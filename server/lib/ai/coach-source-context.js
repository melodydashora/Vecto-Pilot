// Full saved source records travel together. Missing/error is not empty success,
// and a completed historical record is not automatically current information.
export function formatCoachSourceContext(snapshot, briefing) {
  const record = briefing?.source_record ?? briefing ?? null;
  return `\n\n=== SAVED SNAPSHOT AND COMPLETE BRIEFING RECORD ===
These are saved observations, not a fresh live lookup. Use snapshot timestamps,
briefing generated_at/updated_at and each section's source/error markers to state
what is known. Pending, missing, failed or partial sections must be described as
such, never as clear conditions or a fresh complete briefing. You may discuss
available saved data while generation continues; distinguish it from new results.
${JSON.stringify({ snapshot: snapshot ?? null, briefing: record }, null, 2)}
=== END SAVED SOURCE RECORDS ===`;
}
