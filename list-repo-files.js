#!/usr/bin/env node

/**
 * Repository File Lister
 * Lists all files grouped by type with schema, API call, and console.log analysis
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, relative, extname, basename, dirname } from 'path';
import { existsSync } from 'fs';

const REPO_ROOT = process.cwd();

// Workflow subcategories in order of event flow
const WORKFLOW_SUBCATEGORIES = {
  '1. Entry Points': [], // Only exact matches - handled specially below
  '2. Bootstrap & Init': ['bootstrap/', 'server/bootstrap'],
  '3. Middleware': ['middleware/'],
  '4. Routes & API': ['routes/', 'server/routes'],
  '5. Core Logic': ['server/lib/', 'lib/'],
  '6. LLM Adapters': ['adapters/', 'llm-router', 'anthropic', 'openai', 'gemini'],
  '7. Database': ['server/db/', 'db/', 'drizzle/', 'migrations/'],
  '8. Background Jobs': ['jobs/', 'worker', 'queue'],
  '9. Eidolon SDK': ['eidolon/', 'server/eidolon'],
  '10. Gateway': ['gateway/', 'server/gateway'],
  '11. Scripts & Utils': ['scripts/', 'server/scripts'],
  '12. Shared': ['shared/'],
  '13. Other Workflow': []  // catch-all for workflow
};

// True server entry points (files that create HTTP servers/listen on ports)
const TRUE_ENTRY_POINTS = [
  'gateway-server.js',
  'agent-server.js',
  'index.js'  // root index.js only, not nested ones
];

// Files/patterns that are part of the active workflow
const ACTIVE_WORKFLOW_PATTERNS = [
  'gateway-server.js',
  'agent-server.js',
  'index.js',
  'server/',
  'client/src/',
  'shared/',
  'drizzle.config.js',
  'package.json',
  'tsconfig.json',
  'vite.config.js',
  '.replit',
  '.env',
];

// Patterns to exclude (only truly non-useful)
const EXCLUDE_PATTERNS = [
  'node_modules',
  '.git',
];

// Category definitions
const CATEGORIES = {
  config: [
    '.json', '.config.js', '.config.ts', 'tsconfig', '.env', '.replit',
    'tailwind.config', 'postcss.config', 'vite.config', 'drizzle.config',
    '.config/', 'config/', '.claude/'
  ],
  tests: ['test', 'spec', '__tests__', 'tests/'],
  workflow: [
    'server/', 'gateway-server', 'agent-server', 'index.js',
    'routes/', 'middleware/', 'lib/', 'bootstrap/', 'shared/',
    'scripts/', 'drizzle/', 'migrations/'
  ],
  future: ['future', 'experimental', 'wip', 'planned', '.backup', 'RETIRED', '__DEAD__'],
  'UI Adapter': ['client/', 'components/', 'hooks/', 'pages/', 'ui/'],
  Other: ['.pythonlibs', '.local', '.upm', '.npm', 'docs/', 'Other/', 'snapshots/',
          'tools/', 'gpt5-agent-package/', 'mcp-server/', 'public/', 'schema/']
};

// Results storage
const results = {
  config: { files: [], schemas: {}, apiCalls: { memory: [], db: [] }, consoleLogs: [] },
  tests: { files: [], schemas: {}, apiCalls: { memory: [], db: [] }, consoleLogs: [] },
  workflow: { files: [], schemas: {}, apiCalls: { memory: [], db: [] }, consoleLogs: [], subcategories: {} },
  future: { files: [], schemas: {}, apiCalls: { memory: [], db: [] }, consoleLogs: [] },
  'UI Adapter': { files: [], schemas: {}, apiCalls: { memory: [], db: [] }, consoleLogs: [] },
  Other: { files: [], schemas: {}, apiCalls: { memory: [], db: [] }, consoleLogs: [] }
};

// Initialize workflow subcategories
for (const subcat of Object.keys(WORKFLOW_SUBCATEGORIES)) {
  results.workflow.subcategories[subcat] = { files: [], schemas: {}, apiCalls: { memory: [], db: [] }, consoleLogs: [] };
}

// UI file mapping (workflow file -> corresponding UI file)
const uiFileMap = new Map();

// All UI files for linking
const allUiFiles = [];

/**
 * Determine workflow subcategory for a file
 */
