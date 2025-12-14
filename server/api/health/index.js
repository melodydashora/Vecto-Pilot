// server/api/health/index.js - Barrel exports for health routes
// Health endpoints: probes, diagnostics, metrics

export { default as healthRouter } from './health.js';
export { default as diagnosticsRouter } from './diagnostics.js';
export { default as diagnosticsStrategyRouter } from './diagnostics-strategy.js';
export { default as diagnosticIdentityRouter } from './diagnostic-identity.js';
export { default as mlHealthRouter } from './ml-health.js';
export { default as jobMetricsRouter } from './job-metrics.js';
export { default as unifiedCapabilitiesRouter } from './unified-capabilities.js';

// Route summary:
// GET / - Health probe
// GET /health - Health probe
// GET /ready - Readiness probe
// GET /api/diagnostics/* - Debug endpoints
// GET /api/diagnostic/identity - Identity debugging
// GET /api/ml/* - ML model health
// GET /api/job-metrics - Background job stats
// GET /capabilities - AI capabilities
