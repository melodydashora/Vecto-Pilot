// Complete server-counted rolling windows, separate from the latest-25 editor list.
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { useLocation } from '@/contexts/location-context-clean';
import { getLocalIso } from '@/lib/daypart';
import { driverTimeZone, todayForDriver } from '@/lib/offer-local-date';

type Period = 'day' | '7d' | '30d' | '90d';
interface Summary {
  success: true;
  period: { key: Period; start: string; end: string; label: string };
  stats: {
    analyzed: number; analyzer_accepted: number; analyzer_rejected: number; analyzer_no_data: number;
    driver_accepted: number; driver_rejected: number; cancelled: number; other: number; unrecorded: number;
    reported_total: number; reported_count: number;
  };
}
const config = {
  analyzer: { label: 'Analyzer recommendation', color: 'hsl(var(--primary))' },
  driver: { label: 'Your recorded decision', color: 'hsl(var(--success))' },
} satisfies ChartConfig;

function validSummary(value: Summary, period: Period, date: string, timeZone: string): boolean {
  if (value?.success !== true) return false;
  if (period === 'day') {
    const response = value as Summary & { date?: string; timeZone?: string };
    if (response.date !== date || response.timeZone !== timeZone || value.period?.key !== 'day'
      || !Number.isFinite(Date.parse(value.period.start)) || !Number.isFinite(Date.parse(value.period.end))
      || Date.parse(value.period.start) >= Date.parse(value.period.end)) return false;
  } else if (value.period?.key !== period || typeof value.period?.label !== 'string'
    || !Number.isFinite(Date.parse(value.period.start)) || !Number.isFinite(Date.parse(value.period.end))) return false;
  const countFields = ['analyzed', 'analyzer_accepted', 'analyzer_rejected', 'analyzer_no_data', 'driver_accepted', 'driver_rejected', 'cancelled', 'other', 'unrecorded', 'reported_count'] as const;
  if (!countFields.every(key => Number.isSafeInteger(value.stats?.[key]) && value.stats[key] >= 0)
    || !Number.isFinite(value.stats?.reported_total) || value.stats.reported_total < 0) return false;
  const stats = value.stats;
  return (period === 'day' || Date.parse(value.period!.start) < Date.parse(value.period!.end))
    && stats.analyzer_accepted + stats.analyzer_rejected + stats.analyzer_no_data === stats.analyzed
    && stats.driver_accepted + stats.driver_rejected + stats.cancelled + stats.other + stats.unrecorded === stats.analyzed
    && stats.reported_count <= stats.driver_accepted
    && (stats.reported_count > 0 || stats.reported_total === 0);
}

