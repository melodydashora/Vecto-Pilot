#!/usr/bin/env node

/**
 * Repository File Lister
 * Lists all files grouped by type with schema, API call, and console.log analysis
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, relative, extname, basename } from 'path';
import { existsSync } from 'fs';

const REPO_ROOT = process.cwd();

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
  workflow: { files: [], schemas: {}, apiCalls: { memory: [], db: [] }, consoleLogs: [] },
  future: { files: [], schemas: {}, apiCalls: { memory: [], db: [] }, consoleLogs: [] },
  'UI Adapter': { files: [], schemas: {}, apiCalls: { memory: [], db: [] }, consoleLogs: [] },
  Other: { files: [], schemas: {}, apiCalls: { memory: [], db: [] }, consoleLogs: [] }
};

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

  // Add file to category
  results[category].files.push({ path: relPath, active });

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
    }

    // Extract API calls
    const apiCalls = extractApiCalls(content, filePath);
    results[category].apiCalls.memory.push(...apiCalls.memory);
    results[category].apiCalls.db.push(...apiCalls.db);

    // Extract console logs
    const consoleLogs = extractConsoleLogs(content, filePath);
    results[category].consoleLogs.push(...consoleLogs);

  } catch (err) {
    // Skip files we can't read
  }
}

/**
 * Generate markdown output
 */
function generateOutput() {
  let output = '# Repository File Listing\n\n';
  output += `Generated: ${new Date().toISOString()}\n\n`;
  output += '---\n\n';

  const categoryOrder = ['config', 'tests', 'workflow', 'future', 'UI Adapter', 'Other'];

  for (const category of categoryOrder) {
    const data = results[category];

    output += `## ${category}\n\n`;

    // List files
    if (data.files.length > 0) {
      output += '### Files\n\n';
      for (const file of data.files.sort((a, b) => a.path.localeCompare(b.path))) {
        const status = file.active ? '(active)' : '(not active)';
        output += `- [${file.path}](./${file.path}) ${status}\n`;
      }
      output += '\n';
    }

    // List schemas
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

    // List API calls
    if (data.apiCalls.memory.length > 0 || data.apiCalls.db.length > 0) {
      output += '### 2. API Call\n\n';

      if (data.apiCalls.memory.length > 0) {
        output += '#### 2.1 Resolved in memory\n\n';
        const uniqueMemory = [...new Map(data.apiCalls.memory.map(c => [`${c.file}:${c.line}`, c])).values()];
        for (const call of uniqueMemory.slice(0, 50)) { // Limit to 50
          output += `- \`${call.call}\` - ${call.file}:${call.line}\n`;
        }
        if (uniqueMemory.length > 50) {
          output += `- _... and ${uniqueMemory.length - 50} more_\n`;
        }
        output += '\n';
      }

      if (data.apiCalls.db.length > 0) {
        output += '#### 2.2 Resolved in db\n\n';
        const uniqueDb = [...new Map(data.apiCalls.db.map(c => [`${c.file}:${c.line}`, c])).values()];
        for (const call of uniqueDb.slice(0, 50)) { // Limit to 50
          output += `- \`${call.call}\` - ${call.file}:${call.line}\n`;
        }
        if (uniqueDb.length > 50) {
          output += `- _... and ${uniqueDb.length - 50} more_\n`;
        }
        output += '\n';
      }
    }

    // List console logs
    if (data.consoleLogs.length > 0) {
      output += '### 3. Console log\n\n';
      const uniqueLogs = [...new Map(data.consoleLogs.map(l => [`${l.file}:${l.line}`, l])).values()];
      for (const log of uniqueLogs.slice(0, 50)) { // Limit to 50
        output += `- \`console.${log.type}(${log.preview})\` - ${log.file}:${log.line}\n`;
      }
      if (uniqueLogs.length > 50) {
        output += `- _... and ${uniqueLogs.length - 50} more_\n`;
      }
      output += '\n';
    }

    output += '---\n\n';
  }

  // Summary
  output += '## Summary\n\n';
  output += '| Category | Files | Active | Not Active | Schemas | API Calls | Console Logs |\n';
  output += '|----------|-------|--------|------------|---------|-----------|-------------|\n';

  for (const category of categoryOrder) {
    const data = results[category];
    const activeCount = data.files.filter(f => f.active).length;
    const notActiveCount = data.files.filter(f => !f.active).length;
    const schemaCount = Object.keys(data.schemas).length;
    const apiCount = data.apiCalls.memory.length + data.apiCalls.db.length;
    const logCount = data.consoleLogs.length;

    output += `| ${category} | ${data.files.length} | ${activeCount} | ${notActiveCount} | ${schemaCount} | ${apiCount} | ${logCount} |\n`;
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
  const output = generateOutput();

  // Write to file
  const outputPath = join(REPO_ROOT, 'REPO_FILE_LISTING.md');
  await import('fs').then(fs => {
    fs.writeFileSync(outputPath, output);
  });

  console.log(`\nOutput written to: ${outputPath}`);
  console.log('\n' + output);
}

main().catch(console.error);
