/**
 * Doc Validator Agent
 * Validates documentation quality, formatting, and structural integrity.
 *
 * 2026-02-17: Added content size validation and AI preamble detection.
 * Previous version had no safeguard against complete file overwrites —
 * the generator could replace a 100-line doc with 5 lines of AI commentary.
 */
export class DocValidator {
  constructor(policy) {
    this.policy = policy || {};
  }

  /**
   * Validates the generated documentation.
   * @param {string} content - The markdown content to validate
   * @param {string} [originalContent] - Original file content for size comparison
   * @returns {Object} - { valid: boolean, errors: string[] }
   */
  async validate(content, originalContent) {
    const errors = [];

    // 1. Check for basic Markdown structure
    if (!content || content.trim().length === 0) {
      errors.push('Content is empty');
    }

    if (content === 'NO_CHANGE') {
      return { valid: true, errors: [] };
    }

    // 2. Check for unresolved placeholders
    if (content.includes('TODO:') || content.includes('[insert code]')) {
      errors.push('Contains unresolved placeholders (TODO, [insert code])');
    }

    // 3. Header Hierarchy Check (Basic)
    const lines = content.split('\n');
    let hasH1 = false;
    for (const line of lines) {
      if (line.startsWith('# ')) hasH1 = true;
    }
    // Note: Partial updates might not have H1, so this is a soft check

    // 4. Broken Link Detection (Simple Regex)
    // Matches [text]() empty links
    const emptyLinks = content.match(/\[.*?\]\(\)/g);
    if (emptyLinks) {
      errors.push(`Found ${emptyLinks.length} empty links`);
    }

    // 5. Code Block Closure
    const openBlocks = (content.match(/```/g) || []).length;
    if (openBlocks % 2 !== 0) {
      errors.push('Unclosed code blocks detected');
    }

    // 2026-02-17: FIX - Content size validation (prevents catastrophic overwrites)
    // If the new content is drastically smaller than the original, the AI likely
    // returned a summary/analysis instead of the full updated document.
    // This is what corrupted CLAUDE.md — the generator returned 13 lines to
    // replace a 100+ line project instruction file.
    if (originalContent && originalContent.length > 0) {
      const sizeRatio = content.length / originalContent.length;
      if (sizeRatio < 0.5) {
        errors.push(
          `Content size dropped by ${Math.round((1 - sizeRatio) * 100)}% ` +
          `(${originalContent.length} → ${content.length} chars). ` +
          `Likely a partial/summary response instead of full document update.`
        );
      }
    }

    // 2026-02-17: FIX - Detect AI preamble/commentary mixed into doc content
    // The generator sometimes returns "Based on the code changes..." or
    // "Here is the updated section:" before the actual content.
    const aiPreamblePatterns = [
      /^Based on the code changes/im,
      /^Here is the updated/im,
      /^To update the documentation/im,
      /^I've (updated|analyzed|reviewed)/im,
      /^I (will|need to|should) (update|add|modify)/im,
      /^The (documentation|code|file) (has been|needs|shows)/im,
      /^Let me (update|analyze|review)/im,
    ];
    for (const pattern of aiPreamblePatterns) {
      if (pattern.test(content)) {
        errors.push(
          `Content appears to contain AI commentary instead of documentation. ` +
          `Matched pattern: ${pattern.source}`
        );
        break;
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
