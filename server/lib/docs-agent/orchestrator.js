import { DocGenerator } from './generator.js';
import { DocValidator } from './validator.js';
import { DocPublisher } from './publisher.js';
import fs from 'fs/promises';
import path from 'path';

// Policy Config
// In a real scenario, read from config/docs-policy.json
const DEFAULT_POLICY = {
  auto_update_enabled: true,
  auto_commit: false // Default to false for safety unless configured
};

/**
 * Docs Orchestrator
 * Manages the "Generate -> Validate -> Publish" pipeline.
 */
export class DocsOrchestrator {
  constructor() {
    this.generator = new DocGenerator();
    this.validator = new DocValidator(DEFAULT_POLICY);
    this.publisher = new DocPublisher(DEFAULT_POLICY);
  }

  /**
   * Main entry point: Process a list of detected file changes.
   * @param {Array<{file: string, status: string}>} changes 
   */
  async processChanges(changes) {
    console.log(`[DocsOrchestrator] Processing ${changes.length} changes...`);
    
    const results = [];

    for (const change of changes) {
      const targetDoc = this.mapFileToDoc(change.file);
      if (!targetDoc) continue;

      console.log(`[DocsOrchestrator] Mapping ${change.file} -> ${targetDoc}`);

      try {
        // 1. Read Contents
        const codeContent = await this.readFileSafe(change.file);
        const docContent = await this.readFileSafe(targetDoc);

        if (!codeContent || !docContent) {
          console.warn(`[DocsOrchestrator] Skipping ${targetDoc} - missing content.`);
          continue;
        }

        // 2. Generate
        console.log(`[DocsOrchestrator] Generating update for ${targetDoc}...`);
        const newContent = await this.generator.generateUpdate(
          change.file, 
          codeContent, 
          docContent, 
          `Code file ${change.file} was ${change.status}`
        );

        if (newContent === 'NO_CHANGE') {
          results.push({ file: targetDoc, status: 'skipped (no change needed)' });
          continue;
        }

        // 3. Validate
        console.log(`[DocsOrchestrator] Validating update...`);
        const validation = await this.validator.validate(newContent);
        if (!validation.valid) {
          console.error(`[DocsOrchestrator] Validation failed for ${targetDoc}:`, validation.errors);
          results.push({ file: targetDoc, status: 'failed validation', errors: validation.errors });
          continue;
        }

        // 4. Publish
        console.log(`[DocsOrchestrator] Publishing to disk...`);
        const publishResult = await this.publisher.publish(targetDoc, newContent);
        
        results.push({ 
          file: targetDoc, 
          status: publishResult.success ? 'updated' : 'failed publish',
          details: publishResult
        });

      } catch (error) {
        console.error(`[DocsOrchestrator] Error processing ${change.file}:`, error);
        results.push({ file: targetDoc, status: 'error', error: error.message });
      }
    }

    return results;
  }

  /**
   * Maps a source code file to its documentation.
   * Simple heuristic mapping.
   */
  mapFileToDoc(filePath) {
    if (filePath.includes('server/api/auth')) return 'docs/architecture/auth-system.md';
    if (filePath.includes('shared/schema.js')) return 'docs/architecture/database-schema.md';
    if (filePath.includes('server/lib/ai/adapters')) return 'docs/architecture/ai-pipeline.md';
    if (filePath.includes('server/lib/strategy')) return 'docs/architecture/strategy-framework.md';
    // Add more mappings as needed
    return null;
  }

  async readFileSafe(filePath) {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (e) {
      return null;
    }
  }
}

// Singleton instance
export const docsOrchestrator = new DocsOrchestrator();
