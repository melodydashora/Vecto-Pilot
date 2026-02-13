import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

/**
 * Doc Publisher Agent
 * Handles file writing and version control integration.
 */
export class DocPublisher {
  constructor(config) {
    this.config = config || {};
    this.gitUser = this.config.git_user || 'Gemini Docs Agent';
    this.gitEmail = this.config.git_email || 'agent@internal';
  }

  /**
   * Publishes the validated documentation to the file system.
   * @param {string} filePath - Target file path
   * @param {string} content - Final content to write
   * @returns {Promise<Object>} - { success: boolean, commitHash: string }
   */
  async publish(filePath, content) {
    if (content === 'NO_CHANGE') {
      return { success: true, action: 'skipped' };
    }

    try {
      // 1. Create backup (Rollback mechanism)
      const backupPath = `${filePath}.bak`;
      try {
        await fs.copyFile(filePath, backupPath);
      } catch (e) {
        // File might not exist yet, ignore
      }

      // 2. Write new content
      await fs.writeFile(filePath, content, 'utf8');

      // 3. Git Commit (if enabled)
      let commitHash = null;
      if (this.config.auto_commit) {
        commitHash = await this.commitChanges(filePath);
      }

      // 4. Cleanup backup
      try {
        await fs.unlink(backupPath);
      } catch (e) {
        // 2026-02-12: Log backup cleanup failures (previously silent)
        console.warn(`[DocPublisher] Failed to cleanup backup ${backupPath}: ${e.message}`);
      }

      return { success: true, action: 'updated', commitHash };

    } catch (error) {
      console.error('[DocPublisher] Error publishing:', error);
      
      // Rollback
      try {
        await fs.copyFile(`${filePath}.bak`, filePath);
        console.log('[DocPublisher] Rolled back changes to', filePath);
      } catch (rollbackError) {
        console.error('[DocPublisher] Rollback failed:', rollbackError);
      }

      return { success: false, error: error.message };
    }
  }

  async commitChanges(filePath) {
    try {
      // Configure local git identity if needed (ephemeral)
      // await execPromise(`git config user.name "${this.gitUser}"`);
      // await execPromise(`git config user.email "${this.gitEmail}"`);

      await execPromise(`git add "${filePath}"`);
      const msg = `docs(auto): Update ${path.basename(filePath)} to align with code changes`;
      await execPromise(`git commit -m "${msg}"`);
      
      const { stdout } = await execPromise('git rev-parse --short HEAD');
      return stdout.trim();
    } catch (error) {
      console.warn('[DocPublisher] Git commit failed (likely no changes or auth issue):', error.message);
      return null;
    }
  }
}
