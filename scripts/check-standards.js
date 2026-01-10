#!/usr/bin/env node
/**
 * Repository Standards Checker
 *
 * Automated enforcement of coding standards defined in docs/architecture/standards.md
 * Run this in CI to block non-compliant code.
 *
 * Usage:
 *   node scripts/check-standards.js           # Run all checks
 *   node scripts/check-standards.js --fix     # Auto-fix where possible
 *   node scripts/check-standards.js --check=duplicates  # Run specific check
 *
 * Exit codes:
 *   0 = All checks passed
 *   1 = Violations found (CI should fail)
 *
 * @see docs/architecture/standards.md
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Directories to scan
  serverDirs: ['server'],
  clientDirs: ['client/src'],
  sharedDirs: ['shared'],

  // File patterns
  jsPattern: /\.(js|mjs|ts|tsx)$/,

  // Exclusions
  excludeDirs: ['node_modules', 'dist', 'build', '.git', '_future'],
  excludeFiles: ['*.test.js', '*.spec.js', '*.d.ts'],

  // Known exceptions (files allowed to bypass certain rules)
  adapterBypassExceptions: [
    'server/lib/ai/adapters/',      // Adapters themselves
    'server/api/chat/realtime.js',  // WebSocket protocol
    'tests/',                        // Test files
    'scripts/test-',                 // Test scripts
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

const violations = [];
let checksRun = 0;
let checksPassed = 0;

function addViolation(check, file, line, message, severity = 'error') {
  violations.push({ check, file, line, message, severity });
}

function log(message, type = 'info') {
  const prefix = {
    info: '\x1b[36mINFO\x1b[0m',
    warn: '\x1b[33mWARN\x1b[0m',
    error: '\x1b[31mERROR\x1b[0m',
    success: '\x1b[32mPASS\x1b[0m',
  }[type] || 'INFO';
  console.log(`[${prefix}] ${message}`);
}

function walkDir(dir, callback, depth = 0) {
  if (depth > 10) return; // Prevent infinite recursion

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(ROOT, fullPath);

    // Skip excluded directories
    if (entry.isDirectory() && CONFIG.excludeDirs.some(ex => entry.name === ex || relativePath.includes(ex))) {
      continue;
    }

    if (entry.isDirectory()) {
      walkDir(fullPath, callback, depth + 1);
    } else if (entry.isFile() && CONFIG.jsPattern.test(entry.name)) {
      // Skip excluded files
      if (CONFIG.excludeFiles.some(pattern => {
        const regex = new RegExp(pattern.replace('*', '.*'));
        return regex.test(entry.name);
      })) {
        continue;
      }
      callback(fullPath, relativePath);
    }
  }
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function isException(filePath, exceptions) {
  const relative = path.relative(ROOT, filePath);
  return exceptions.some(ex => relative.includes(ex) || relative.startsWith(ex));
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 1: Direct LLM API URLs
// ═══════════════════════════════════════════════════════════════════════════

function checkDirectLLMUrls() {
  log('Checking for direct LLM API URLs...');
  checksRun++;

  const patterns = [
    { regex: /api\.openai\.com/g, name: 'OpenAI API' },
    { regex: /generativelanguage\.googleapis\.com/g, name: 'Gemini API' },
    { regex: /api\.anthropic\.com/g, name: 'Anthropic API' },
  ];

  let found = 0;

  for (const dir of CONFIG.serverDirs) {
    const fullDir = path.join(ROOT, dir);
    if (!fs.existsSync(fullDir)) continue;

    walkDir(fullDir, (filePath, relativePath) => {
      // Skip exceptions
      if (isException(filePath, CONFIG.adapterBypassExceptions)) return;

      const content = readFile(filePath);
      if (!content) return;

      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        for (const pattern of patterns) {
          if (pattern.regex.test(line)) {
            // Reset regex lastIndex
            pattern.regex.lastIndex = 0;
            addViolation(
              'direct-llm-url',
              relativePath,
              idx + 1,
              `Direct ${pattern.name} URL found. Use callModel() adapter instead.`
            );
            found++;
          }
        }
      });
    });
  }

  if (found === 0) {
    checksPassed++;
    log('No direct LLM API URLs found outside adapters', 'success');
  } else {
    log(`Found ${found} direct LLM API URL(s)`, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 2: Duplicate Exported Functions
// ═══════════════════════════════════════════════════════════════════════════

function checkDuplicateExports() {
  log('Checking for duplicate exported functions...');
  checksRun++;

  const exports = new Map(); // functionName -> [{ file, line }]

  // Patterns to match exports
  const exportPatterns = [
    /export\s+function\s+(\w+)/g,
    /export\s+const\s+(\w+)\s*=/g,
    /export\s+async\s+function\s+(\w+)/g,
    /export\s*\{\s*(\w+(?:\s*,\s*\w+)*)\s*\}/g,
  ];

  // Known intentional duplicates (barrel exports, re-exports)
  const allowedDuplicates = ['default'];

  for (const dir of [...CONFIG.serverDirs, ...CONFIG.clientDirs, ...CONFIG.sharedDirs]) {
    const fullDir = path.join(ROOT, dir);
    if (!fs.existsSync(fullDir)) continue;

    walkDir(fullDir, (filePath, relativePath) => {
      const content = readFile(filePath);
      if (!content) return;

      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        for (const pattern of exportPatterns) {
          let match;
          pattern.lastIndex = 0;
          while ((match = pattern.exec(line)) !== null) {
            const names = match[1].split(',').map(n => n.trim()).filter(Boolean);
            for (const name of names) {
              if (allowedDuplicates.includes(name)) continue;

              if (!exports.has(name)) {
                exports.set(name, []);
              }
              exports.get(name).push({ file: relativePath, line: idx + 1 });
            }
          }
        }
      });
    });
  }

  // Find duplicates
  let duplicateCount = 0;
  for (const [name, locations] of exports) {
    if (locations.length > 1) {
      // Filter out barrel exports (index.js re-exporting)
      const nonBarrel = locations.filter(loc => !loc.file.endsWith('index.js') && !loc.file.endsWith('index.ts'));
      if (nonBarrel.length > 1) {
        duplicateCount++;
        const files = nonBarrel.map(l => `${l.file}:${l.line}`).join(', ');
        addViolation(
          'duplicate-export',
          nonBarrel[0].file,
          nonBarrel[0].line,
          `Duplicate export '${name}' found in: ${files}`,
          'warning'
        );
      }
    }
  }

  if (duplicateCount === 0) {
    checksPassed++;
    log('No duplicate exported functions found', 'success');
  } else {
    log(`Found ${duplicateCount} duplicate export(s)`, 'warn');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 3: GPS Precision (toFixed)
// ═══════════════════════════════════════════════════════════════════════════

function checkGPSPrecision() {
  log('Checking GPS coordinate precision...');
  checksRun++;

  // Pattern for incorrect precision with coordinates
  const badPrecisionPattern = /\.toFixed\s*\(\s*[45]\s*\)/g;
  const coordContextPattern = /(lat|lng|coord|gps|location)/i;

  let found = 0;

  for (const dir of [...CONFIG.serverDirs, ...CONFIG.clientDirs]) {
    const fullDir = path.join(ROOT, dir);
    if (!fs.existsSync(fullDir)) continue;

    walkDir(fullDir, (filePath, relativePath) => {
      const content = readFile(filePath);
      if (!content) return;

      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (badPrecisionPattern.test(line)) {
          badPrecisionPattern.lastIndex = 0;
          // Check if this line involves coordinates
          if (coordContextPattern.test(line)) {
            addViolation(
              'gps-precision',
              relativePath,
              idx + 1,
              `Incorrect GPS precision. Use toFixed(6) for coordinates (~11cm). Found: ${line.trim()}`
            );
            found++;
          }
        }
      });
    });
  }

  if (found === 0) {
    checksPassed++;
    log('GPS precision is correct (6 decimals)', 'success');
  } else {
    log(`Found ${found} incorrect GPS precision usage(s)`, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 4: Speculative Comments
// ═══════════════════════════════════════════════════════════════════════════

function checkSpeculativeComments() {
  log('Checking for speculative comments...');
  checksRun++;

  // Patterns that indicate speculation
  const speculativePatterns = [
    /\/\/.*\bshould\s+(?:help|improve|fix|cache|work)/i,
    /\/\/.*\bmight\s+(?:help|improve|fix|cache|work)/i,
    /\/\/.*\bprobably\s+(?:will|works|helps)/i,
    /\/\/.*\bmaybe\s+(?:this|we|it)/i,
    /\/\/.*\bI\s+think\s+(?:this|we|it)/i,
  ];

  let found = 0;

  for (const dir of [...CONFIG.serverDirs, ...CONFIG.clientDirs]) {
    const fullDir = path.join(ROOT, dir);
    if (!fs.existsSync(fullDir)) continue;

    walkDir(fullDir, (filePath, relativePath) => {
      const content = readFile(filePath);
      if (!content) return;

      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        for (const pattern of speculativePatterns) {
          if (pattern.test(line)) {
            addViolation(
              'speculative-comment',
              relativePath,
              idx + 1,
              `Speculative comment found. Comments must be truth statements. Found: ${line.trim()}`,
              'warning'
            );
            found++;
            break;
          }
        }
      });
    });
  }

  if (found === 0) {
    checksPassed++;
    log('No speculative comments found', 'success');
  } else {
    log(`Found ${found} speculative comment(s)`, 'warn');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 5: Schema Naming (snake_case)
// ═══════════════════════════════════════════════════════════════════════════

function checkSchemaNaming() {
  log('Checking schema naming conventions...');
  checksRun++;

  const schemaPath = path.join(ROOT, 'shared/schema.js');
  if (!fs.existsSync(schemaPath)) {
    log('Schema file not found, skipping', 'warn');
    return;
  }

  const content = readFile(schemaPath);
  if (!content) return;

  // Pattern for column definitions with camelCase (bad)
  const camelCaseColumn = /(\w+):\s*(?:text|uuid|timestamp|integer|boolean|doublePrecision|varchar|jsonb)\s*\(\s*["']([a-z]+[A-Z][a-zA-Z]*)["']\s*\)/g;

  let found = 0;
  let match;

  while ((match = camelCaseColumn.exec(content)) !== null) {
    const columnName = match[2];
    // Find line number
    const beforeMatch = content.substring(0, match.index);
    const lineNum = beforeMatch.split('\n').length;

    addViolation(
      'schema-naming',
      'shared/schema.js',
      lineNum,
      `Column '${columnName}' uses camelCase. Use snake_case instead.`
    );
    found++;
  }

  if (found === 0) {
    checksPassed++;
    log('Schema naming conventions are correct', 'success');
  } else {
    log(`Found ${found} schema naming violation(s)`, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 6: Country Code Format
// ═══════════════════════════════════════════════════════════════════════════

function checkCountryCodeFormat() {
  log('Checking country code format (ISO 3166-1 alpha-2)...');
  checksRun++;

  // Pattern for country values that are NOT ISO codes
  const badCountryPatterns = [
    /country\s*[:=]\s*['"]USA['"]/gi,
    /country\s*[:=]\s*['"]United States['"]/gi,
    /country\s*[:=]\s*['"]UK['"]/gi,
    /\.country\s*===?\s*['"]USA['"]/gi,
  ];

  let found = 0;

  for (const dir of [...CONFIG.serverDirs, ...CONFIG.clientDirs, ...CONFIG.sharedDirs]) {
    const fullDir = path.join(ROOT, dir);
    if (!fs.existsSync(fullDir)) continue;

    walkDir(fullDir, (filePath, relativePath) => {
      const content = readFile(filePath);
      if (!content) return;

      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        for (const pattern of badCountryPatterns) {
          pattern.lastIndex = 0;
          if (pattern.test(line)) {
            addViolation(
              'country-code-format',
              relativePath,
              idx + 1,
              `Non-ISO country code found. Use ISO 3166-1 alpha-2 (e.g., 'US' not 'USA'). Found: ${line.trim()}`,
              'warning'
            );
            found++;
            break;
          }
        }
      });
    });
  }

  if (found === 0) {
    checksPassed++;
    log('Country code formats are correct', 'success');
  } else {
    log(`Found ${found} non-ISO country code(s)`, 'warn');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

function printReport() {
  console.log('\n' + '═'.repeat(70));
  console.log('STANDARDS CHECK REPORT');
  console.log('═'.repeat(70) + '\n');

  console.log(`Checks run: ${checksRun}`);
  console.log(`Checks passed: ${checksPassed}`);
  console.log(`Total violations: ${violations.length}\n`);

  if (violations.length > 0) {
    // Group by severity
    const errors = violations.filter(v => v.severity === 'error');
    const warnings = violations.filter(v => v.severity === 'warning');

    if (errors.length > 0) {
      console.log('\x1b[31m━━━ ERRORS (CI Blocking) ━━━\x1b[0m\n');
      for (const v of errors) {
        console.log(`  ${v.file}:${v.line}`);
        console.log(`    [${v.check}] ${v.message}\n`);
      }
    }

    if (warnings.length > 0) {
      console.log('\x1b[33m━━━ WARNINGS ━━━\x1b[0m\n');
      for (const v of warnings) {
        console.log(`  ${v.file}:${v.line}`);
        console.log(`    [${v.check}] ${v.message}\n`);
      }
    }
  }

  console.log('═'.repeat(70));

  const hasErrors = violations.some(v => v.severity === 'error');
  if (hasErrors) {
    console.log('\x1b[31m✗ FAILED - Fix errors before merging\x1b[0m');
    return 1;
  } else if (violations.length > 0) {
    console.log('\x1b[33m⚠ PASSED WITH WARNINGS\x1b[0m');
    return 0;
  } else {
    console.log('\x1b[32m✓ ALL CHECKS PASSED\x1b[0m');
    return 0;
  }
}

function main() {
  console.log('\n🔍 Repository Standards Checker');
  console.log('   See docs/architecture/standards.md for rules\n');

  // Parse arguments
  const args = process.argv.slice(2);
  const checkFilter = args.find(a => a.startsWith('--check='))?.split('=')[1];

  // Run checks
  if (!checkFilter || checkFilter === 'llm') checkDirectLLMUrls();
  if (!checkFilter || checkFilter === 'duplicates') checkDuplicateExports();
  if (!checkFilter || checkFilter === 'precision') checkGPSPrecision();
  if (!checkFilter || checkFilter === 'comments') checkSpeculativeComments();
  if (!checkFilter || checkFilter === 'schema') checkSchemaNaming();
  if (!checkFilter || checkFilter === 'country') checkCountryCodeFormat();

  // Print report and exit
  const exitCode = printReport();
  process.exit(exitCode);
}

main();
