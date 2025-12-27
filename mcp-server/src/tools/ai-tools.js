/**
 * AI Operation Tools (4 tools)
 *
 * ai_analyze, ai_suggest, ai_explain, ai_refactor
 *
 * These tools provide AI-assisted code analysis without calling external AI APIs.
 * They use pattern matching and heuristics for basic analysis.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

let repoRoot = process.cwd();

function resolvePath(filePath) {
  if (path.isAbsolute(filePath)) return filePath;
  return path.join(repoRoot, filePath);
}

export const aiTools = {
  // ─────────────────────────────────────────────────────────────────────────
  // ai_analyze - Analyze code for issues and patterns
  // ─────────────────────────────────────────────────────────────────────────
  ai_analyze: {
    category: 'ai',
    description: 'Analyze code for common issues, patterns, and potential improvements.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to file to analyze' },
        analysis_type: {
          type: 'string',
          enum: ['security', 'performance', 'complexity', 'style', 'all'],
          default: 'all'
        }
      },
      required: ['file_path']
    },
    init(root) { repoRoot = root; },
    async execute({ file_path, analysis_type = 'all' }) {
      const fullPath = resolvePath(file_path);
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');

      const analysis = {
        file: file_path,
        lines: lines.length,
        issues: [],
        metrics: {}
      };

      // Security checks
      if (analysis_type === 'security' || analysis_type === 'all') {
        const securityPatterns = [
          { pattern: /eval\s*\(/, issue: 'Use of eval() - potential security risk', severity: 'high' },
          { pattern: /innerHTML\s*=/, issue: 'Direct innerHTML assignment - XSS risk', severity: 'medium' },
          { pattern: /password.*=.*['"][^'"]+['"]/i, issue: 'Hardcoded password detected', severity: 'critical' },
          { pattern: /api[_-]?key.*=.*['"][^'"]+['"]/i, issue: 'Hardcoded API key detected', severity: 'critical' },
          { pattern: /exec\s*\(/, issue: 'Use of exec() - potential command injection', severity: 'high' },
          { pattern: /SELECT.*\+.*req\.|query\s*\+/i, issue: 'Potential SQL injection', severity: 'high' }
        ];

        lines.forEach((line, i) => {
          for (const { pattern, issue, severity } of securityPatterns) {
            if (pattern.test(line)) {
              analysis.issues.push({
                type: 'security',
                severity,
                line: i + 1,
                issue,
                code: line.trim().slice(0, 100)
              });
            }
          }
        });
      }

      // Performance checks
      if (analysis_type === 'performance' || analysis_type === 'all') {
        const perfPatterns = [
          { pattern: /\.forEach\(.*\.forEach\(/, issue: 'Nested forEach loops - O(n²) complexity', severity: 'medium' },
          { pattern: /for\s*\([^)]*\)\s*{[^}]*for\s*\(/, issue: 'Nested for loops - consider optimization', severity: 'low' },
          { pattern: /JSON\.parse\(JSON\.stringify/, issue: 'Deep clone via JSON - use structuredClone or library', severity: 'low' },
          { pattern: /await.*await.*await/g, issue: 'Sequential awaits - consider Promise.all', severity: 'medium' }
        ];

        lines.forEach((line, i) => {
          for (const { pattern, issue, severity } of perfPatterns) {
            if (pattern.test(line)) {
              analysis.issues.push({
                type: 'performance',
                severity,
                line: i + 1,
                issue
              });
            }
          }
        });
      }

      // Complexity metrics
      if (analysis_type === 'complexity' || analysis_type === 'all') {
        const functionMatches = content.match(/function\s+\w+|=>\s*{|\w+\s*\([^)]*\)\s*{/g) || [];
        const ifStatements = content.match(/if\s*\(/g) || [];
        const loops = content.match(/for\s*\(|while\s*\(|\.forEach\(|\.map\(|\.filter\(/g) || [];

        analysis.metrics = {
          functions: functionMatches.length,
          conditionals: ifStatements.length,
          loops: loops.length,
          estimated_complexity: functionMatches.length + ifStatements.length + loops.length
        };

        if (analysis.metrics.estimated_complexity > 50) {
          analysis.issues.push({
            type: 'complexity',
            severity: 'medium',
            issue: `High complexity score (${analysis.metrics.estimated_complexity}) - consider splitting into smaller modules`
          });
        }
      }

      // Style checks
      if (analysis_type === 'style' || analysis_type === 'all') {
        const stylePatterns = [
          { pattern: /console\.log\(/, issue: 'Console.log statement - remove for production', severity: 'low' },
          { pattern: /\/\/\s*TODO/i, issue: 'TODO comment found', severity: 'info' },
          { pattern: /\/\/\s*FIXME/i, issue: 'FIXME comment found', severity: 'info' },
          { pattern: /var\s+\w+\s*=/, issue: 'Use of var - prefer const/let', severity: 'low' }
        ];

        lines.forEach((line, i) => {
          for (const { pattern, issue, severity } of stylePatterns) {
            if (pattern.test(line)) {
              analysis.issues.push({
                type: 'style',
                severity,
                line: i + 1,
                issue
              });
            }
          }
        });

        // Check for very long lines
        lines.forEach((line, i) => {
          if (line.length > 120) {
            analysis.issues.push({
              type: 'style',
              severity: 'low',
              line: i + 1,
              issue: `Line too long (${line.length} chars)`
            });
          }
        });
      }

      // Sort issues by severity
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      analysis.issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

      analysis.summary = {
        total_issues: analysis.issues.length,
        critical: analysis.issues.filter(i => i.severity === 'critical').length,
        high: analysis.issues.filter(i => i.severity === 'high').length,
        medium: analysis.issues.filter(i => i.severity === 'medium').length,
        low: analysis.issues.filter(i => i.severity === 'low').length
      };

      return analysis;
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ai_suggest - Suggest improvements for code
  // ─────────────────────────────────────────────────────────────────────────
  ai_suggest: {
    category: 'ai',
    description: 'Suggest improvements based on common patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to file' },
        focus: {
          type: 'string',
          enum: ['naming', 'structure', 'error_handling', 'testing', 'documentation', 'all'],
          default: 'all'
        }
      },
      required: ['file_path']
    },
    init(root) { repoRoot = root; },
    async execute({ file_path, focus = 'all' }) {
      const fullPath = resolvePath(file_path);
      const content = await fs.readFile(fullPath, 'utf-8');
      const suggestions = [];

      // Naming suggestions
      if (focus === 'naming' || focus === 'all') {
        const singleLetterVars = content.match(/(?:const|let|var)\s+[a-z]\s*=/g) || [];
        if (singleLetterVars.length > 3) {
          suggestions.push({
            type: 'naming',
            suggestion: 'Consider using more descriptive variable names instead of single letters',
            count: singleLetterVars.length
          });
        }

        if (/function\s+[a-z](?:[A-Z]|$)/.test(content) === false && /function\s+[A-Z]/.test(content)) {
          suggestions.push({
            type: 'naming',
            suggestion: 'Function names should use camelCase, not PascalCase (unless constructors)'
          });
        }
      }

      // Structure suggestions
      if (focus === 'structure' || focus === 'all') {
        const lines = content.split('\n');
        if (lines.length > 500) {
          suggestions.push({
            type: 'structure',
            suggestion: `File is ${lines.length} lines - consider splitting into smaller modules`
          });
        }

        const imports = content.match(/^import .*/gm) || [];
        if (imports.length > 20) {
          suggestions.push({
            type: 'structure',
            suggestion: `${imports.length} imports detected - consider creating an index/barrel file`
          });
        }
      }

      // Error handling suggestions
      if (focus === 'error_handling' || focus === 'all') {
        const asyncFuncs = content.match(/async\s+function|=\s*async\s*\(/g) || [];
        const tryCatches = content.match(/try\s*{/g) || [];

        if (asyncFuncs.length > tryCatches.length + 2) {
          suggestions.push({
            type: 'error_handling',
            suggestion: `${asyncFuncs.length} async functions but only ${tryCatches.length} try-catch blocks - consider adding error handling`
          });
        }

        if (content.includes('catch (') && content.match(/catch\s*\(\w*\)\s*{\s*}/)) {
          suggestions.push({
            type: 'error_handling',
            suggestion: 'Empty catch block detected - handle or log the error'
          });
        }
      }

      // Documentation suggestions
      if (focus === 'documentation' || focus === 'all') {
        const exports = content.match(/export\s+(?:default\s+)?(?:async\s+)?function\s+\w+/g) || [];
        const jsdocs = content.match(/\/\*\*[\s\S]*?\*\//g) || [];

        if (exports.length > jsdocs.length + 2) {
          suggestions.push({
            type: 'documentation',
            suggestion: `${exports.length} exported functions but only ${jsdocs.length} JSDoc comments - consider documenting exports`
          });
        }

        if (!content.includes('/**') && content.length > 1000) {
          suggestions.push({
            type: 'documentation',
            suggestion: 'No JSDoc comments found - consider adding documentation'
          });
        }
      }

      // Testing suggestions
      if (focus === 'testing' || focus === 'all') {
        const ext = path.extname(file_path);
        if (!file_path.includes('.test.') && !file_path.includes('.spec.')) {
          const testFile = file_path.replace(ext, `.test${ext}`);
          try {
            await fs.access(resolvePath(testFile));
          } catch {
            suggestions.push({
              type: 'testing',
              suggestion: `No test file found - consider creating ${testFile}`
            });
          }
        }
      }

      return {
        file: file_path,
        suggestions,
        count: suggestions.length
      };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ai_explain - Generate explanations for code
  // ─────────────────────────────────────────────────────────────────────────
  ai_explain: {
    category: 'ai',
    description: 'Generate explanations for code structure and patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to file' },
        line_start: { type: 'number', description: 'Start line' },
        line_end: { type: 'number', description: 'End line' }
      },
      required: ['file_path']
    },
    init(root) { repoRoot = root; },
    async execute({ file_path, line_start, line_end }) {
      const fullPath = resolvePath(file_path);
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');

      // Get specific lines if specified
      let codeToExplain = content;
      if (line_start && line_end) {
        codeToExplain = lines.slice(line_start - 1, line_end).join('\n');
      }

      const explanation = {
        file: file_path,
        structure: [],
        patterns: [],
        dependencies: []
      };

      // Identify imports/dependencies
      const imports = codeToExplain.match(/import\s+.*from\s+['"]([^'"]+)['"]/g) || [];
      explanation.dependencies = imports.map(imp => {
        const match = imp.match(/from\s+['"]([^'"]+)['"]/);
        return match ? match[1] : imp;
      });

      // Identify main structures
      const functions = codeToExplain.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/g) || [];
      const classes = codeToExplain.match(/class\s+(\w+)/g) || [];
      const exports = codeToExplain.match(/export\s+(?:default\s+)?(\w+)/g) || [];

      if (functions.length > 0) {
        explanation.structure.push({
          type: 'functions',
          count: functions.length,
          names: functions.map(f => f.match(/function\s+(\w+)/)?.[1]).filter(Boolean)
        });
      }

      if (classes.length > 0) {
        explanation.structure.push({
          type: 'classes',
          count: classes.length,
          names: classes.map(c => c.match(/class\s+(\w+)/)?.[1]).filter(Boolean)
        });
      }

      // Identify patterns
      if (/export\s+default/.test(codeToExplain)) {
        explanation.patterns.push('Default export pattern');
      }
      if (/async.*await/.test(codeToExplain)) {
        explanation.patterns.push('Async/await pattern');
      }
      if (/\.then\(.*\.catch\(/.test(codeToExplain)) {
        explanation.patterns.push('Promise chain pattern');
      }
      if (/useState|useEffect|useCallback/.test(codeToExplain)) {
        explanation.patterns.push('React hooks pattern');
      }
      if (/express\(\)|Router\(\)/.test(codeToExplain)) {
        explanation.patterns.push('Express.js routing pattern');
      }
      if (/\.map\(.*=>/.test(codeToExplain)) {
        explanation.patterns.push('Functional array transformation');
      }
      if (/try\s*{[\s\S]*?catch/.test(codeToExplain)) {
        explanation.patterns.push('Error handling with try-catch');
      }

      // Generate summary
      explanation.summary = `This file contains ${functions.length} function(s) and ${classes.length} class(es). ` +
        `It imports from ${explanation.dependencies.length} module(s). ` +
        (explanation.patterns.length > 0 ? `Patterns detected: ${explanation.patterns.join(', ')}.` : '');

      return explanation;
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ai_refactor - Suggest refactoring opportunities
  // ─────────────────────────────────────────────────────────────────────────
  ai_refactor: {
    category: 'ai',
    description: 'Identify refactoring opportunities in code.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to file' },
        type: {
          type: 'string',
          enum: ['extract_function', 'simplify', 'modernize', 'dry', 'all'],
          default: 'all'
        }
      },
      required: ['file_path']
    },
    init(root) { repoRoot = root; },
    async execute({ file_path, type = 'all' }) {
      const fullPath = resolvePath(file_path);
      const content = await fs.readFile(fullPath, 'utf-8');
      const refactorings = [];

      // Extract function opportunities
      if (type === 'extract_function' || type === 'all') {
        // Look for duplicated code patterns
        const lines = content.split('\n');
        const lineGroups = {};

        lines.forEach((line, i) => {
          const normalized = line.trim();
          if (normalized.length > 30 && !normalized.startsWith('//') && !normalized.startsWith('import')) {
            lineGroups[normalized] = lineGroups[normalized] || [];
            lineGroups[normalized].push(i + 1);
          }
        });

        for (const [code, lineNumbers] of Object.entries(lineGroups)) {
          if (lineNumbers.length >= 3) {
            refactorings.push({
              type: 'extract_function',
              suggestion: 'Duplicated code found - consider extracting to a function',
              lines: lineNumbers,
              code: code.slice(0, 80)
            });
          }
        }
      }

      // Modernize opportunities
      if (type === 'modernize' || type === 'all') {
        if (/var\s+\w+/.test(content)) {
          refactorings.push({
            type: 'modernize',
            suggestion: 'Replace var with const/let',
            pattern: 'var declarations'
          });
        }
        if (/function\s*\([^)]*\)\s*{/.test(content) && !content.includes('function*')) {
          refactorings.push({
            type: 'modernize',
            suggestion: 'Consider using arrow functions for callbacks',
            pattern: 'traditional function expressions'
          });
        }
        if (/['"]use strict['"]/.test(content)) {
          refactorings.push({
            type: 'modernize',
            suggestion: '"use strict" is unnecessary in ES modules',
            pattern: 'use strict directive'
          });
        }
        if (/\.then\(.*\)\.then\(/.test(content)) {
          refactorings.push({
            type: 'modernize',
            suggestion: 'Consider converting promise chains to async/await',
            pattern: 'promise chains'
          });
        }
      }

      // Simplify opportunities
      if (type === 'simplify' || type === 'all') {
        if (/if\s*\([^)]+\)\s*{\s*return\s+true\s*;?\s*}\s*(?:else\s*{\s*)?return\s+false/.test(content)) {
          refactorings.push({
            type: 'simplify',
            suggestion: 'Simplify boolean return - just return the condition directly',
            pattern: 'if(x) return true; else return false;'
          });
        }
        if (/===\s*true|===\s*false|!==\s*true|!==\s*false/.test(content)) {
          refactorings.push({
            type: 'simplify',
            suggestion: 'Remove unnecessary boolean comparison',
            pattern: 'x === true or x === false'
          });
        }
      }

      // DRY opportunities
      if (type === 'dry' || type === 'all') {
        // Look for similar fetch calls
        const fetchCalls = content.match(/fetch\s*\([^)]+\)/g) || [];
        if (fetchCalls.length > 3) {
          refactorings.push({
            type: 'dry',
            suggestion: 'Multiple fetch calls - consider creating a shared API client',
            count: fetchCalls.length
          });
        }

        // Look for repeated error handling
        const catchBlocks = content.match(/catch\s*\(\w+\)\s*{[^}]+}/g) || [];
        if (catchBlocks.length > 3) {
          const uniqueCatches = new Set(catchBlocks.map(c => c.replace(/\w+\)/g, 'e)'))).size;
          if (uniqueCatches < catchBlocks.length / 2) {
            refactorings.push({
              type: 'dry',
              suggestion: 'Similar catch blocks found - consider creating a shared error handler',
              count: catchBlocks.length
            });
          }
        }
      }

      return {
        file: file_path,
        refactorings,
        count: refactorings.length
      };
    }
  }
};
