// server/lib/docs-agent/orchestrator.js
// Manages the "Generate -> Validate -> Publish" pipeline for autonomous doc updates.
//
// 2026-02-15: Fixed by Claude Opus 4.6 — 4 critical bugs:
//   1. mapFileToDoc() only had 4 hardcoded entries (now uses FILE_TO_DOC_MAP from change-analyzer)
//   2. config/docs-policy.json was never loaded (now loaded at init)
//   3. File paths were relative but fs.readFile needs absolute (now resolved against REPO_ROOT)
//   4. No deduplication — same doc could be updated multiple times per run (now deduped)

import { DocGenerator } from './generator.js';
import { DocValidator } from './validator.js';
import { DocPublisher } from './publisher.js';
import { findAffectedDocs } from '../change-analyzer/file-doc-mapping.js';
import fs from 'fs/promises';
import path from 'path';

const REPO_ROOT = process.env.REPO_ROOT || process.cwd();

/**
 * Load policy config from config/docs-policy.json
 * Falls back to safe defaults if file is missing
 */
async function loadPolicy() {
  const policyPath = path.join(REPO_ROOT, 'config', 'docs-policy.json');
  try {
    const raw = await fs.readFile(policyPath, 'utf8');
    const policy = JSON.parse(raw);
    console.log('[DocsOrchestrator] Loaded policy from config/docs-policy.json');
    return {
      auto_update_enabled: policy.auto_update_enabled ?? true,
      auto_commit: policy.agents?.publisher?.create_branch === false && false, // Never auto-commit by default
      git_user: policy.agents?.publisher?.git_user || 'Gemini Docs Agent',
      git_email: policy.agents?.publisher?.git_email || 'agent@internal',
      confidence_threshold: 0.85,
      rules: policy.rules || []
    };
  } catch (e) {
    console.warn('[DocsOrchestrator] Could not load docs-policy.json, using defaults:', e.message);
    return {
      auto_update_enabled: true,
      auto_commit: false,
      confidence_threshold: 0.85,
      rules: []
    };
  }
}

/**
 * Docs Orchestrator
 * Manages the "Generate -> Validate -> Publish" pipeline.
 */
export class DocsOrchestrator {
  constructor() {
    this.generator = new DocGenerator();
    this.validator = null;
    this.publisher = null;
    this._initialized = false;
  }

  /**
   * Lazy initialization — loads policy config on first use
   */
  async _ensureInitialized() {
    if (this._initialized) return;
    const policy = await loadPolicy();
    this.validator = new DocValidator(policy);
    this.publisher = new DocPublisher(policy);
    this._initialized = true;
  }

  /**
   * Main entry point: Process a list of detected file changes.
   * @param {Array<{file: string, status: string}>} changes
   * @returns {Array<{file: string, status: string, details?: any}>}
   */
  async processChanges(changes) {
    await this._ensureInitialized();
    console.log(`[DocsOrchestrator] Processing ${changes.length} changes...`);

    // 2026-02-15: Deduplicate — collect unique doc targets across all changes
    const docTargets = new Map(); // targetDoc -> { triggeredBy: string[], status: string }

    for (const change of changes) {
      const targetDocs = this.mapFileToDoc(change.file);
      for (const targetDoc of targetDocs) {
        if (!docTargets.has(targetDoc)) {
          docTargets.set(targetDoc, { triggeredBy: [], status: change.status });
        }
        docTargets.get(targetDoc).triggeredBy.push(change.file);
      }
    }

    console.log(`[DocsOrchestrator] ${docTargets.size} unique docs to update from ${changes.length} changes`);

    const results = [];

    for (const [targetDoc, meta] of docTargets) {
      console.log(`[DocsOrchestrator] Processing ${targetDoc} (triggered by ${meta.triggeredBy.length} files)`);

      try {
        // 1. Read the first triggering code file + the doc (use absolute paths)
        const codeFilePath = path.resolve(REPO_ROOT, meta.triggeredBy[0]);
        const docFilePath = path.resolve(REPO_ROOT, targetDoc);

        const codeContent = await this.readFileSafe(codeFilePath);
        const docContent = await this.readFileSafe(docFilePath);

        if (!codeContent) {
          console.warn(`[DocsOrchestrator] Skipping ${targetDoc} - code file unreadable: ${codeFilePath}`);
          results.push({ file: targetDoc, status: 'skipped (code unreadable)' });
          continue;
        }

        if (!docContent) {
          console.warn(`[DocsOrchestrator] Skipping ${targetDoc} - doc file unreadable: ${docFilePath}`);
          results.push({ file: targetDoc, status: 'skipped (doc unreadable)' });
          continue;
        }

        // 2. Generate updated doc content
        const context = `Files changed: ${meta.triggeredBy.join(', ')} (${meta.status})`;
        console.log(`[DocsOrchestrator] Generating update for ${targetDoc}...`);
        const newContent = await this.generator.generateUpdate(
          meta.triggeredBy[0],
          codeContent,
          docContent,
          context
        );

        if (newContent === 'NO_CHANGE') {
          results.push({ file: targetDoc, status: 'skipped (no change needed)' });
          continue;
        }

        // 3. Validate
        console.log(`[DocsOrchestrator] Validating update for ${targetDoc}...`);
        const validation = await this.validator.validate(newContent);
        if (!validation.valid) {
          console.error(`[DocsOrchestrator] Validation failed for ${targetDoc}:`, validation.errors);
          results.push({ file: targetDoc, status: 'failed validation', errors: validation.errors });
          continue;
        }

        // 4. Publish (write to disk)
        console.log(`[DocsOrchestrator] Publishing ${targetDoc}...`);
        const publishResult = await this.publisher.publish(docFilePath, newContent);

        results.push({
          file: targetDoc,
          status: publishResult.success ? 'updated' : 'failed publish',
          triggeredBy: meta.triggeredBy,
          details: publishResult
        });

      } catch (error) {
        console.error(`[DocsOrchestrator] Error processing ${targetDoc}:`, error.message);
        results.push({ file: targetDoc, status: 'error', error: error.message });
      }
    }

    const updated = results.filter(r => r.status === 'updated').length;
    const skipped = results.filter(r => r.status.startsWith('skipped')).length;
    const failed = results.filter(r => r.status === 'error' || r.status.includes('failed')).length;
    console.log(`[DocsOrchestrator] Done: ${updated} updated, ${skipped} skipped, ${failed} failed`);

    return results;
  }

  /**
   * Maps a source code file to its target documentation files.
   * Uses the comprehensive FILE_TO_DOC_MAP from the change-analyzer.
   *
   * 2026-02-15: Replaced 4 hardcoded entries with the shared mapping table (30+ entries).
   *
   * @param {string} filePath - Relative path of the changed file
   * @returns {string[]} - Array of target doc paths (may be empty)
   */
  mapFileToDoc(filePath) {
    const { docs } = findAffectedDocs(filePath);
    return docs;
  }

  /**
   * Read a file safely, returning null on failure.
   * @param {string} filePath - Absolute path to read
   * @returns {Promise<string|null>}
   */
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
