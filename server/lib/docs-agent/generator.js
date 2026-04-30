import { callModel } from '../ai/adapters/index.js';

/**
 * Doc Generator Agent
 * Analyzes code changes and updates corresponding documentation.
 */
export class DocGenerator {
  constructor() {
    this.role = 'DOCS_GENERATOR';
  }

  /**
   * Generates updated documentation content based on code changes.
   * @param {string} filePath - Path of the changed code file
   * @param {string} codeContent - New content of the code file
   * @param {string} currentDocContent - Current content of the documentation file
   * @param {string} context - Additional context (e.g., "Added Uber OAuth")
   * @returns {Promise<string>} - Updated documentation content
   */
  async generateUpdate(filePath, codeContent, currentDocContent, context) {
    try {
      const prompt = `
You are the **Doc Generator Agent**, an expert technical writer.
Your task is to update the documentation to align with recent code changes.

**Context:** ${context}
**Changed File:** ${filePath}

**Goal:** 
Update the documentation to accurately reflect the code changes. 
Maintain the existing style, tone, and formatting of the document.
Do NOT remove unrelated sections. Only update or add what is necessary.

**Code Content (Snippet):**
\`\`\`javascript
${codeContent.slice(0, 5000)} ... (truncated if long)
\`\`\`

**Current Documentation:**
\`\`\`markdown
${currentDocContent}
\`\`\`

**Instructions:**
1. Analyze the code changes vs the documentation.
2. If the docs are already up to date, return "NO_CHANGE".
3. If updates are needed, return the **FULL** updated markdown content for the affected section (or the whole file if small).
4. Ensure technical accuracy (e.g., correct API endpoints, table columns).
`;

      const result = await callModel(this.role, {
        system: 'You are a documentation maintenance agent.',
        user: prompt
      });

      if (!result.ok) {
        throw new Error(`Model call failed: ${result.error}`);
      }

      let updatedContent = result.output;

      // Basic cleanup
      if (updatedContent.includes('```markdown')) {
        updatedContent = updatedContent.replace(/```markdown/g, '').replace(/```/g, '').trim();
      }

      return updatedContent;

    } catch (error) {
      console.error('[DocGenerator] Error:', error);
      throw error;
    }
  }
}