function getWorkflowSubcategory(filePath) {
  const relPath = relative(REPO_ROOT, filePath);
  const relPathLower = relPath.toLowerCase();
  const fileName = basename(filePath);

  // Check for true entry points first (root-level server files only)
  if (TRUE_ENTRY_POINTS.includes(fileName) && !relPath.includes('/')) {
    return '1. Entry Points';
  }

  for (const [subcat, patterns] of Object.entries(WORKFLOW_SUBCATEGORIES)) {
    if (patterns.length === 0) continue; // Skip empty patterns
    for (const pattern of patterns) {
      if (relPathLower.includes(pattern.toLowerCase())) {
        return subcat;
      }
    }
  }
  return '13. Other Workflow';
}

/**
 * Find corresponding UI file for a workflow file
 */
function findCorrespondingUiFile(workflowFilePath) {
  const workflowName = basename(workflowFilePath, extname(workflowFilePath)).toLowerCase();

  // Look for UI files with similar names
  for (const uiFile of allUiFiles) {
    const uiName = basename(uiFile, extname(uiFile)).toLowerCase();
    // Match by name similarity (e.g., blocks.js -> Blocks.tsx, chat.js -> Chat.tsx)
    if (uiName.includes(workflowName) || workflowName.includes(uiName)) {
      return uiFile;
    }
  }
  return null;
}

/**
 * Check if a file/path should be excluded
 */
function shouldExclude(filePath) {
  return EXCLUDE_PATTERNS.some(pattern => filePath.includes(pattern));
}

/**
 * Determine if a file is active in the current workflow
 */
function isActive(filePath) {
  const relPath = relative(REPO_ROOT, filePath);

  // Check if it matches active workflow patterns
  const isActiveFile = ACTIVE_WORKFLOW_PATTERNS.some(pattern => {
    if (pattern.endsWith('/')) {
      return relPath.startsWith(pattern) || relPath.includes('/' + pattern);
    }
    return relPath.includes(pattern);
  });

  // Exclude backup, retired, and dead files
  const isRetired = relPath.includes('RETIRED') ||
                    relPath.includes('__DEAD__') ||
                    relPath.includes('.backup') ||
                    relPath.includes('.old') ||
                    relPath.endsWith('.bak');

  return isActiveFile && !isRetired;
}

/**
 * Categorize a file into one of the major groups
 */
function categorizeFile(filePath) {
  const relPath = relative(REPO_ROOT, filePath).toLowerCase();
  const fileName = basename(filePath).toLowerCase();

  // Check future first (backup, retired, dead files)
  for (const pattern of CATEGORIES.future) {
    if (relPath.includes(pattern.toLowerCase())) {
      return 'future';
    }
  }

  // Check if it's explicitly in Other category paths
  for (const pattern of CATEGORIES.Other) {
    if (relPath.startsWith(pattern.toLowerCase()) || relPath.includes('/' + pattern.toLowerCase())) {
      return 'Other';
    }
  }

  // Check config
  for (const pattern of CATEGORIES.config) {
    if (relPath.includes(pattern.toLowerCase()) || fileName.includes(pattern.toLowerCase())) {
      return 'config';
    }
  }

  // Check tests
  for (const pattern of CATEGORIES.tests) {
    if (relPath.includes(pattern.toLowerCase())) {
      return 'tests';
    }
  }

  // Check UI Adapter
  for (const pattern of CATEGORIES['UI Adapter']) {
    if (relPath.includes(pattern.toLowerCase())) {
      return 'UI Adapter';
    }
  }

  // Check workflow
  for (const pattern of CATEGORIES.workflow) {
    if (relPath.includes(pattern.toLowerCase())) {
      return 'workflow';
    }
  }

  return 'Other';
}

/**
 * Extract schema references from file content
 */
