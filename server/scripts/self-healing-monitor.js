
import 'dotenv/config';
import { db } from '../db/drizzle.js';
import { snapshots, strategies } from '../../shared/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { setTimeout } from 'timers/promises';

const REQUIRED_SNAPSHOT_FIELDS = [
  'snapshot_id', 'created_at', 'device_id', 'session_id', 'lat', 'lng',
  'coord_source', 'city', 'state', 'day_part_key', 'weather', 'air'
];

const REQUIRED_STRATEGY_FIELDS = [
  'id', 'snapshot_id', 'strategy', 'status', 'created_at'
];

const GPT5_EXPECTED_FIELDS = [
  'snapshot_id', 'strategy', 'created_at', 'day_part_key', 'weather', 'city', 'state'
];

class SelfHealingMonitor {
  constructor() {
    this.warnings = [];
    this.fixes = [];
  }

  log(type, message, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      type,
      message,
      data
    };
    
    if (type === 'warning') {
      this.warnings.push(entry);
      console.warn(`⚠️  [HEAL] ${message}`, data);
    } else if (type === 'fix') {
      this.fixes.push(entry);
      console.log(`✅ [HEAL] ${message}`, data);
    } else {
      console.log(`ℹ️  [HEAL] ${message}`, data);
    }
  }

  async validateDatabaseSchema() {
    console.log('\n🔍 Validating database schema...\n');

    try {
      // Check snapshots table
      const snapshotColumns = await db.execute(sql`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'snapshots'
        ORDER BY ordinal_position
      `);

      const snapshotFields = snapshotColumns.rows.map(r => r.column_name);
      const missingSnapshot = REQUIRED_SNAPSHOT_FIELDS.filter(f => !snapshotFields.includes(f));

      if (missingSnapshot.length > 0) {
        this.log('warning', 'Missing snapshot fields detected', { missing: missingSnapshot });
      } else {
        this.log('fix', 'All required snapshot fields present', { fields: REQUIRED_SNAPSHOT_FIELDS.length });
      }

      // Check strategies table
      const strategyColumns = await db.execute(sql`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'strategies'
        ORDER BY ordinal_position
      `);

      const strategyFields = strategyColumns.rows.map(r => r.column_name);
      const missingStrategy = REQUIRED_STRATEGY_FIELDS.filter(f => !strategyFields.includes(f));

      if (missingStrategy.length > 0) {
        this.log('warning', 'Missing strategy fields detected', { missing: missingStrategy });
      } else {
        this.log('fix', 'All required strategy fields present', { fields: REQUIRED_STRATEGY_FIELDS.length });
      }

      return { snapshotFields, strategyFields };
    } catch (err) {
      this.log('warning', 'Database schema validation failed', { error: err.message });
      throw err;
    }
  }

  async validatePipelineFlow() {
    console.log('\n🔄 Validating snapshot → strategy → GPT-5 pipeline...\n');

    try {
      // Get recent snapshots
      const recentSnapshots = await db
        .select()
        .from(snapshots)
        .orderBy(desc(snapshots.created_at))
        .limit(10);

      if (recentSnapshots.length === 0) {
        this.log('info', 'No snapshots found - pipeline not yet active');
        return;
      }

      // Check each snapshot for strategy
      for (const snap of recentSnapshots) {
        const strategy = await db
          .select()
          .from(strategies)
          .where(eq(strategies.snapshot_id, snap.snapshot_id))
          .limit(1);

        if (strategy.length === 0) {
          this.log('warning', 'Snapshot missing strategy', {
            snapshot_id: snap.snapshot_id,
            created_at: snap.created_at
          });
          
          // Attempt to trigger strategy generation
          await this.healMissingStrategy(snap.snapshot_id);
        } else {
          // Validate strategy has all fields needed for GPT-5
          const strat = strategy[0];
          const missingFields = [];

          if (!strat.strategy) missingFields.push('strategy');
          if (!snap.day_part_key) missingFields.push('day_part_key');
          if (!snap.weather) missingFields.push('weather');
          if (!snap.city) missingFields.push('city');

          if (missingFields.length > 0) {
            this.log('warning', 'Strategy missing fields for GPT-5', {
              snapshot_id: snap.snapshot_id,
              strategy_id: strat.id,
              missing: missingFields
            });
          } else {
            this.log('fix', 'Pipeline valid for snapshot', {
              snapshot_id: snap.snapshot_id,
              strategy_status: strat.status
            });
          }
        }
      }
    } catch (err) {
      this.log('warning', 'Pipeline validation failed', { error: err.message });
    }
  }

  async healMissingStrategy(snapshot_id) {
    try {
      // Check if strategy generation is already in progress
      const existing = await db
        .select()
        .from(strategies)
        .where(eq(strategies.snapshot_id, snapshot_id))
        .limit(1);

      if (existing.length > 0 && existing[0].status === 'pending') {
        this.log('info', 'Strategy generation already in progress', { snapshot_id });
        return;
      }

      // Trigger strategy generation via internal API
      const response = await fetch(`http://127.0.0.1:${process.env.GATEWAY_PORT || 5000}/api/blocks/strategy/${snapshot_id}`, {
        method: 'POST'
      });

      if (response.ok) {
        this.log('fix', 'Triggered strategy generation', { snapshot_id });
      } else {
        this.log('warning', 'Failed to trigger strategy generation', {
          snapshot_id,
          status: response.status
        });
      }
    } catch (err) {
      this.log('warning', 'Strategy healing failed', {
        snapshot_id,
        error: err.message
      });
    }
  }

  async checkForeignKeyIntegrity() {
    console.log('\n🔗 Checking foreign key integrity...\n');

    try {
      // Check for orphaned strategies (snapshot deleted but strategy remains)
      const orphanedStrategies = await db.execute(sql`
        SELECT s.id, s.snapshot_id, s.status
        FROM strategies s
        LEFT JOIN snapshots snap ON s.snapshot_id = snap.snapshot_id
        WHERE snap.snapshot_id IS NULL
        LIMIT 10
      `);

      if (orphanedStrategies.rows.length > 0) {
        this.log('warning', 'Orphaned strategies detected', {
          count: orphanedStrategies.rows.length,
          strategies: orphanedStrategies.rows.map(r => r.id)
        });

        // Auto-cleanup orphaned strategies
        for (const orphan of orphanedStrategies.rows) {
          await db.delete(strategies).where(eq(strategies.id, orphan.id));
          this.log('fix', 'Cleaned up orphaned strategy', { id: orphan.id });
        }
      } else {
        this.log('fix', 'No orphaned strategies found');
      }

      // Check cascade behavior
      const cascadeCheck = await db.execute(sql`
        SELECT conname, confdeltype, confupdtype
        FROM pg_constraint
        WHERE contype='f' AND conname LIKE '%strategies%'
      `);

      for (const constraint of cascadeCheck.rows) {
        if (constraint.confdeltype !== 'c') {
          this.log('warning', 'Foreign key missing CASCADE delete', {
            constraint: constraint.conname
          });
        } else {
          this.log('fix', 'CASCADE behavior verified', {
            constraint: constraint.conname
          });
        }
      }
    } catch (err) {
      this.log('warning', 'FK integrity check failed', { error: err.message });
    }
  }

  async generateReport() {
    console.log('\n📊 Self-Healing Report\n');
    console.log('='.repeat(60));
    
    console.log(`\n✅ Fixes Applied: ${this.fixes.length}`);
    this.fixes.forEach(fix => {
      console.log(`   - ${fix.message}`);
    });

    console.log(`\n⚠️  Warnings: ${this.warnings.length}`);
    this.warnings.forEach(warn => {
      console.log(`   - ${warn.message}`);
      if (Object.keys(warn.data).length > 0) {
        console.log(`     ${JSON.stringify(warn.data, null, 2)}`);
      }
    });

    console.log('\n' + '='.repeat(60) + '\n');

    // Save report to file
    const report = {
      timestamp: new Date().toISOString(),
      fixes: this.fixes,
      warnings: this.warnings,
      summary: {
        total_fixes: this.fixes.length,
        total_warnings: this.warnings.length,
        critical: this.warnings.filter(w => w.message.includes('missing')).length
      }
    };

    const fs = await import('fs/promises');
    const reportPath = `data/self-healing-reports/${Date.now()}.json`;
    await fs.mkdir('data/self-healing-reports', { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`📄 Report saved to: ${reportPath}\n`);
    
    return report;
  }

  async run() {
    console.log('\n🚀 Starting Self-Healing Monitor...\n');
    
    try {
      // 1. Validate schema
      await this.validateDatabaseSchema();
      await setTimeout(1000);

      // 2. Check pipeline flow
      await this.validatePipelineFlow();
      await setTimeout(1000);

      // 3. Check FK integrity
      await this.checkForeignKeyIntegrity();
      await setTimeout(1000);

      // 4. Generate report
      const report = await this.generateReport();

      // Exit with error code if critical issues found
      if (report.summary.critical > 0) {
        console.error('❌ Critical issues detected - manual intervention required\n');
        process.exit(1);
      }

      console.log('✅ Self-healing complete\n');
      process.exit(0);
    } catch (err) {
      console.error('💥 Self-healing failed:', err.message);
      process.exit(1);
    }
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const monitor = new SelfHealingMonitor();
  monitor.run();
}

export { SelfHealingMonitor };
