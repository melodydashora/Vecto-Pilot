/**
 * Doc Validator Agent
 * Validates documentation quality, formatting, and structural integrity.
 */
export class DocValidator {
  constructor(policy) {
    this.policy = policy || {};
  }

  /**
   * Validates the generated documentation.
   * @param {string} content - The markdown content to validate
   * @returns {Object} - { valid: boolean, errors: string[] }
   */
  async validate(content) {
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

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
