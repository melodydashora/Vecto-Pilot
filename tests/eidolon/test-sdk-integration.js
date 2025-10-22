
import fetch from 'node-fetch';

class EidolonSDKTester {
  constructor() {
    this.baseUrl = process.env.EIDOLON_PORT ? 
      `http://127.0.0.1:${process.env.EIDOLON_PORT}` : 
      'http://127.0.0.1:3101';
    this.results = [];
  }

  async testHealth() {
    console.log('Testing SDK Health...');
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        timeout: 5000
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ SDK Health:', data);
        return true;
      } else {
        console.log('❌ SDK Health failed:', response.status);
        return false;
      }
    } catch (err) {
      console.log('❌ SDK Health error:', err.message);
      return false;
    }
  }

  async testAssistantEndpoint() {
    console.log('Testing Assistant Endpoint...');
    try {
      const response = await fetch(`${this.baseUrl}/api/assistant/verify-override`, {
        timeout: 5000
      });
      
      const success = response.status !== 404;
      console.log(`${success ? '✅' : '❌'} Assistant endpoint:`, response.status);
      return success;
    } catch (err) {
      console.log('❌ Assistant endpoint error:', err.message);
      return false;
    }
  }

  async runAllTests() {
    console.log('🧠 Eidolon SDK Integration Tests');
    console.log('=================================\n');

    const healthOk = await this.testHealth();
    const assistantOk = await this.testAssistantEndpoint();

    const passed = [healthOk, assistantOk].filter(Boolean).length;
    const total = 2;

    console.log('\n📊 SDK Test Summary');
    console.log('===================');
    console.log(`Passed: ${passed}/${total}`);
    
    if (passed === total) {
      console.log('🎉 All SDK tests passed!');
    } else {
      console.log('⚠️  Some SDK tests failed.');
    }

    return { passed, total, success: passed === total };
  }
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new EidolonSDKTester();
  tester.runAllTests().catch(console.error);
}

export default EidolonSDKTester;