export default function OffersDecisionChart({ refreshToken, selectedDate: selectedDateProp, onSelectedDateChange }: {
  refreshToken: string;
  selectedDate?: string;
  onSelectedDateChange?: (date: string) => void;
}) {
  const { user, token, isAuthenticated, isLoading } = useAuth();
  const { timeZone } = useLocation();
  const zone = driverTimeZone(timeZone);
  const [localDate, setLocalDate] = useState(() => todayForDriver(timeZone));
  const selectedDate = selectedDateProp ?? localDate;
  const changeDate = (date: string) => {
    if (onSelectedDateChange) onSelectedDateChange(date);
    else setLocalDate(date);
  };
  const userId = user?.userId;
  // Local identity only: never put bearer credentials in query keys or storage.
  const session = useMemo(() => ({ userId, token }), [userId, token]);
  const [period, setPeriod] = useState<Period>(selectedDateProp ? 'day' : '7d');
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ session: typeof session; period: Period; date: string; timeZone: string; data?: Summary; error?: string } | null>(null);
  useEffect(() => {
    const refresh = () => setRetry(value => value + 1);
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (!userId || !token || !isAuthenticated || isLoading) { setResult(null); return () => controller.abort(); }
    setResult(null);
    const load = async () => {
      try {
        const query = period === 'day'
          ? new URLSearchParams({ date: selectedDate, timeZone: zone.timeZone })
          : new URLSearchParams({ period });
        const response = await fetch(`/api/offer-analyzer/offers/stats?${query.toString()}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: 'no-store',
        });
        if (!response.ok) throw new Error('Could not load decision counts for this period.');
        const data = await response.json();
        if (!validSummary(data, period, selectedDate, zone.timeZone)) throw new Error('The server did not return complete decision counts.');
        if (!controller.signal.aborted) setResult({ session, period, date: selectedDate, timeZone: zone.timeZone, data });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ session, period, date: selectedDate, timeZone: zone.timeZone, error: error instanceof Error ? error.message : 'Could not load decision counts.' });
      }
    };
    void load();
    return () => controller.abort();
  }, [session, userId, token, isAuthenticated, isLoading, period, selectedDate, zone.timeZone, retry, refreshToken]);

  // This identity check also protects the render before the effect cleanup executes.
  if (!userId || !token || !isAuthenticated || isLoading) return null;
  const current = result?.session === session && result.period === period
    && result.date === selectedDate && result.timeZone === zone.timeZone ? result : null;
  const data = current?.data, stats = data?.stats;
  const bars = stats ? [
    { decision: 'Accept', analyzer: stats.analyzer_accepted, driver: stats.driver_accepted },
    { decision: 'Reject', analyzer: stats.analyzer_rejected, driver: stats.driver_rejected },
  ] : [];
  return <section aria-labelledby="offer-decisions-heading" className="space-y-3 border-b border-gray-200 pb-4">
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <h3 id="offer-decisions-heading" className="font-medium text-gray-900">Offer outcomes</h3>
      <label className="text-xs text-gray-600">Period <select aria-label="Decision period" value={period} onChange={event => setPeriod(event.target.value as Period)} className="ml-1 rounded-md border border-gray-300 bg-white p-2 text-gray-900">
        <option value="day">Selected day</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option>
      </select></label>
    </div>
    {period === 'day' && <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
      <label className="space-y-1 text-sm font-medium text-gray-700" htmlFor="chart-local-date">
        <span>Chart date</span>
        <input id="chart-local-date" type="date" value={selectedDate} onChange={event => { if (event.target.value) changeDate(event.target.value); }}
          className="block min-h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900" />
      </label>
       <p className="text-xs text-gray-500">Local day: {zone.timeZone}, {zone.source === 'GPS' ? 'resolved from GPS' : 'resolved from device timezone'}</p>
    </div>}
    {!current && <p role="status" className="text-sm text-gray-500">Loading period counts…</p>}
    {current?.error && <div className="space-y-2"><p role="alert" className="text-sm text-gray-600">{current.error}</p><Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}>Retry counts</Button></div>}
    {data && stats && <>
      <p className="text-xs text-gray-500 break-words">{period === 'day' ? `Selected day ${selectedDate}` : data.period?.label}. Counts cover all offers in this period.</p>
      {period !== 'day' && data.period && <p className="text-xs text-gray-500 break-words">
        From <time dateTime={data.period.start}>{getLocalIso(new Date(data.period.start), zone.timeZone).replace('T', ' ')}</time> (inclusive)
        {' '}to <time dateTime={data.period.end}>{getLocalIso(new Date(data.period.end), zone.timeZone).replace('T', ' ')}</time> (exclusive).
        {' '}Local time: {zone.timeZone}, {zone.source === 'GPS' ? 'resolved from GPS' : 'resolved from device timezone'}.
      </p>}
      {stats.analyzed === 0 ? <p className="text-sm text-gray-500">No analyzed offers in this period.</p> : <>
        <ChartContainer config={config} className="h-[180px] w-full" aria-label={`Analyzer: ${stats.analyzer_accepted} accept, ${stats.analyzer_rejected} reject. You: ${stats.driver_accepted} accepted, ${stats.driver_rejected} rejected.`}>
          <BarChart data={bars} accessibilityLayer margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} /><XAxis dataKey="decision" /><YAxis allowDecimals={false} width={36} />
            <ChartTooltip content={<ChartTooltipContent className="[&_.tabular-nums]:ml-2" />} />
            <Bar dataKey="analyzer" fill="var(--color-analyzer)" radius={3} /><Bar dataKey="driver" fill="var(--color-driver)" radius={3} />
          </BarChart>
        </ChartContainer>
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
          <p><span aria-hidden="true" className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-primary" /><span className="font-medium">Analyzer:</span> {stats.analyzer_accepted} accept · {stats.analyzer_rejected} reject</p>
          <p><span aria-hidden="true" className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-success" /><span className="font-medium">You:</span> {stats.driver_accepted} accepted · {stats.driver_rejected} rejected</p>
        </div>
      </>}
      <p className="text-xs text-gray-500">Accepted includes completed. Separate: {stats.cancelled} cancelled · {stats.other} other/error · {stats.unrecorded} not recorded. Analyzer NO DATA: {stats.analyzer_no_data}.</p>
      <p className="text-sm text-gray-700"><strong>${stats.reported_total.toFixed(2)}</strong> driver-reported earnings across {stats.reported_count} accepted/completed offers with amounts recorded.</p>
      <p className="text-xs text-gray-500">Offered amounts and rejected offers are not earnings or savings. These counts do not measure VectoPilot’s financial impact.</p>
    </>}
  </section>;
}
