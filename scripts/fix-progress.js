
import fs from 'fs';
import path from 'path';

const PROGRESS_FILE = path.join(process.cwd(), 'typescript-progress.json');

function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Could not load progress file:', e.message);
  }
  return null;
}

function displayProgressGraph(history) {
  if (history.length < 2) {
    console.log('📊 Not enough data for progress visualization');
    return;
  }
  
  console.log('\n📈 TypeScript Error Fix Progress');
  console.log('═'.repeat(60));
  
  const maxErrors = Math.max(...history.map(h => h.totalErrors));
  const minErrors = Math.min(...history.map(h => h.totalErrors));
  const totalFixed = history[0].totalErrors - history[history.length - 1].totalErrors;
  
  console.log(`🎯 Goal: 0 errors`);
  console.log(`📊 Started with: ${history[0].totalErrors} errors`);
  console.log(`📊 Current: ${history[history.length - 1].totalErrors} errors`);
  console.log(`✅ Fixed: ${totalFixed} errors`);
  console.log(`📉 Progress: ${((totalFixed / history[0].totalErrors) * 100).toFixed(1)}%\n`);
  
  // ASCII graph
  console.log('Error count over time:');
  history.slice(-20).forEach((entry, i) => {
    const barLength = Math.floor((entry.totalErrors / maxErrors) * 40);
    const bar = '█'.repeat(barLength) + '░'.repeat(40 - barLength);
    const date = new Date(entry.timestamp).toLocaleDateString();
    console.log(`${date} │${bar}│ ${entry.totalErrors}`);
  });
  
  // Category breakdown for latest entry
  const latest = history[history.length - 1];
  if (latest.categories) {
    console.log('\n📋 Current Error Breakdown:');
    Object.entries(latest.categories).forEach(([category, count]) => {
      if (count > 0) {
        const percentage = ((count / latest.totalErrors) * 100).toFixed(1);
        console.log(`   ${category}: ${count} (${percentage}%)`);
      }
    });
  }
  
  // Velocity calculation
  if (history.length >= 3) {
    const recent = history.slice(-3);
    const timeSpan = new Date(recent[2].timestamp) - new Date(recent[0].timestamp);
    const errorsFixed = recent[0].totalErrors - recent[2].totalErrors;
    const hoursSpan = timeSpan / (1000 * 60 * 60);
    
    if (hoursSpan > 0 && errorsFixed > 0) {
      const velocity = errorsFixed / hoursSpan;
      const eta = (latest.totalErrors / velocity);
      
      console.log('\n🚀 Velocity Analysis:');
      console.log(`   Fix Rate: ${velocity.toFixed(1)} errors/hour`);
      console.log(`   ETA to Zero: ${eta.toFixed(1)} hours`);
    }
  }
}

function displayDetailedAnalysis(history) {
  if (history.length < 2) return;
  
  console.log('\n🔍 Detailed Analysis');
  console.log('═'.repeat(40));
  
  const sessions = [];
  for (let i = 1; i < history.length; i++) {
    const current = history[i];
    const previous = history[i - 1];
    const fixed = previous.totalErrors - current.totalErrors;
    
    if (fixed > 0) {
      sessions.push({
        date: new Date(current.timestamp).toLocaleDateString(),
        time: new Date(current.timestamp).toLocaleTimeString(),
        fixed,
        remaining: current.totalErrors
      });
    }
  }
  
  console.log('Recent fixing sessions:');
  sessions.slice(-10).forEach(session => {
    console.log(`   ${session.date} ${session.time}: Fixed ${session.fixed}, ${session.remaining} remaining`);
  });
  
  if (sessions.length > 0) {
    const totalSessionFixed = sessions.reduce((sum, s) => sum + s.fixed, 0);
    const avgFixed = (totalSessionFixed / sessions.length).toFixed(1);
    console.log(`\n📊 Average fixes per session: ${avgFixed}`);
  }
}

function main() {
  const progressData = loadProgress();
  
  if (!progressData || !progressData.history || progressData.history.length === 0) {
    console.log('📊 No progress data found. Run typescript-error-counter first!');
    return;
  }
  
  displayProgressGraph(progressData.history);
  displayDetailedAnalysis(progressData.history);
  
  console.log('\n💡 Tips:');
  console.log('   • Run this after each fixing session to track progress');
  console.log('   • Focus on high-count error categories first');
  console.log('   • Celebrate small wins - every error fixed counts! 🎉');
}

// Check if this module is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