function extractSchemas(content, filePath) {
  const schemas = {};

  // Match SQL table definitions
  const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?\s*\(([\s\S]*?)\);/gi;
  let match;
  while ((match = createTableRegex.exec(content)) !== null) {
    const tableName = match[1];
    const fieldsBlock = match[2];
    const fields = [];

    // Extract field names
    const fieldRegex = /["'`]?(\w+)["'`]?\s+(?:SERIAL|INTEGER|VARCHAR|TEXT|BOOLEAN|TIMESTAMP|UUID|JSONB|INT|BIGINT|DECIMAL|FLOAT|DATE|TIME)/gi;
    let fieldMatch;
    while ((fieldMatch = fieldRegex.exec(fieldsBlock)) !== null) {
      fields.push(fieldMatch[1]);
    }

    if (fields.length > 0) {
      schemas[tableName] = { fields, file: filePath };
    }
  }

  // Match Drizzle schema definitions
  const drizzleTableRegex = /(?:export\s+const\s+)?(\w+)\s*=\s*(?:pgTable|sqliteTable|mysqlTable)\s*\(\s*["'`](\w+)["'`]/g;
  while ((match = drizzleTableRegex.exec(content)) !== null) {
    const tableName = match[2];
    if (!schemas[tableName]) {
      schemas[tableName] = { fields: [], file: filePath };
    }
  }

  // Match Drizzle column definitions
  const drizzleColumnRegex = /(\w+):\s*(?:serial|integer|varchar|text|boolean|timestamp|uuid|jsonb|int|bigint|decimal|float|date|time)\s*\(/g;
  while ((match = drizzleColumnRegex.exec(content)) !== null) {
    // Add to last found table or create generic
    const lastTable = Object.keys(schemas).pop();
    if (lastTable && schemas[lastTable]) {
      schemas[lastTable].fields.push(match[1]);
    }
  }

  return schemas;
}

/**
 * Extract API calls from file content
 */
function extractApiCalls(content, filePath) {
  const apiCalls = { memory: [], db: [] };
  const relPath = relative(REPO_ROOT, filePath);

  // DB-resolved patterns
  const dbPatterns = [
    /(?:await\s+)?db\.(?:select|insert|update|delete|query|execute)\s*\(/g,
    /(?:await\s+)?pool\.query\s*\(/g,
    /(?:await\s+)?client\.query\s*\(/g,
    /(?:await\s+)?knex\s*\(/g,
    /(?:await\s+)?prisma\.\w+\.(findMany|findUnique|create|update|delete)\s*\(/g,
    /\.from\s*\(\s*["'`]\w+["'`]\s*\)/g,
  ];

  // Memory-resolved patterns (caches, in-memory operations)
  const memoryPatterns = [
    /cache\.get\s*\(/g,
    /cache\.set\s*\(/g,
    /Map\s*\(\s*\)/g,
    /new\s+Map\s*\(/g,
    /localStorage\./g,
    /sessionStorage\./g,
    /memoryCache/gi,
    /\.filter\s*\(/g,
    /\.map\s*\(/g,
    /\.reduce\s*\(/g,
  ];

  // Check DB patterns
  for (const pattern of dbPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      apiCalls.db.push({ call: match[0].trim(), file: relPath, line });
    }
  }

  // Check memory patterns
  for (const pattern of memoryPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      apiCalls.memory.push({ call: match[0].trim(), file: relPath, line });
    }
  }

  return apiCalls;
}

/**
 * Extract console.log statements from file content
 */
function extractConsoleLogs(content, filePath) {
  const logs = [];
  const relPath = relative(REPO_ROOT, filePath);

  const consoleRegex = /console\.(log|warn|error|info|debug)\s*\(\s*([^)]*)\)/g;
  let match;
  while ((match = consoleRegex.exec(content)) !== null) {
    const line = content.substring(0, match.index).split('\n').length;
    const preview = match[2].substring(0, 50).replace(/\n/g, ' ');
    logs.push({
      type: match[1],
      preview: preview + (match[2].length > 50 ? '...' : ''),
      file: relPath,
      line
    });
  }

  return logs;
}

/**
 * Recursively scan directory for files
 */
async function scanDirectory(dir) {
  const files = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (shouldExclude(fullPath)) continue;

      if (entry.isDirectory()) {
        const subFiles = await scanDirectory(fullPath);
        files.push(...subFiles);
      } else {
        files.push(fullPath);
      }
    }
  } catch (err) {
    // Skip directories we can't read
  }

  return files;
}

/**
 * Analyze a single file
 */
async function analyzeFile(filePath) {
  const ext = extname(filePath).toLowerCase();
  const analyzableExts = ['.js', '.ts', '.jsx', '.tsx', '.sql', '.mjs', '.cjs'];

  const category = categorizeFile(filePath);
  const active = isActive(filePath);
  const relPath = relative(REPO_ROOT, filePath);

  // Collect UI files for later linking
  if (category === 'UI Adapter') {
    allUiFiles.push(relPath);
  }

  // Add file to category
  results[category].files.push({ path: relPath, active });

  // For workflow files, also add to subcategory
  if (category === 'workflow') {
    const subcat = getWorkflowSubcategory(filePath);
    results.workflow.subcategories[subcat].files.push({ path: relPath, active });
  }

  // Only analyze code files
  if (!analyzableExts.includes(ext)) return;

  try {
    const content = await readFile(filePath, 'utf-8');

    // Extract schemas
    const schemas = extractSchemas(content, relPath);
    for (const [table, data] of Object.entries(schemas)) {
      if (!results[category].schemas[table]) {
        results[category].schemas[table] = data;
      } else {
        // Merge fields
        results[category].schemas[table].fields = [
          ...new Set([...results[category].schemas[table].fields, ...data.fields])
        ];
      }

      // Also add to workflow subcategory
      if (category === 'workflow') {
        const subcat = getWorkflowSubcategory(filePath);
        if (!results.workflow.subcategories[subcat].schemas[table]) {
          results.workflow.subcategories[subcat].schemas[table] = data;
        }
      }
    }

    // Extract API calls
    const apiCalls = extractApiCalls(content, filePath);
    results[category].apiCalls.memory.push(...apiCalls.memory);
    results[category].apiCalls.db.push(...apiCalls.db);

    // Also add to workflow subcategory
    if (category === 'workflow') {
      const subcat = getWorkflowSubcategory(filePath);
      results.workflow.subcategories[subcat].apiCalls.memory.push(...apiCalls.memory);
      results.workflow.subcategories[subcat].apiCalls.db.push(...apiCalls.db);
    }

    // Extract console logs
    const consoleLogs = extractConsoleLogs(content, filePath);
    results[category].consoleLogs.push(...consoleLogs);

    // Also add to workflow subcategory
    if (category === 'workflow') {
      const subcat = getWorkflowSubcategory(filePath);
      results.workflow.subcategories[subcat].consoleLogs.push(...consoleLogs);
    }

  } catch (err) {
    // Skip files we can't read
  }
}

/**
 * Generate workflow-specific markdown output
 */
function generateWorkflowOutput() {
  let output = '# Workflow File Listing\n\n';
  output += `Generated: ${new Date().toISOString()}\n\n`;
  output += 'Workflow files organized by event flow order. Non-active files appear at the end of each category.\n\n';
  output += '---\n\n';

  // Sort subcategories by their number prefix
  const subcatOrder = Object.keys(WORKFLOW_SUBCATEGORIES).sort();

  for (const subcat of subcatOrder) {
    const data = results.workflow.subcategories[subcat];
    if (data.files.length === 0) continue;

    output += `## ${subcat}\n\n`;

    // Sort files: active first, then non-active, alphabetically within each group
    const sortedFiles = [...data.files].sort((a, b) => {
      if (a.active && !b.active) return -1;
      if (!a.active && b.active) return 1;
      return a.path.localeCompare(b.path);
    });

    output += '### Files\n\n';
    for (const file of sortedFiles) {
      const status = file.active ? '(active)' : '(not active)';

      // Find corresponding UI file
      const uiFile = findCorrespondingUiFile(file.path);
      const uiLink = uiFile ? ` → UI: [${basename(uiFile)}](./${uiFile})` : '';

      output += `- [${file.path}](./${file.path}) ${status}${uiLink}\n`;
    }
    output += '\n';

    // List schemas for this subcategory
    if (Object.keys(data.schemas).length > 0) {
      output += '### 1. Schema\n\n';
      for (const [tableName, tableData] of Object.entries(data.schemas).sort()) {
        output += `#### 1.1 ${tableName}\n\n`;
        if (tableData.fields.length > 0) {
          for (const field of tableData.fields) {
            output += `- 1.1.1 ${field}\n`;
          }
        }
        output += `\n_Source: ${tableData.file}_\n\n`;
      }
    }

    // List API calls for this subcategory
    if (data.apiCalls.memory.length > 0 || data.apiCalls.db.length > 0) {
      output += '### 2. API Call\n\n';

      if (data.apiCalls.memory.length > 0) {
        output += '#### 2.1 Resolved in memory\n\n';
        const uniqueMemory = [...new Map(data.apiCalls.memory.map(c => [`${c.file}:${c.line}`, c])).values()];
        for (const call of uniqueMemory.slice(0, 30)) {
          output += `- \`${call.call}\` - ${call.file}:${call.line}\n`;
        }
        if (uniqueMemory.length > 30) {
          output += `- _... and ${uniqueMemory.length - 30} more_\n`;
        }
        output += '\n';
      }

      if (data.apiCalls.db.length > 0) {
        output += '#### 2.2 Resolved in db\n\n';
        const uniqueDb = [...new Map(data.apiCalls.db.map(c => [`${c.file}:${c.line}`, c])).values()];
        for (const call of uniqueDb.slice(0, 30)) {
          output += `- \`${call.call}\` - ${call.file}:${call.line}\n`;
        }
        if (uniqueDb.length > 30) {
          output += `- _... and ${uniqueDb.length - 30} more_\n`;
        }
        output += '\n';
      }
    }

    // List console logs for this subcategory
    if (data.consoleLogs.length > 0) {
      output += '### 3. Console log\n\n';
      const uniqueLogs = [...new Map(data.consoleLogs.map(l => [`${l.file}:${l.line}`, l])).values()];
      for (const log of uniqueLogs.slice(0, 30)) {
        output += `- \`console.${log.type}(${log.preview})\` - ${log.file}:${log.line}\n`;
      }
      if (uniqueLogs.length > 30) {
        output += `- _... and ${uniqueLogs.length - 30} more_\n`;
      }
      output += '\n';
    }

    output += '---\n\n';
  }

  // Workflow Summary
  output += '## Workflow Summary\n\n';
  output += '| Subcategory | Files | Active | Not Active | Schemas | API Calls | Console Logs |\n';
  output += '|-------------|-------|--------|------------|---------|-----------|-------------|\n';

  for (const subcat of subcatOrder) {
    const data = results.workflow.subcategories[subcat];
    if (data.files.length === 0) continue;

    const activeCount = data.files.filter(f => f.active).length;
    const notActiveCount = data.files.filter(f => !f.active).length;
    const schemaCount = Object.keys(data.schemas).length;
    const apiCount = data.apiCalls.memory.length + data.apiCalls.db.length;
    const logCount = data.consoleLogs.length;

    output += `| ${subcat} | ${data.files.length} | ${activeCount} | ${notActiveCount} | ${schemaCount} | ${apiCount} | ${logCount} |\n`;
  }

  return output;
}

/**
 * Main execution
 */
async function main() {
  console.log('Scanning repository...');

  const files = await scanDirectory(REPO_ROOT);
  console.log(`Found ${files.length} files`);

  console.log('Analyzing files...');
  for (const file of files) {
    await analyzeFile(file);
  }

  console.log('Generating output...');
  const workflowOutput = generateWorkflowOutput();

  // Write workflow-specific output only
  const workflowOutputPath = join(REPO_ROOT, 'WORKFLOW_FILE_LISTING.md');
  await import('fs').then(fs => {
    fs.writeFileSync(workflowOutputPath, workflowOutput);
  });

  console.log(`\nOutput written to: ${workflowOutputPath}`);
  console.log('\n--- WORKFLOW FILE LISTING ---\n');
  console.log(workflowOutput);
}

main().catch(console.error);
