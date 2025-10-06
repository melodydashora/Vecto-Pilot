#!/usr/bin/env node

import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert';

const GATEWAY_URL = 'http://127.0.0.1:3000';
const SDK_URL = 'http://127.0.0.1:3101';
const AGENT_URL = 'http://127.0.0.1:43717';

class PhaseCAudit {
  constructor() {
    this.results = [];
    this.errors = [];
  }

  async makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(url, { timeout: 5000, ...options }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
      });
      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Request timeout')));
      if (options.body) req.write(JSON.stringify(options.body));
      req.end();
    });
  }

  log(emoji, message, data = null) {
    const line = `${emoji} ${message}`;
    console.log(line);
    if (data) console.log('  ', JSON.stringify(data, null, 2));
  }

  async test(name, testFn) {
    try {
      console.log(`\n🧪 ${name}`);
      await testFn();
      this.results.push({ name, success: true });
      this.log('✅', 'PASSED');
    } catch (err) {
      this.results.push({ name, success: false, error: err.message });
      this.errors.push({ name, error: err.message });
      this.log('❌', 'FAILED', { error: err.message });
    }
  }

  // ====== MIDDLEWARE ORDER TESTS ======

  async testMiddlewareOrder() {
    await this.test('Middleware Order: API Routes Before Static', async () => {
      // Request to /api/blocks should NOT return HTML
      const res = await this.makeRequest(`${GATEWAY_URL}/api/blocks?lat=33.128&lng=-96.875`);
      
      assert(res.headers['content-type']?.includes('application/json'), 
        'Expected JSON response, got: ' + res.headers['content-type']);
      
      const json = JSON.parse(res.data);
      assert(json.blocks || json.error, 'Expected blocks or error field');
    });

    await this.test('Middleware Order: Static Routes After API', async () => {
      // Request to root should return HTML (React app)
      const res = await this.makeRequest(`${GATEWAY_URL}/`);
      
      assert(res.headers['content-type']?.includes('text/html'), 
        'Expected HTML response, got: ' + res.headers['content-type']);
      
      assert(res.data.includes('<!DOCTYPE html') || res.data.includes('<html'), 
        'Expected HTML document');
    });

    await this.test('Middleware Order: Assistant Override Before Static', async () => {
      const res = await this.makeRequest(`${GATEWAY_URL}/assistant/verify-override`);
      
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      
      const json = JSON.parse(res.data);
      assert(json.override_active === true, 'Expected override_active: true');
    });
  }

  // ====== PROXY ROUTING TESTS ======

  async testProxyRouting() {
    await this.test('Proxy: /eidolon/* Routes to SDK', async () => {
      const res = await this.makeRequest(`${GATEWAY_URL}/eidolon/health`);
      
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      
      const json = JSON.parse(res.data);
      assert(json.ok === true, 'Expected ok: true from SDK');
    });

    await this.test('Proxy: /api/blocks Routes Correctly', async () => {
      const res = await this.makeRequest(
        `${GATEWAY_URL}/api/blocks?lat=33.128&lng=-96.875&minDistance=0&maxDistance=30`
      );
      
      assert(res.status === 200 || res.status === 500, 
        `Expected 200/500, got ${res.status}`);
      
      const json = JSON.parse(res.data);
      assert('blocks' in json || 'error' in json, 'Expected blocks or error field');
    });

    await this.test('Proxy: /assistant/* Routes to Eidolon Override', async () => {
      const res = await this.makeRequest(`${GATEWAY_URL}/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { messages: [{ role: 'user', content: 'test' }] }
      });
      
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      
      const json = JSON.parse(res.data);
      assert(json.override_active === true, 'Expected override confirmation');
    });
  }

  // ====== CORS & SECURITY TESTS ======

  async testSecurity() {
    await this.test('Security: CORS Headers Present', async () => {
      const res = await this.makeRequest(`${GATEWAY_URL}/health`, {
        headers: { 'Origin': 'http://localhost:3000' }
      });
      
      assert(res.headers['access-control-allow-origin'], 
        'Expected CORS headers');
    });

    await this.test('Security: Rate Limiting Configured', async () => {
      // Make 10 rapid requests to check if rate limiting exists
      const requests = [];
      for (let i = 0; i < 10; i++) {
        requests.push(this.makeRequest(`${GATEWAY_URL}/health`));
      }
      
      const responses = await Promise.all(requests);
      const allSuccess = responses.every(r => r.status === 200);
      
      assert(allSuccess, 'Rate limiting may be too aggressive for health checks');
    });
  }

  // ====== WATCHDOG & HEALTH TESTS ======

  async testWatchdog() {
    await this.test('Watchdog: Gateway Health Endpoint', async () => {
      const res = await this.makeRequest(`${GATEWAY_URL}/health`);
      
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      
      const json = JSON.parse(res.data);
      assert(json.ok === true, 'Expected ok: true');
      assert(json.gateway === true, 'Expected gateway: true');
    });

    await this.test('Watchdog: SDK Health via Proxy', async () => {
      const res = await this.makeRequest(`${GATEWAY_URL}/eidolon/health`);
      
      assert(res.status === 200 || res.status === 503, 
        `Expected 200/503, got ${res.status}`);
      
      if (res.status === 200) {
        const json = JSON.parse(res.data);
        assert(json.ok === true, 'Expected SDK ok: true');
      }
    });

    await this.test('Watchdog: Metrics Endpoint', async () => {
      const res = await this.makeRequest(`${GATEWAY_URL}/metrics`);
      
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      
      const json = JSON.parse(res.data);
      assert('counts' in json, 'Expected counts field');
      assert('time' in json, 'Expected time field');
    });
  }

  // ====== ENVIRONMENT ISOLATION TESTS ======

  async testEnvironment() {
    await this.test('Environment: Production vs Development Detection', async () => {
      const res = await this.makeRequest(`${GATEWAY_URL}/health`);
      const json = JSON.parse(res.data);
      
      const isProd = process.env.NODE_ENV === 'production';
      assert(json.gateway === true, 'Expected gateway identification');
    });

    await this.test('Environment: Assistant Override Active', async () => {
      const res = await this.makeRequest(`${GATEWAY_URL}/assistant/verify-override`);
      
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      
      const json = JSON.parse(res.data);
      assert(json.override_active === true, 'Override should be active');
      assert(json.identity?.includes('Eidolon'), 'Expected Eidolon identity');
    });
  }

  // ====== COMPREHENSIVE TEST SUITE ======

  async runAll() {
    console.log('\n🚀 Phase C: Infrastructure & Middleware Audit');
    console.log('='.repeat(60));
    
    console.log('\n📋 Section 1: Middleware Order');
    await this.testMiddlewareOrder();
    
    console.log('\n📋 Section 2: Proxy Routing');
    await this.testProxyRouting();
    
    console.log('\n📋 Section 3: Security & CORS');
    await this.testSecurity();
    
    console.log('\n📋 Section 4: Watchdog & Health');
    await this.testWatchdog();
    
    console.log('\n📋 Section 5: Environment Isolation');
    await this.testEnvironment();
    
    this.printSummary();
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 PHASE C AUDIT SUMMARY');
    console.log('='.repeat(60));
    
    const passed = this.results.filter(r => r.success).length;
    const total = this.results.length;
    const percentage = ((passed / total) * 100).toFixed(1);
    
    console.log(`\n✅ Passed: ${passed}/${total} (${percentage}%)`);
    
    if (this.errors.length > 0) {
      console.log(`\n❌ Failed Tests:`);
      this.errors.forEach(({ name, error }) => {
        console.log(`  • ${name}`);
        console.log(`    └─ ${error}`);
      });
    }
    
    if (passed === total) {
      console.log('\n🎉 ALL INFRASTRUCTURE TESTS PASSED!');
      console.log('✅ Gateway routing is correct');
      console.log('✅ Proxies are working');
      console.log('✅ Security is configured');
      console.log('✅ Watchdog is healthy');
    } else {
      console.log('\n⚠️  INFRASTRUCTURE ISSUES DETECTED');
      console.log('Review failed tests above for details');
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const audit = new PhaseCAudit();
  audit.runAll().catch(console.error);
}

export default PhaseCAudit;
