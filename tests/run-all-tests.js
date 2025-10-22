
import GatewayTester from './gateway/test-routing.js';
import EidolonSDKTester from './eidolon/test-sdk-integration.js';

async function runAllTests() {
  console.log('🚀 Running Complete Test Suite');
  console.log('===============================\n');

  // Wait for services to be ready
  console.log('⏳ Waiting for services to start...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  try {
    // Run Gateway Tests
    const gatewayTester = new GatewayTester();
    const gatewayResults = await gatewayTester.runAllTests();

    console.log('\n' + '='.repeat(50) + '\n');

    // Run SDK Tests
    const sdkTester = new EidolonSDKTester();
    const sdkResults = await sdkTester.runAllTests();

    // Overall Summary
    const totalPassed = gatewayResults.filter(r => r.success).length + 
                       (sdkResults.success ? sdkResults.passed : 0);
    const totalTests = gatewayResults.length + sdkResults.total;

    console.log('\n' + '='.repeat(50));
    console.log('🏁 FINAL TEST RESULTS');
    console.log('='.repeat(50));
    console.log(`Total Passed: ${totalPassed}/${totalTests}`);
    console.log(`Overall Success Rate: ${((totalPassed/totalTests) * 100).toFixed(1)}%`);

    if (totalPassed === totalTests) {
      console.log('🎉 ALL SYSTEMS GO! Gateway and SDK are working perfectly.');
    } else {
      console.log('⚠️  Some issues detected. Check individual test results above.');
    }

  } catch (err) {
    console.error('❌ Test suite failed:', err.message);
    process.exit(1);
  }
}

runAllTests();
