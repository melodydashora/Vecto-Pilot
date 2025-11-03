
/**
 * Duplicate Code Finder with File Age Detection
 * 
 * Scans the repository for duplicate code blocks and reports which files are newest.
 * Helps identify which version of duplicated code is the most recent.
 * 
 * Usage: node scripts/find-duplicate-code.mjs [--min-lines=5]
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// Colors
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";

// Directories to skip
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".replit",
  ".local",
  ".cache",
  ".npm",
  ".config",
  "drizzle/meta"
]);

// File extensions to scan
const SCAN_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx", ".jsx"]);

// Minimum lines to consider as duplicate (configurable)
const MIN_LINES = parseInt(process.argv.find(arg => arg.startsWith("--min-lines="))?.split("=")[1] || "5");

/**
 * Recursively find all code files
 */
async function findCodeFiles(dir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(ROOT_DIR, fullPath);
    
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        await findCodeFiles(fullPath, files);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (SCAN_EXTENSIONS.has(ext)) {
        const stats = await fs.stat(fullPath);
        files.push({
          path: relativePath,
          fullPath,
          mtime: stats.mtime,
          mtimeMs: stats.mtimeMs
        });
      }
    }
  }
  
  return files;
}

/**
 * Extract code blocks from file
 */
async function extractCodeBlocks(filePath, minLines) {
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.split("\n");
  const blocks = [];
  
  for (let i = 0; i <= lines.length - minLines; i++) {
    const block = lines.slice(i, i + minLines).join("\n");
    const normalized = block
      .replace(/\s+/g, " ")
      .trim();
    
    if (normalized.length > 20) { // Skip very short blocks
      const hash = crypto.createHash("md5").update(normalized).digest("hex");
      blocks.push({
        hash,
        startLine: i + 1,
        endLine: i + minLines,
        content: block,
        normalized
      });
    }
  }
  
  return blocks;
}

/**
 * Find duplicates across files
 */
function findDuplicates(fileBlocks) {
  const hashMap = new Map();
  
  // Group blocks by hash
  for (const { file, blocks } of fileBlocks) {
    for (const block of blocks) {
      if (!hashMap.has(block.hash)) {
        hashMap.set(block.hash, []);
      }
      hashMap.get(block.hash).push({
        file: file.path,
        mtime: file.mtime,
        mtimeMs: file.mtimeMs,
        ...block
      });
    }
  }
  
  // Filter to only duplicates (appears in 2+ files)
  const duplicates = [];
  for (const [hash, instances] of hashMap.entries()) {
    const uniqueFiles = new Set(instances.map(i => i.file));
    if (uniqueFiles.size > 1) {
      duplicates.push({
        hash,
        instances: instances.filter((inst, idx, arr) => 
          arr.findIndex(i => i.file === inst.file) === idx
        )
      });
    }
  }
  
  return duplicates;
}

/**
 * Format time difference
 */
function formatTimeDiff(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} min${minutes > 1 ? 's' : ''} ago`;
  return `${seconds} sec ago`;
}

/**
 * Main execution
 */
async function main() {
  console.log("\n" + "=".repeat(70));
  console.log(BOLD + CYAN + "🔍 DUPLICATE CODE FINDER" + RESET);
  console.log("=".repeat(70) + "\n");
  
  console.log(YELLOW + `Scanning for duplicate code blocks (min ${MIN_LINES} lines)...` + RESET);
  
  const codeFiles = await findCodeFiles(ROOT_DIR);
  console.log(`Found ${BOLD}${codeFiles.length}${RESET} code files\n`);
  
  // Extract blocks from each file
  const fileBlocks = [];
  for (const file of codeFiles) {
    process.stdout.write(`Analyzing: ${file.path}...`);
    const blocks = await extractCodeBlocks(file.fullPath, MIN_LINES);
    fileBlocks.push({ file, blocks });
    process.stdout.write(` ${GREEN}✓${RESET} (${blocks.length} blocks)\n`);
  }
  
  // Find duplicates
  console.log(`\n${YELLOW}Finding duplicates...${RESET}\n`);
  const duplicates = findDuplicates(fileBlocks);
  
  // Print results
  console.log("=".repeat(70));
  console.log(BOLD + "📊 DUPLICATE CODE REPORT" + RESET);
  console.log("=".repeat(70) + "\n");
  
  console.log(`Found ${RED}${BOLD}${duplicates.length}${RESET} duplicate code blocks\n`);
  
  if (duplicates.length === 0) {
    console.log(GREEN + BOLD + "✅ NO DUPLICATES FOUND!" + RESET + "\n");
    process.exit(0);
  }
  
  // Sort by number of instances
  duplicates.sort((a, b) => b.instances.length - a.instances.length);
  
  duplicates.forEach((dup, idx) => {
    console.log("─".repeat(70));
    console.log(`${BOLD}Duplicate #${idx + 1}${RESET} - Found in ${MAGENTA}${dup.instances.length} files${RESET}`);
    console.log();
    
    // Sort instances by modification time (newest first)
    const sorted = [...dup.instances].sort((a, b) => b.mtimeMs - a.mtimeMs);
    const newest = sorted[0];
    const now = Date.now();
    
    sorted.forEach((inst, i) => {
      const isNewest = inst.file === newest.file;
      const age = formatTimeDiff(now - inst.mtimeMs);
      const marker = isNewest ? `${GREEN}🆕 NEWEST${RESET}` : `${YELLOW}📅 ${age}${RESET}`;
      
      console.log(`  ${i + 1}. ${marker} ${BOLD}${inst.file}${RESET}`);
      console.log(`     Lines ${inst.startLine}-${inst.endLine}`);
      console.log(`     Modified: ${inst.mtime.toISOString()}`);
    });
    
    console.log();
    console.log(`${CYAN}Code Preview:${RESET}`);
    const preview = sorted[0].content.split("\n").slice(0, 3).join("\n");
    console.log(`${preview.substring(0, 200)}${preview.length > 200 ? "..." : ""}`);
    console.log();
  });
  
  console.log("=".repeat(70));
  console.log(BOLD + "💡 RECOMMENDATIONS" + RESET);
  console.log("=".repeat(70) + "\n");
  console.log("1. Review each duplicate and decide which version to keep");
  console.log("2. The 🆕 NEWEST file is typically the most up-to-date");
  console.log("3. Consider extracting duplicates into shared utilities");
  console.log("4. Check if older files need updates from newer versions\n");
  
  process.exit(duplicates.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(RED + "Fatal error:" + RESET, err.message);
  process.exit(1);
});
