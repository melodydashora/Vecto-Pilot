// server/routes/health.js
import { Router } from "express";
import { routerDiagnosticsV2 } from "../lib/llm-router-v2.js";
import { getPoolStats, getSharedPool } from "../db/pool.js";
import { getAgentState } from "../db/connection-manager.js";
import { providers } from "../lib/strategies/index.js";
import { ndjson } from "../logger/ndjson.js";

const router = Router();

// Root diagnostics endpoint
router.get("/", (req, res) => {
  const diag = routerDiagnosticsV2();
  const poolStats = getPoolStats();
  res.json({
    ok: true,
    service: "Vecto Co-Pilot API",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    pool: poolStats,
    pid: process.pid,
    llm: diag,
  });
});

// PostgreSQL pool statistics endpoint
router.get("/pool-stats", (req, res) => {
  const stats = getPoolStats();
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    pool: stats,
  });
});

// Strategy provider registry health check
router.get("/strategies", (req, res) => {
  const providerStatus = {};
  for (const [name, fn] of Object.entries(providers)) {
    providerStatus[name] = {
      registered: true,
      isFunction: typeof fn === "function",
      status: typeof fn === "function" ? "ready" : "invalid",
    };
  }
  const allReady = Object.values(providerStatus).every(
    (p) => p.status === "ready",
  );
  res.json({
    ok: allReady,
    status: allReady ? "ok" : "degraded",
    providers: providerStatus,
    availableProviders: Object.keys(providers),
    timestamp: new Date().toISOString(),
  });
});

// Prometheus metrics endpoint
router.get("/metrics", (req, res) => {
  try {
    const poolStats = getPoolStats();
    const memUsage = process.memoryUsage();
    const metrics = [
      "# HELP db_connections Database connection pool metrics",
      "# TYPE db_connections gauge",
      `db_connections_idle{pool="main"} ${poolStats.idle || 0}`,
      `db_connections_active{pool="main"} ${(poolStats.total || 0) - (poolStats.idle || 0)}`,
      `db_connections_total{pool="main"} ${poolStats.total || 0}`,
      `db_connections_waiting{pool="main"} ${poolStats.waiting || 0}`,
      `db_connections_max{pool="main"} ${poolStats.max || 25}`,
      "",
      "# HELP process_uptime_seconds Process uptime in seconds",
      "# TYPE process_uptime_seconds gauge",
      `process_uptime_seconds ${process.uptime().toFixed(2)}`,
      "",
      "# HELP process_memory_bytes Process memory usage in bytes",
      "# TYPE process_memory_bytes gauge",
      `process_memory_rss_bytes ${memUsage.rss}`,
      `process_memory_heap_used_bytes ${memUsage.heapUsed}`,
      `process_memory_heap_total_bytes ${memUsage.heapTotal}`,
    ];
    res.set("Content-Type", "text/plain; version=0.0.4");
    res.send(metrics.join("\n") + "\n");
  } catch (error) {
    console.error("[Metrics] Error:", error.message);
    res.status(500).send("# Error collecting metrics\n");
  }
});

export default router;

// Health + readiness routes
export function healthRoutes(app) {
  app.get("/health", async (req, res) => {
    const { degraded, lastEvent } = getAgentState();
    if (degraded) {
      ndjson("health.degraded", { lastEvent });
      return res.status(503).json({
        state: "degraded",
        lastEvent,
        timestamp: new Date().toISOString(),
      });
    }
    try {
      const pool = getSharedPool();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Health probe timeout")), 3000),
      );
      const queryPromise = pool.query("SELECT 1");
      await Promise.race([queryPromise, timeoutPromise]);
      ndjson("health.ok", {});
      return res.status(200).json({
        state: "healthy",
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || "development",
      });
    } catch (e) {
      ndjson("health.probe.error", { error: String(e.message || e) });
      return res.status(503).json({
        state: "degraded",
        lastEvent: "health.probe.error",
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get("/ready", async (req, res) => {
    const { degraded, lastEvent } = getAgentState();
    if (degraded) {
      return res.status(503).json({
        status: "not_ready",
        reason: "database_degraded",
        lastEvent,
        timestamp: new Date().toISOString(),
      });
    }
    try {
      const pool = getSharedPool();
      await pool.query("SELECT 1");
      return res.json({
        ok: true,
        status: "ready",
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      return res.status(503).json({
        status: "not_ready",
        reason: "database_error",
        error: e.message,
        timestamp: new Date().toISOString(),
      });
    }
  });
}
