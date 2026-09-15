#!/usr/bin/env node
// Validate repository JSON, excluding ignored runtime data and nested checkouts.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const deleted = new Set(execFileSync('git', ['ls-files', '-z', '--deleted', '--', '*.json'], {
  encoding: 'utf8',
}).split('\0').filter(Boolean));
const files = [...new Set(execFileSync('git', [
  'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.json',
], { encoding: 'utf8' }).split('\0').filter(Boolean))].filter(file => !deleted.has(file));
let failures = 0;
for (const file of files) {
  try { JSON.parse(readFileSync(file, 'utf8')); }
  catch {
    // JSON.parse errors can include file contents; report only the path.
    console.error(`Invalid or unreadable JSON: ${file}`);
    failures++;
  }
}
console.log(`Checked ${files.length} JSON files; ${failures} failures.`);
process.exitCode = failures ? 1 : 0;
