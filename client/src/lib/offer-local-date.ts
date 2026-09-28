import { getLocalIso } from '@/lib/daypart';

export function driverTimeZone(timeZone?: string | null): { timeZone: string; source: 'GPS' | 'device' } {
  if (timeZone) return { timeZone, source: 'GPS' };
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!localZone) throw new Error('The browser did not provide its local timezone. Offer dates cannot be shown safely.');
  return { timeZone: localZone, source: 'device' };
}

export function driverLocalDate(date: Date, timeZone?: string | null): string {
  return getLocalIso(date, driverTimeZone(timeZone).timeZone).slice(0, 10);
}

export function todayForDriver(timeZone?: string | null, now = new Date()): string {
  return driverLocalDate(now, timeZone);
}