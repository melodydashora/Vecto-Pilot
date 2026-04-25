// client/src/pages/co-pilot/EventsAdminPage.tsx
// 2026-04-25: Admin view for hosted_events POC.
// Plan: docs/plans/PLAN_event-signup-page-2026-04-25.md
// Auth: requires logged-in user (mounted under ProtectedRoute).

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Plus, Sparkles, ChevronRight, Trash2 } from 'lucide-react';
import { getAuthHeader } from '@/contexts/auth-context';

interface PriceTier {
  min_count: number;
  price_cents: number;
}

interface AdminEvent {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location_name: string | null;
  location_address: string | null;
  max_attendees: number;
  status: string;
  price_tiers: PriceTier[];
  itinerary_md: string | null;
  itinerary_generated_at: string | null;
  confirmed_count: string | number;
  waitlist_count: string | number;
  current_price_cents?: number | null;
}

interface Signup {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  pickup_address: string | null;
  notes: string | null;
  status: string;
  price_cents_at_signup: number | null;
  created_at: string;
}

function authFetch(url: string, init: RequestInit = {}) {
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
      ...(init.headers || {}),
    },
  });
}

function formatUSD(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

export default function EventsAdminPage() {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authFetch('/api/admin/events');
      const data = await r.json();
      if (data.ok) setEvents(data.events || []);
      else setError(data.error || 'failed to load events');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Hosted Events</h1>
            <p className="text-sm text-slate-400 mt-1">Create and manage paid mentor sessions.</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-500 px-4 py-2 text-sm font-semibold"
          >
            <Plus className="w-4 h-4" /> New event
          </button>
        </header>

        {showCreate && (
          <CreateEventForm
            onCancel={() => setShowCreate(false)}
            onCreated={() => { setShowCreate(false); refresh(); }}
          />
        )}

        {loading && (
          <div className="flex items-center gap-2 text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        )}
        {error && <div className="rounded-md bg-red-900/40 border border-red-700 p-3 text-red-200 text-sm">{error}</div>}

        <div className="grid gap-2">
          {events.map(ev => (
            <button
              key={ev.id}
              onClick={() => setSelectedId(ev.id === selectedId ? null : ev.id)}
              className="text-left rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 p-4"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-semibold">{ev.title}</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {ev.event_date} · {ev.status} · {ev.confirmed_count}/{ev.max_attendees} confirmed · {ev.waitlist_count} waitlist
                  </div>
                </div>
                <ChevronRight className={`w-4 h-4 text-slate-500 transition ${ev.id === selectedId ? 'rotate-90' : ''}`} />
              </div>
              {selectedId === ev.id && (
                <div onClick={e => e.stopPropagation()} className="mt-4 pt-4 border-t border-slate-800">
                  <EventDetail eventId={ev.id} onChange={refresh} />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CreateEventForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    slug: '',
    title: '',
    description: '',
    event_date: '',
    start_time: '',
    end_time: '',
    location_name: '',
    location_address: '',
    max_attendees: 6,
    price_tiers: '[{"min_count":1,"price_cents":15000},{"min_count":3,"price_cents":10000},{"min_count":5,"price_cents":7500}]',
    status: 'draft',
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      let priceTiers: PriceTier[];
      try { priceTiers = JSON.parse(form.price_tiers); }
      catch { throw new Error('price_tiers must be valid JSON'); }

      const r = await authFetch('/api/admin/events', {
        method: 'POST',
        body: JSON.stringify({ ...form, price_tiers: priceTiers }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'create failed');
      onCreated();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  return (
    <form onSubmit={submit} className="rounded-lg bg-slate-900 border border-slate-800 p-5 mb-6 space-y-3">
      <h2 className="text-lg font-semibold">New event</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        <Input label="Slug *" value={form.slug} onChange={v => set('slug', v)} placeholder="dallas-honey-holes-may3" required />
        <Input label="Title *" value={form.title} onChange={v => set('title', v)} required />
        <Input label="Date *" type="date" value={form.event_date} onChange={v => set('event_date', v)} required />
        <Input label="Max attendees" type="number" value={String(form.max_attendees)} onChange={v => set('max_attendees', parseInt(v) || 6)} />
        <Input label="Start time" type="time" value={form.start_time} onChange={v => set('start_time', v)} />
        <Input label="End time" type="time" value={form.end_time} onChange={v => set('end_time', v)} />
        <Input label="Location name" value={form.location_name} onChange={v => set('location_name', v)} />
        <Input label="Location address" value={form.location_address} onChange={v => set('location_address', v)} />
      </div>
      <Textarea label="Description" value={form.description} onChange={v => set('description', v)} rows={3} />
      <Textarea label="Price tiers (JSON)" value={form.price_tiers} onChange={v => set('price_tiers', v)} rows={3} />
      <label className="block text-sm">
        <div className="text-slate-300 mb-1">Status</div>
        <select className="adminInput" value={form.status} onChange={e => set('status', e.target.value)}>
          <option value="draft">draft</option>
          <option value="published">published</option>
          <option value="closed">closed</option>
          <option value="cancelled">cancelled</option>
        </select>
      </label>
      {err && <div className="rounded bg-red-900/40 border border-red-700 p-2 text-sm text-red-200">{err}</div>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded text-slate-300 hover:bg-slate-800">Cancel</button>
        <button disabled={submitting} className="px-4 py-2 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-60 inline-flex items-center gap-2">
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          Create
        </button>
      </div>
      <style>{`
        .adminInput { width:100%; background:rgb(15 23 42); border:1px solid rgb(51 65 85); border-radius:0.5rem; padding:0.5rem 0.75rem; color:rgb(241 245 249); font-size:0.875rem; }
        .adminInput:focus { outline:none; border-color:rgb(139 92 246); }
      `}</style>
    </form>
  );
}

function EventDetail({ eventId, onChange }: { eventId: string; onChange: () => void }) {
  const [loading, setLoading] = useState(true);
  const [event, setEvent] = useState<AdminEvent | null>(null);
  const [signups, setSignups] = useState<Signup[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authFetch(`/api/admin/events/${eventId}`);
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'load failed');
      setEvent(data.event);
      setSignups(data.signups || []);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  async function generate() {
    setBusy('itinerary');
    setErr(null);
    try {
      const r = await authFetch(`/api/admin/events/${eventId}/generate-itinerary`, { method: 'POST' });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'failed');
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(null); }
  }

  async function promote() {
    setBusy('promote');
    setErr(null);
    try {
      const r = await authFetch(`/api/admin/events/${eventId}/promote-waitlist`, { method: 'POST' });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'failed');
      await load();
      onChange();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(null); }
  }

  async function deleteEvent() {
    if (!confirm('Delete this event? All signups will be removed.')) return;
    setBusy('delete');
    try {
      const r = await authFetch(`/api/admin/events/${eventId}`, { method: 'DELETE' });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'failed');
      onChange();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(null); }
  }

  if (loading) return <div className="text-slate-400 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  if (!event) return <div className="text-red-300 text-sm">{err || 'not found'}</div>;

  const confirmed = signups.filter(s => s.status === 'confirmed');
  const waitlist = signups.filter(s => s.status === 'waitlist');

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap gap-2">
        <button onClick={generate} disabled={busy !== null || confirmed.length === 0}
          className="inline-flex items-center gap-2 rounded bg-fuchsia-700 hover:bg-fuchsia-600 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold">
          {busy === 'itinerary' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          Generate itinerary
        </button>
        <button onClick={promote} disabled={busy !== null || waitlist.length === 0}
          className="rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold">
          Promote next from waitlist
        </button>
        <button onClick={deleteEvent} disabled={busy !== null}
          className="ml-auto inline-flex items-center gap-1 rounded bg-red-900 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold">
          <Trash2 className="w-3 h-3" /> Delete
        </button>
      </div>

      <div className="text-xs text-slate-400">
        Public URL: <code className="text-slate-300">/events/{event.slug}</code> · current price {formatUSD(event.current_price_cents)}
      </div>

      {err && <div className="rounded bg-red-900/40 border border-red-700 p-2 text-red-200">{err}</div>}

      <RosterTable title={`Confirmed (${confirmed.length}/${event.max_attendees})`} signups={confirmed} />
      {waitlist.length > 0 && <RosterTable title={`Waitlist (${waitlist.length})`} signups={waitlist} />}

      {event.itinerary_md && (
        <div className="rounded bg-slate-950 border border-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-2">
            Itinerary {event.itinerary_generated_at && `· ${new Date(event.itinerary_generated_at).toLocaleString()}`}
          </div>
          <pre className="whitespace-pre-wrap text-slate-200 text-xs">{event.itinerary_md}</pre>
        </div>
      )}
    </div>
  );
}

function RosterTable({ title, signups }: { title: string; signups: Signup[] }) {
  if (signups.length === 0) return null;
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">{title}</div>
      <div className="rounded border border-slate-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-900">
            <tr>
              <th className="text-left px-2 py-1">Name</th>
              <th className="text-left px-2 py-1">Email</th>
              <th className="text-left px-2 py-1">Phone</th>
              <th className="text-left px-2 py-1">Pickup</th>
              <th className="text-right px-2 py-1">Price</th>
            </tr>
          </thead>
          <tbody>
            {signups.map(s => (
              <tr key={s.id} className="border-t border-slate-800">
                <td className="px-2 py-1">{s.full_name}</td>
                <td className="px-2 py-1"><a href={`mailto:${s.email}`} className="text-violet-400 hover:underline">{s.email}</a></td>
                <td className="px-2 py-1">{s.phone || '—'}</td>
                <td className="px-2 py-1 truncate max-w-xs">{s.pickup_address || '—'}</td>
                <td className="px-2 py-1 text-right">{formatUSD(s.price_cents_at_signup)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = 'text', required, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; required?: boolean; placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <div className="text-slate-300 mb-1">{label}</div>
      <input
        type={type} value={value} required={required} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-slate-100 focus:outline-none focus:border-violet-500"
      />
    </label>
  );
}

function Textarea({ label, value, onChange, rows }: {
  label: string; value: string; onChange: (v: string) => void; rows?: number;
}) {
  return (
    <label className="block text-sm">
      <div className="text-slate-300 mb-1">{label}</div>
      <textarea
        value={value} rows={rows} onChange={e => onChange(e.target.value)}
        className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-slate-100 focus:outline-none focus:border-violet-500 font-mono text-xs"
      />
    </label>
  );
}
