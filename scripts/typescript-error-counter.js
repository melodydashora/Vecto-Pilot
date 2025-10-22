
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

const ERRORS_LOG_FILE = path.join(process.cwd(), 'typescript-errors.log');
const PROGRESS_FILE = path.join(process.cwd(), 'typescript-progress.json');

function getCurrentTimestamp() {
  return new Date().toISOString();
}

function parseTypeScriptErrors(output) {
  const lines = output.split('\n');
  const errorPattern = /^src\/.*\.tsx?:\d+:\d+ - error TS\d+:/;
  const serverErrorPattern = /^\.\.\/server\/.*\.ts:\d+:\d+ - error TS\d+:/;
  
  let errors = [];
  let currentError = null;
  
  for (let line of lines) {
    if (errorPattern.test(line) || serverErrorPattern.test(line)) {
      if (currentError) {
        errors.push(currentError);
      }
      currentError = {
        file: line.split(':')[0],
        line: parseInt(line.split(':')[1]),
        column: parseInt(line.split(':')[2]),
        code: line.match(/TS(\d+)/)?.[1] || 'unknown',
        message: line.split('error TS')[1] || line
      };
    } else if (currentError && line.trim()) {
      currentError.message += ' ' + line.trim();
    }
  }
  
  if (currentError) {
    errors.push(currentError);
  }
  
  return errors;
}

function categorizeErrors(errors) {
  const categories = {
    'Missing Modules': [],
    'Type Mismatches': [],
    'Form/Hook Issues': [],
    'Import Errors': [],
    'Property Missing': [],
    'Other': []
  };
  
  errors.forEach(error => {
    const msg = error.message.toLowerCase();
    
    if (msg.includes('cannot find module')) {
      categories['Missing Modules'].push(error);
    } else if (msg.includes('not assignable to') || msg.includes('type mismatch')) {
      categories['Type Mismatches'].push(error);
    } else if (msg.includes('useform') || msg.includes('control') || msg.includes('fieldvalues')) {
      categories['Form/Hook Issues'].push(error);
    } else if (msg.includes('import') || msg.includes('export')) {
      categories['Import Errors'].push(error);
    } else if (msg.includes('does not exist on type') || msg.includes('property')) {
      categories['Property Missing'].push(error);
    } else {
      categories['Other'].push(error);
    }
  });
  
  return categories;
}

function loadPreviousProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('Could not load previous progress:', e.message);
  }
  return { history: [] };
}

function saveProgress(data) {
  try {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Could not save progress:', e.message);
  }
}

function generateProgressReport(current, previous) {
  if (!previous) return null;
  
  const fixed = previous.totalErrors - current.totalErrors;
  const fixRate = previous.totalErrors > 0 ? (fixed / previous.totalErrors * 100).toFixed(1) : 0;
  
  return {
    fixed,
    fixRate,
    timeElapsed: new Date(current.timestamp) - new Date(previous.timestamp)
  };
}

function displayResults(errors, categories, progress) {
  console.log('\n🔍 TypeScript Error Analysis');
  console.log('═'.repeat(50));
  
  console.log(`📊 Total Errors: ${errors.length}`);
  console.log(`⏰ Scan Time: ${getCurrentTimestamp()}\n`);
  
  if (progress && progress.fixed !== undefined) {
    const timeHours = (progress.timeElapsed / (1000 * 60 * 60)).toFixed(1);
    console.log('📈 Progress Since Last Scan:');
    console.log(`   ✅ Fixed: ${progress.fixed} errors`);
    console.log(`   📉 Fix Rate: ${progress.fixRate}%`);
    console.log(`   ⏱️  Time: ${timeHours} hours\n`);
  }
  
  console.log('📋 Error Categories:');
  Object.entries(categories).forEach(([category, errs]) => {
    if (errs.length > 0) {
      console.log(`   ${category}: ${errs.length} errors`);
    }
  });
  
  console.log('\n🎯 Top Error Files:');
  const fileErrorCounts = {};
  errors.forEach(error => {
    fileErrorCounts[error.file] = (fileErrorCounts[error.file] || 0) + 1;
  });
  
  Object.entries(fileErrorCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .forEach(([file, count]) => {
      console.log(`   ${file}: ${count} errors`);
    });
  
  if (errors.length === 0) {
    console.log('\n🎉 CONGRATULATIONS! Zero TypeScript errors! 🎉');
  } else if (errors.length < 50) {
    console.log('\n🚀 Great progress! Under 50 errors remaining!');
  } else if (errors.length < 100) {
    console.log('\n💪 Good progress! Under 100 errors remaining!');
  }
  
  console.log(`\n📝 Detailed log saved to: ${ERRORS_LOG_FILE}`);
  console.log(`📊 Progress tracked in: ${PROGRESS_FILE}`);
}

function main() {
  console.log('🔍 Analyzing TypeScript errors...\n');
  
  exec('npx tsc --noEmit 2>&1', (error, stdout, stderr) => {
    const output = stdout + stderr;
    const errors = parseTypeScriptErrors(output);
    const categories = categorizeErrors(errors);
    const previousProgress = loadPreviousProgress();
    
    const currentData = {
      timestamp: getCurrentTimestamp(),
      totalErrors: errors.length,
      categories: Object.fromEntries(
        Object.entries(categories).map(([cat, errs]) => [cat, errs.length])
      ),
      errors: errors
    };
    
    // Calculate progress
    const lastEntry = previousProgress.history[previousProgress.history.length - 1];
    const progress = generateProgressReport(currentData, lastEntry);
    
    // Save current progress
    previousProgress.history.push(currentData);
    
    // Keep only last 50 entries to prevent file from growing too large
    if (previousProgress.history.length > 50) {
      previousProgress.history = previousProgress.history.slice(-50);
    }
    
    saveProgress(previousProgress);
    
    // Save detailed error log
    const detailedLog = {
      timestamp: getCurrentTimestamp(),
      totalErrors: errors.length,
      categories,
      rawOutput: output
    };
    
    fs.writeFileSync(ERRORS_LOG_FILE, JSON.stringify(detailedLog, null, 2));
    
    // Display results
    displayResults(errors, categories, progress);
  });
}

// Check if this module is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main, parseTypeScriptErrors, categorizeErrors };
