
import http from 'node:http';
import assert from 'node:assert';

const BASE_URL = 'http://127.0.0.1:3000';
const SDK_URL = 'http://127.0.0.1:3101';

class GatewayTester {
  constructor() {
    this.results = [];
  }

  async test(name, url, expectedStatus = 200) {
    console.log(`Testing: ${name}`);
    try {
      const response = await this.makeRequest(url);
      const success = response.statusCode === expectedStatus;
      
      this.results.push({
        name,
        url,
        status: response.statusCode,
        expected: expectedStatus,
        success,
        timestamp: new Date().toISOString()
      });

      console.log(`  ${success ? '✅' : '❌'} ${response.statusCode} - ${name}`);
      return success;
    } catch (err) {
      console.log(`  ❌ ERROR - ${name}: ${err.message}`);
      this.results.push({
        name,
        url,
        error: err.message,
        success: false,
        timestamp: new Date().toISOString()
      });
      return false;
    }
  }

  makeRequest(url) {
    return new Promise((resolve, reject) => {
      const req = http.get(url, { timeout: 5000 }, resolve);
      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Request timeout')));
    });
  }

  async runAllTests() {
    console.log('🧪 Gateway Routing Test Suite');
    console.log('=============================\n');

    // Basic health checks
    await this.test('Gateway Health', `${BASE_URL}/health`);
    
    // Proxy routing tests
    await this.test('Eidolon Proxy Health', `${BASE_URL}/eidolon/health`);
    await this.test('Assistant Override', `${BASE_URL}/assistant/verify-override`);
    await this.test('API Health via Proxy', `${BASE_URL}/api/health`);
    
    // Direct SDK tests (internal)
    await this.test('Direct SDK Health', `${SDK_URL}/health`);
    
    // Negative tests
    await this.test('Non-existent Route', `${BASE_URL}/nonexistent`, 404);

    this.printSummary();
    return this.results;
  }

  printSummary() {
    const passed = this.results.filter(r => r.success).length;
    const total = this.results.length;
    
    console.log('\n📊 Test Summary');
    console.log('================');
    console.log(`Passed: ${passed}/${total}`);
    console.log(`Success Rate: ${((passed/total) * 100).toFixed(1)}%`);
    
    if (passed === total) {
      console.log('🎉 All tests passed!');
    } else {
      console.log('⚠️  Some tests failed. Check logs above.');
    }
  }
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new GatewayTester();
  tester.runAllTests().catch(console.error);
}

export default GatewayTester;
