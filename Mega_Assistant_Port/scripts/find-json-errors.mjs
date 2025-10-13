#!/usr/bin/env node
/**
 * JSON Error Scanner
 * 
 * Scans the entire repository for JSON syntax errors and validates all .json files.
 * Reports any malformed JSON with line numbers and error details.
 * 
 * Usage: node scripts/find-json-errors.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  ".config"
]);

// Results tracking
const results = {
  total: 0,
  valid: 0,
  errors: [],
  warnings: []
};

/**
 * Recursively find all .json files
 */
async function findJsonFiles(dir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(ROOT_DIR, fullPath);
    
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        await findJsonFiles(fullPath, files);
      }
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(relativePath);
    }
  }
  
  return files;
}

/**
 * Validate a single JSON file
 */
async function validateJsonFile(filePath) {
  const fullPath = path.join(ROOT_DIR, filePath);
  
  try {
    const content = await fs.readFile(fullPath, "utf8");
    
    // Check for empty files
    if (!content.trim()) {
      results.warnings.push({
        file: filePath,
        issue: "Empty file",
        type: "warning"
      });
      return { valid: true, warning: true };
    }
    
    // Try to parse JSON
    JSON.parse(content);
    results.valid++;
    return { valid: true };
    
  } catch (err) {
    // Parse error details
    let lineNumber = "unknown";
    let column = "unknown";
    
    const match = err.message.match(/position (\d+)/);
    if (match) {
      const position = parseInt(match[1]);
      const lines = (await fs.readFile(fullPath, "utf8")).substring(0, position).split("\n");
      lineNumber = lines.length;
      column = lines[lines.length - 1].length + 1;
    }
    
    results.errors.push({
      file: filePath,
      error: err.message,
      line: lineNumber,
      column: column
    });
    
    return { valid: false, error: err.message };
  }
}

/**
 * Main execution
 */
async function main() {
  console.log("\n" + "=".repeat(70));
  console.log(BOLD + CYAN + "🔍 JSON ERROR SCANNER" + RESET);
  console.log("=".repeat(70) + "\n");
  
  console.log(YELLOW + "Scanning repository for JSON files..." + RESET);
  
  const jsonFiles = await findJsonFiles(ROOT_DIR);
  results.total = jsonFiles.length;
  
  console.log(`Found ${BOLD}${jsonFiles.length}${RESET} JSON files\n`);
  
  // Validate each file
  for (const file of jsonFiles) {
    process.stdout.write(`Validating: ${file}...`);
    const result = await validateJsonFile(file);
    
    if (result.valid && !result.warning) {
      process.stdout.write(` ${GREEN}✓${RESET}\n`);
    } else if (result.warning) {
      process.stdout.write(` ${YELLOW}⚠${RESET}\n`);
    } else {
      process.stdout.write(` ${RED}✗${RESET}\n`);
    }
  }
  
  // Print summary
  console.log("\n" + "=".repeat(70));
  console.log(BOLD + "📊 RESULTS SUMMARY" + RESET);
  console.log("=".repeat(70) + "\n");
  
  console.log(`Total files scanned:  ${BOLD}${results.total}${RESET}`);
  console.log(`Valid JSON files:     ${GREEN}${BOLD}${results.valid}${RESET}`);
  console.log(`Files with errors:    ${results.errors.length > 0 ? RED : GREEN}${BOLD}${results.errors.length}${RESET}`);
  console.log(`Files with warnings:  ${results.warnings.length > 0 ? YELLOW : GREEN}${BOLD}${results.warnings.length}${RESET}`);
  console.log();
  
  // Print errors
  if (results.errors.length > 0) {
    console.log("=".repeat(70));
    console.log(BOLD + RED + "❌ JSON SYNTAX ERRORS FOUND" + RESET);
    console.log("=".repeat(70) + "\n");
    
    results.errors.forEach((err, idx) => {
      console.log(`${BOLD}${idx + 1}. ${err.file}${RESET}`);
      console.log(`   ${RED}Error:${RESET} ${err.error}`);
      console.log(`   ${YELLOW}Location:${RESET} Line ${err.line}, Column ${err.column}`);
      console.log();
    });
  }
  
  // Print warnings
  if (results.warnings.length > 0) {
    console.log("=".repeat(70));
    console.log(BOLD + YELLOW + "⚠️  WARNINGS" + RESET);
    console.log("=".repeat(70) + "\n");
    
    results.warnings.forEach((warn, idx) => {
      console.log(`${BOLD}${idx + 1}. ${warn.file}${RESET}`);
      console.log(`   ${YELLOW}Issue:${RESET} ${warn.issue}`);
      console.log();
    });
  }
  
  // Final status
  if (results.errors.length === 0 && results.warnings.length === 0) {
    console.log("=".repeat(70));
    console.log(GREEN + BOLD + "✅ ALL JSON FILES ARE VALID!" + RESET);
    console.log("=".repeat(70) + "\n");
    process.exit(0);
  } else if (results.errors.length === 0) {
    console.log("=".repeat(70));
    console.log(YELLOW + BOLD + "⚠️  NO ERRORS, BUT SOME WARNINGS FOUND" + RESET);
    console.log("=".repeat(70) + "\n");
    process.exit(0);
  } else {
    console.log("=".repeat(70));
    console.log(RED + BOLD + `❌ FOUND ${results.errors.length} JSON ERROR(S)` + RESET);
    console.log("=".repeat(70) + "\n");
    process.exit(1);
  }
}

main().catch(err => {
  console.error(RED + "Fatal error:" + RESET, err.message);
  process.exit(1);
});
