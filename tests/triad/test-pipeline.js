import fetch from 'node-fetch';
import assert from 'node:assert';

const BASE_URL = 'http://127.0.0.1:5000';

class TriadPipelineTester {
  constructor() {
    this.results = [];
  }

  async test(name, testFn) {
    console.log(`\n🧪 ${name}`);
    try {
      await testFn();
      this.results.push({ name, success: true });
      console.log('  ✅ PASSED');
    } catch (err) {
      this.results.push({ name, success: false, error: err.message });
      console.error('  ❌ FAILED:', err.message);
    }
  }

  async makeRequest(path, options = {}) {
    const response = await fetch(`${BASE_URL}${path}`, {
      timeout: 30000,
      ...options
    });
    const data = await response.json();
    return { status: response.status, data };
  }

  async testFullPipeline() {
    await this.test('Full Pipeline: Snapshot → Strategy → Blocks', async () => {
      // Step 1: Create snapshot
      const snapshotRes = await this.makeRequest('/api/location/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: 33.128,
          lng: -96.875,
          city: 'Frisco',
          timezone: 'America/Chicago',
          dayPart: 'evening',
          isWeekend: false,
          weather: '75°F',
          airQuality: 'Good'
        })
      });

      assert.strictEqual(snapshotRes.status, 200, 'Snapshot creation should succeed');
      assert(snapshotRes.data.snapshot_id, 'Should return snapshot_id');

      const snapshotId = snapshotRes.data.snapshot_id;

      // Step 2: Poll for strategy completion (max 60 seconds)
      let strategy = null;
      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const strategyRes = await this.makeRequest(`/api/blocks/strategy/${snapshotId}`);
        
        if (strategyRes.data.status === 'complete') {
          strategy = strategyRes.data;
          break;
        }
      }

      assert(strategy, 'Strategy should complete within 60 seconds');
      assert(strategy.strategy, 'Should have strategy text');
      assert(strategy.blocks?.length >= 3, 'Should have at least 3 venue recommendations');

      // Step 3: Verify blocks have required fields
      const firstBlock = strategy.blocks[0];
      assert(firstBlock.name, 'Block should have name');
      assert(firstBlock.address, 'Block should have address');
      assert(firstBlock.coordinates, 'Block should have coordinates');
      assert(typeof firstBlock.estimatedEarningsPerRide === 'number', 'Should have earnings estimate');
      assert(firstBlock.proTips?.length > 0, 'Should have pro tips');
    });

    await this.test('Claude Strategist: Context-aware strategy generation', async () => {
      const res = await this.makeRequest('/api/location/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: 32.776,
          lng: -96.797,
          city: 'Dallas',
          timezone: 'America/Chicago',
          dayPart: 'night',
          isWeekend: true,
          weather: '68°F'
        })
      });

      assert.strictEqual(res.status, 200);
      const snapshotId = res.data.snapshot_id;

      // Wait for strategy
      let strategyData = null;
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const strategyRes = await this.makeRequest(`/api/blocks/strategy/${snapshotId}`);
        if (strategyRes.data.status === 'complete') {
          strategyData = strategyRes.data;
          break;
        }
      }

      assert(strategyData, 'Should generate strategy');
      assert(strategyData.strategy.includes('Dallas'), 'Strategy should mention city');
      assert(strategyData.strategy.includes('night') || strategyData.strategy.includes('evening'), 
        'Strategy should mention time of day');
    });

    await this.test('GPT-5 Planner: Venue recommendations from strategy', async () => {
      // Use existing strategy from previous test or create new one
      const res = await this.makeRequest('/api/blocks?lat=33.128&lng=-96.875');
      
      assert.strictEqual(res.status, 200);
      assert(res.data.blocks?.length >= 3, 'Should return multiple venue recommendations');
      
      const block = res.data.blocks[0];
      assert(block.category, 'Should categorize venues');
      assert(block.estimatedWaitTime >= 0, 'Should estimate wait time');
      assert(block.demandLevel, 'Should indicate demand level');
    });

    await this.test('Gemini Enricher: Business hours and earnings validation', async () => {
      const res = await this.makeRequest('/api/blocks?lat=33.128&lng=-96.875');
      
      const enrichedBlock = res.data.blocks?.find(b => b.businessHours);
      assert(enrichedBlock, 'At least one block should have business hours');
      assert(typeof enrichedBlock.isOpen === 'boolean', 'Should determine if venue is open');
      assert(typeof enrichedBlock.estimatedEarningsPerRide === 'number', 'Should calculate earnings');
    });
  }

  async testErrorPaths() {
    await this.test('Error: Invalid snapshot data', async () => {
      const res = await this.makeRequest('/api/location/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 999, lng: 999 }) // Invalid coordinates
      });

      assert.strictEqual(res.status, 400, 'Should reject invalid data');
      assert(res.data.error, 'Should return error message');
    });

    await this.test('Error: Missing required fields', async () => {
      const res = await this.makeRequest('/api/location/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 33.128 }) // Missing lng
      });

      assert.strictEqual(res.status, 400);
      assert(res.data.fields_missing?.includes('lng'), 'Should identify missing fields');
    });
  }

  async testRetryLogic() {
    await this.test('Retry: Duplicate snapshot request race condition', async () => {
      const snapshotData = {
        lat: 33.128,
        lng: -96.875,
        city: 'Frisco',
        timezone: 'America/Chicago',
        dayPart: 'evening',
        isWeekend: false
      };

      // Fire 3 identical requests simultaneously
      const requests = [
        this.makeRequest('/api/location/snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snapshotData)
        }),
        this.makeRequest('/api/location/snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snapshotData)
        }),
        this.makeRequest('/api/location/snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snapshotData)
        })
      ];

      const responses = await Promise.all(requests);
      
      // All should succeed
      responses.forEach(res => {
        assert.strictEqual(res.status, 200, 'All requests should succeed');
      });

      // Get unique snapshot IDs
      const snapshotIds = new Set(responses.map(r => r.data.snapshot_id));
      assert.strictEqual(snapshotIds.size, 3, 'Should create 3 unique snapshots');
    });
  }

  async runAll() {
    console.log('\n🚀 Triad Pipeline Integration Tests');
    console.log('='.repeat(60));

    console.log('\n📋 Full Pipeline Tests');
    await this.testFullPipeline();

    console.log('\n📋 Error Path Tests');
    await this.testErrorPaths();

    console.log('\n📋 Retry Logic Tests');
    await this.testRetryLogic();

    this.printSummary();
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 TRIAD PIPELINE TEST SUMMARY');
    console.log('='.repeat(60));

    const passed = this.results.filter(r => r.success).length;
    const total = this.results.length;
    const percentage = ((passed / total) * 100).toFixed(1);

    console.log(`\n✅ Passed: ${passed}/${total} (${percentage}%)`);

    if (passed === total) {
      console.log('\n🎉 ALL TRIAD PIPELINE TESTS PASSED!');
    } else {
      console.log('\n⚠️ Some tests failed. Review output above.');
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new TriadPipelineTester();
  tester.runAll().catch(console.error);
}

export default TriadPipelineTester;
