/**
 * AUDIT LOGGING (Runtime-Fresh Spec Compliance)
 * 
 * Single-line format:
 * user=undefined {request_id} {active_snapshot_id} {lat},{lng} "{address}" 
 * {valid_window.start}→{valid_window.end} catalog={flags.catalog_resolution} 
 * events={events_resolution} freshness={flags.freshness} no_mem={flags.no_historical_bleed}
 */

import { createLogger, format, transports } from 'winston';

/**
 * Create audit logger with single-line format
 */
const auditLogger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.printf(({ timestamp, message }) => `[${timestamp}] ${message}`)
  ),
  transports: [
    new transports.File({ filename: 'logs/audit.log', maxsize: 10485760, maxFiles: 5 }),
    new transports.Console()
  ]
});

/**
 * Log strategy generation audit entry
 * @param {Object} params - Audit parameters
 */
export function logStrategyAudit({
  requestId,
  snapshotId,
  lat,
  lng,
  address,
  validWindowStart,
  validWindowEnd,
  catalogResolution = 'unknown',
  eventsResolution = 'none',
  freshness = false,
  noHistoricalBleed = false,
  user = 'undefined',
  reasonCodes = []
}) {
  // Format timestamps
  const windowStart = validWindowStart ? new Date(validWindowStart).toISOString() : 'null';
  const windowEnd = validWindowEnd ? new Date(validWindowEnd).toISOString() : 'null';

  // Build single-line audit message
  const auditLine = [
    `user=${user}`,
    requestId || 'no-request-id',
    snapshotId || 'no-snapshot-id',
    `${lat?.toFixed(6) || '0.000000'},${lng?.toFixed(6) || '0.000000'}`,
    `"${address || 'no-address'}"`,
    `${windowStart}→${windowEnd}`,
    `catalog=${catalogResolution}`,
    `events=${eventsResolution}`,
    `freshness=${freshness}`,
    `no_mem=${noHistoricalBleed}`,
    reasonCodes.length > 0 ? `reasons=[${reasonCodes.join(',')}]` : ''
  ].filter(Boolean).join(' ');

  auditLogger.info(auditLine);
}

/**
 * Log validation failure
 * @param {Object} params - Failure parameters
 */
export function logValidationFailure({
  requestId,
  snapshotId,
  errors = [],
  user = 'undefined'
}) {
  const errorSummary = errors.join('; ');
  const auditLine = [
    `user=${user}`,
    requestId || 'no-request-id',
    snapshotId || 'no-snapshot-id',
    `VALIDATION_FAILED`,
    `errors="${errorSummary}"`
  ].join(' ');

  auditLogger.error(auditLine);
}

/**
 * Log movement invalidation
 * @param {Object} params - Invalidation parameters
 */
export function logMovementInvalidation({
  requestId,
  oldSnapshotId,
  newSnapshotId,
  reason,
  user = 'undefined'
}) {
  const auditLine = [
    `user=${user}`,
    requestId || 'no-request-id',
    `${oldSnapshotId}→${newSnapshotId}`,
    'INVALIDATED',
    `reason="${reason}"`
  ].join(' ');

  auditLogger.info(auditLine);
}

export default auditLogger;
