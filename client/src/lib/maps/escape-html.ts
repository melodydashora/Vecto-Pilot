// 2026-04-26 PHASE A: HTML-escape helper for Google Maps InfoWindow content.
//
// google.maps.InfoWindow.setContent() accepts raw HTML, so any string that
// originated from user input, an AI response, an external API, or any path
// outside our own static literals must be escaped before interpolation.
// This helper was lifted from the (now-deleted) ConciergeMap.tsx 2026-04-10
// X-1 fix and applies to all map InfoWindow content, not only AI strings.

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
