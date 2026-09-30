import { getLocalIso } from '@/lib/daypart';

export function validSourceTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

export function hasStrategySourceTimes(value: { strategyUpdatedAt?: unknown; snapshotCreatedAt?: unknown } | null | undefined): boolean {
  return validSourceTimestamp(value?.strategyUpdatedAt) && validSourceTimestamp(value?.snapshotCreatedAt);
}

export function sourceTimeLabel(value: unknown, timezone?: string | null): string | null {
  if (!validSourceTimestamp(value) || !timezone) return null;
  try { return `${getLocalIso(new Date(value), timezone).slice(0, 16).replace('T', ' ')} (${timezone})`; }
  catch { return null; }
}
