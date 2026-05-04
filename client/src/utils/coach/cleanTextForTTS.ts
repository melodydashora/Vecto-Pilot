/**
 * Strip markdown and bracket-style action tags ([SAVE_NOTE:{...}]) from
 * coach response text so it reads cleanly through TTS.
 *
 * 2026-05-04 (COACH-V1): paragraph breaks now become a comma-space (", ")
 * instead of period-space (". "). The period was producing a long sentence-
 * ending pause between paragraphs; in hands-free driving mode, that pause
 * felt sluggish. Comma keeps a small break but lets the next thought flow.
 *
 * Pure function — no DOM, no side effects, no React. Safe to import in
 * hooks, workers, and tests.
 */
export function cleanTextForTTS(text: string): string {
  return text
    .replace(/\[[\w_]+:\s*\{[\s\S]*?\}\s*\]/g, '')   // Action tags [SAVE_NOTE: {...}]
    .replace(/\*\*([^*]+)\*\*/g, '$1')                // Markdown bold
    .replace(/\*([^*]+)\*/g, '$1')                    // Markdown italic
    .replace(/```[\s\S]*?```/g, '')                   // Code blocks
    .replace(/`([^`]+)`/g, '$1')                      // Inline code
    .replace(/#{1,6}\s/g, '')                         // Headers
    .replace(/\n{2,}/g, ', ')                         // Paragraph → soft comma pause (COACH-V1)
    .replace(/\s{2,}/g, ' ')                          // Collapse whitespace
    .trim();
}
