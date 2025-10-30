/**
 * CI GUARD: No Hardcoded Location Data
 * 
 * Fails if any source file contains location literals (lat/lng/address constants)
 * Run: npm run check:location
 */

import fs from 'fs';
import { glob } from 'glob';

const files = await glob(['**/*.{ts,tsx,js,jsx,mjs}', '!node_modules/**', '!dist/**', '!.replit/**'], { 
  ignore: ['node_modules/**', 'dist/**', '.replit/**', 'scripts/**'],
  nodir: true  // Skip directories to avoid EISDIR errors
});

const patterns = [
  // Lat/lng numeric literals
  /\b(lat|lng|latitude|longitude)\s*[:=]\s*-?\d{1,3}\.\d{3,}/i,
  // Address string literals (8+ chars)
  /address\s*[:=]\s*["'`][^"'`]{8,}["'`]/i,
  // Default constants
  /\bDEFAULT_(LAT|LNG|ADDRESS|LOCATION)\b/,
  // Hardcoded markers
  /HARDCODED_(LOCATION|LAT|LNG|ADDRESS|COORDINATES)/i,
  // Example coordinates patterns
  /33\.\d{5,}.*-96\.\d{5,}/,  // DFW area coordinates
  /32\.\d{5,}.*-96\.\d{5,}/,  // Dallas coordinates
];

let violations = [];

for (const file of files) {
  try {
    // Skip if it's a directory (safety check)
    const stat = fs.statSync(file);
    if (stat.isDirectory()) continue;
    
    const content = fs.readFileSync(file, 'utf8');
    
    for (const pattern of patterns) {
      const match = pattern.exec(content);
      if (match) {
        const line = content.substring(0, match.index).split('\n').length;
        violations.push({
          file,
          line,
          pattern: pattern.toString(),
          match: match[0].substring(0, 80) // Truncate long matches
        });
      }
    }
  } catch (err) {
    // Skip files that can't be read
    if (err.code !== 'EISDIR') {
      console.warn(`Warning: Could not read ${file}: ${err.message}`);
    }
  }
}

if (violations.length > 0) {
  console.error('\n❌ HARDCODED LOCATION DATA DETECTED:\n');
  violations.forEach(v => {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    Pattern: ${v.pattern}`);
    console.error(`    Match: ${v.match}`);
    console.error('');
  });
  console.error('💡 Use runtime location providers instead of hardcoded values.\n');
  process.exit(1);
}

console.log('✅ No hardcoded location data detected.');
console.log(`   Scanned ${files.length} files.`);
