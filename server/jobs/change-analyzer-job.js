/**
 * Change Analyzer Job
 *
 * Runs on server startup to detect repo changes and flag documentation
 * that may need updating. Outputs to docs/review-queue/.
 *
 * Usage:
 *   - Automatically runs on server startup (unless RUN_CHANGE_ANALYZER=false)
 *   - Can be triggered manually via MCP tool: analyze_changes
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { findAffectedDocs, categorizeGitStatus } from '../lib/change-analyzer/file-doc-mapping.js';

const execAsync = promisify(exec);

// Configuration
const REPO_ROOT = process.env.REPO_ROOT || process.cwd();
const REVIEW_QUEUE_DIR = path.join(REPO_ROOT, 'docs/review-queue');
const COMMITS_TO_ANALYZE = parseInt(process.env.CHANGE_ANALYZER_COMMITS || '5', 10);

let isRunning = false;
let lastAnalysisTime = null;

/**
 * Check if we're in a git repository
 */
async function isGitRepo() {
  try {
    await fs.access(path.join(REPO_ROOT, '.git'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Main analysis function
 * @returns {Object} Analysis results
 */
export async function runAnalysis() {
  if (isRunning) {
    console.log('[ChangeAnalyzer] Analysis already running, skipping...');
    return { skipped: true, reason: 'Already running' };
  }

  // Skip in non-git environments (e.g., production deployments)
  const hasGit = await isGitRepo();
  if (!hasGit) {
    console.log('[ChangeAnalyzer] Skipped - not a git repository (production deployment)');
    return { skipped: true, reason: 'Not a git repository' };
  }

  isRunning = true;
  const startTime = Date.now();

  try {
    console.log('[ChangeAnalyzer] Starting analysis...');

    // Gather git information
    const [uncommittedChanges, recentCommits, currentBranch, lastCommit] = await Promise.all([
      getUncommittedChanges(),
      getRecentCommitChanges(),
      getCurrentBranch(),
      getLastCommit()
    ]);

    // Combine all changes
    const allChanges = [...uncommittedChanges, ...recentCommits];

    // Map to affected documentation
    const docImpacts = analyzeDocImpact(allChanges);

    // Generate report
    const report = generateReport({
      uncommittedChanges,
      recentCommits,
      docImpacts,
      branch: currentBranch,
      lastCommit,
      timestamp: new Date().toISOString()
    });

    // Write to review queue
    await writeToReviewQueue(report);

    lastAnalysisTime = new Date();
    const duration = Date.now() - startTime;

    console.log(`[ChangeAnalyzer] ✅ Complete (${duration}ms) - ${allChanges.length} changes, ${docImpacts.high.length} high priority`);

    return {
      success: true,
      changesFound: allChanges.length,
      highPriority: docImpacts.high.length,
      mediumPriority: docImpacts.medium.length,
      lowPriority: docImpacts.low.length,
      duration
    };

  } catch (err) {
    console.error('[ChangeAnalyzer] ❌ Error:', err.message);
    return { success: false, error: err.message };
  } finally {
    isRunning = false;
  }
}

/**
 * Get uncommitted changes (staged + unstaged)
 */
async function getUncommittedChanges() {
  try {
    const { stdout } = await execAsync('git status --porcelain', { cwd: REPO_ROOT });
    if (!stdout.trim()) return [];

    return stdout.trim().split('\n').map(line => ({
      status: categorizeGitStatus(line.substring(0, 2)),
      file: line.substring(3).trim(),
      type: 'uncommitted'
    }));
  } catch (err) {
    console.warn('[ChangeAnalyzer] Could not get uncommitted changes:', err.message);
    return [];
  }
}

/**
 * Get changes from recent commits
 */
async function getRecentCommitChanges() {
  try {
    const { stdout } = await execAsync(
      `git diff --name-status HEAD~${COMMITS_TO_ANALYZE}..HEAD 2>/dev/null || git diff --name-status $(git rev-list --max-parents=0 HEAD)..HEAD`,
      { cwd: REPO_ROOT }
    );
    if (!stdout.trim()) return [];

    return stdout.trim().split('\n').map(line => {
      const parts = line.split('\t');
      return {
        status: categorizeGitStatus(parts[0]),
        file: parts[1] || parts[0],
        type: 'committed'
      };
    });
  } catch (err) {
    console.warn('[ChangeAnalyzer] Could not get recent commits:', err.message);
    return [];
  }
}

/**
 * Get current branch name
 */
async function getCurrentBranch() {
  try {
    const { stdout } = await execAsync('git branch --show-current', { cwd: REPO_ROOT });
    return stdout.trim();
  } catch (err) {
    return 'unknown';
  }
}

/**
 * Get last commit info
 */
async function getLastCommit() {
  try {
    const { stdout } = await execAsync('git log -1 --format="%h %s"', { cwd: REPO_ROOT });
    return stdout.trim();
  } catch (err) {
    return 'unknown';
  }
}

/**
 * Analyze documentation impact of changes
 */
function analyzeDocImpact(changes) {
  const impacts = { high: [], medium: [], low: [] };
  const seenDocs = new Set();

  for (const change of changes) {
    const { docs, priority, reason } = findAffectedDocs(change.file);

    for (const doc of docs) {
      if (seenDocs.has(doc)) continue;
      seenDocs.add(doc);

      impacts[priority].push({
        doc,
        reason,
        triggeredBy: change.file,
        changeType: change.status
      });
    }

    // Also flag if file itself has no doc mapping but is significant
    if (docs.length === 0 && change.status === 'Added' && !change.file.endsWith('.md')) {
      impacts.low.push({
        doc: 'Consider adding documentation',
        reason: 'New file added',
        triggeredBy: change.file,
        changeType: change.status
      });
    }
  }

  return impacts;
}

/**
 * Generate markdown report
 */
function generateReport({ uncommittedChanges, recentCommits, docImpacts, branch, lastCommit, timestamp }) {
  const date = new Date().toISOString().split('T')[0];
  const hasImpacts = docImpacts.high.length > 0 || docImpacts.medium.length > 0;

  let report = `## ${date} Analysis

**Generated:** ${timestamp}
**Branch:** ${branch}
**Last Commit:** ${lastCommit}

`;

  // Changes summary
  if (uncommittedChanges.length > 0) {
    report += `### Uncommitted Changes (${uncommittedChanges.length})
| File | Status |
|------|--------|
`;
    for (const change of uncommittedChanges.slice(0, 20)) {
      report += `| \`${change.file}\` | ${change.status} |\n`;
    }
    if (uncommittedChanges.length > 20) {
      report += `| ... and ${uncommittedChanges.length - 20} more | |\n`;
    }
    report += '\n';
  }

  if (recentCommits.length > 0) {
    report += `### Recent Commit Changes (${recentCommits.length})
| File | Status |
|------|--------|
`;
    for (const change of recentCommits.slice(0, 20)) {
      report += `| \`${change.file}\` | ${change.status} |\n`;
    }
    if (recentCommits.length > 20) {
      report += `| ... and ${recentCommits.length - 20} more | |\n`;
    }
    report += '\n';
  }

  // Documentation impact
  if (hasImpacts) {
    report += `### Documentation Review Needed

`;
    if (docImpacts.high.length > 0) {
      report += `#### High Priority
`;
      for (const impact of docImpacts.high) {
        report += `- [ ] \`${impact.doc}\` - ${impact.reason} (${impact.triggeredBy})\n`;
      }
      report += '\n';
    }

    if (docImpacts.medium.length > 0) {
      report += `#### Medium Priority
`;
      for (const impact of docImpacts.medium) {
        report += `- [ ] \`${impact.doc}\` - ${impact.reason} (${impact.triggeredBy})\n`;
      }
      report += '\n';
    }

    if (docImpacts.low.length > 0) {
      report += `#### Low Priority
`;
      for (const impact of docImpacts.low) {
        report += `- [ ] ${impact.doc} - ${impact.reason} (${impact.triggeredBy})\n`;
      }
      report += '\n';
    }
  } else {
    report += `### Documentation Review Needed

No documentation impacts detected.

`;
  }

  report += `### Status: PENDING

---

`;

  return report;
}

/**
 * Write report to review queue files
 */
async function writeToReviewQueue(report) {
  const date = new Date().toISOString().split('T')[0];

  // Ensure directory exists
  await fs.mkdir(REVIEW_QUEUE_DIR, { recursive: true });

  // Append to daily log
  const dailyLogPath = path.join(REVIEW_QUEUE_DIR, `${date}.md`);
  const dailyHeader = `# Change Analysis - ${date}\n\n`;

  try {
    await fs.access(dailyLogPath);
    // File exists, append
    await fs.appendFile(dailyLogPath, report);
  } catch {
    // File doesn't exist, create with header
    await fs.writeFile(dailyLogPath, dailyHeader + report);
  }

  // Update pending.md
  const pendingPath = path.join(REVIEW_QUEUE_DIR, 'pending.md');
  let pendingContent;

  try {
    pendingContent = await fs.readFile(pendingPath, 'utf-8');
  } catch {
    pendingContent = `# Pending Documentation Review

Items flagged by the Change Analyzer for human-AI validation.

---

`;
  }

  // Remove the "no pending items" message if present
  pendingContent = pendingContent.replace(
    /\*No pending items\. The Change Analyzer will append findings here on server startup\.\*\n+---/,
    '---'
  );

  // Append new report before the last ---
  const lastDividerIndex = pendingContent.lastIndexOf('---');
  if (lastDividerIndex > 0) {
    pendingContent = pendingContent.slice(0, lastDividerIndex) + report + '---\n';
  } else {
    pendingContent += report;
  }

  await fs.writeFile(pendingPath, pendingContent);

  console.log(`[ChangeAnalyzer] Written to ${dailyLogPath} and pending.md`);
}

/**
 * Start the change analyzer job
 * @returns {Object} { runNow: Function, stop: Function }
 */
export function startChangeAnalyzerJob() {
  console.log('[ChangeAnalyzer] Initializing...');

  // Check if enabled (default: true)
  const enabled = process.env.RUN_CHANGE_ANALYZER !== 'false';

  if (!enabled) {
    console.log('[ChangeAnalyzer] Disabled via RUN_CHANGE_ANALYZER=false');
    return {
      runNow: runAnalysis,
      stop: () => {}
    };
  }

  // Run initial analysis after a short delay (let server finish starting)
  const initialTimer = setTimeout(() => {
    runAnalysis().catch(err => {
      console.error('[ChangeAnalyzer] Initial analysis failed:', err.message);
    });
  }, 3000);

  return {
    runNow: runAnalysis,
    stop: () => {
      clearTimeout(initialTimer);
      console.log('[ChangeAnalyzer] Stopped');
    }
  };
}

export default {
  runAnalysis,
  startChangeAnalyzerJob
};
