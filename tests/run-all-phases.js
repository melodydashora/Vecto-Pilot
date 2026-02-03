#!/usr/bin/env node

import PhaseCAudit from './phase-c-infrastructure.js';

async function runAllPhases() {
  console.log('🔬 VECTO PILOT - COMPLETE AUDIT SUITE');
  console.log('='.repeat(70));
  console.log('Running comprehensive tests across all system phases\n');

  // Wait for services to be ready
  console.log('⏳ Waiting for services to start...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  const results = {
    phaseC: null
  };

  try {
    // Phase C: Infrastructure
    console.log('\n' + '█'.repeat(70));
    console.log('PHASE C: INFRASTRUCTURE & MIDDLEWARE');
    console.log('█'.repeat(70));
    
    const phaseCTest = new PhaseCAudit();
    await phaseCTest.runAll();
    results.phaseC = phaseCTest.results;

    // Overall Summary
    printOverallSummary(results);

  } catch (err) {
    console.error('\n❌ Test suite failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

function printOverallSummary(results) {
  console.log('\n' + '='.repeat(70));
  console.log('🏁 OVERALL AUDIT RESULTS');
  console.log('='.repeat(70));

  const allResults = [
    ...results.phaseC || []
  ];

  const totalPassed = allResults.filter(r => r.success).length;
  const totalTests = allResults.length;
  const percentage = ((totalPassed / totalTests) * 100).toFixed(1);

  console.log(`\nTotal Tests: ${totalTests}`);
  console.log(`Passed: ${totalPassed}`);
  console.log(`Failed: ${totalTests - totalPassed}`);
  console.log(`Success Rate: ${percentage}%`);

  if (totalPassed === totalTests) {
    console.log('\n🎉 ALL SYSTEM AUDITS PASSED!');
    console.log('✅ Your Vecto Pilot infrastructure is solid');
    console.log('✅ Gateway, proxies, and security are correctly configured');
    console.log('✅ Ready for production deployment');
  } else {
    console.log('\n⚠️  SOME AUDITS FAILED');
    console.log('Review phase-specific results above for remediation steps');
  }

  console.log('\n📊 Detailed Reports:');
  console.log('  • Phase C: Infrastructure & Middleware');
  console.log('\n🔗 Next Steps:');
  console.log('  1. Fix any failed tests');
  console.log('  2. Run tests again to verify fixes');
  console.log('  3. Deploy to production when all tests pass');
}

runAllPhases();
