
#!/usr/bin/env node
import 'dotenv/config';
import { SelfHealingMonitor } from './self-healing-monitor.js';

const MONITOR_INTERVAL_MS = 60000; // Run every 60 seconds

async function continuousMonitor() {
  console.log('🔄 Starting continuous monitoring (60s intervals)...\n');

  while (true) {
    const monitor = new SelfHealingMonitor();
    
    try {
      await monitor.run();
    } catch (err) {
      console.error('❌ Monitor cycle failed:', err.message);
    }

    // Wait for next cycle
    await new Promise(resolve => setTimeout(resolve, MONITOR_INTERVAL_MS));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  continuousMonitor();
}
