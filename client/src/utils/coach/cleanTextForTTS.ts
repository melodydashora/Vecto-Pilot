/**
 * Strip markdown and bracket-style action tags ([SAVE_NOTE:{...}]) from
 * coach response text so it reads cleanly through TTS. Collapses paragraph
 * breaks to ". " so the synthesizer pauses between thoughts.
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
    .replace(/\n{2,}/g, '. ')                         // Paragraph → pause
    .replace(/\s{2,}/g, ' ')                          // Collapse whitespace
    .trim();
}
