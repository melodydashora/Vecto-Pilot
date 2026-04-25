// client/src/pages/events/PublicEventsListPage.tsx
// 2026-04-25: Public list of upcoming Melody-hosted events (no auth required).
// Plan: docs/plans/PLAN_event-signup-page-2026-04-25.md

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, MapPin, Users, Loader2 } from 'lucide-react';

interface PublicEvent {
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
  confirmed_count: number;
  waitlist_count: number;
  seats_left: number;
  is_full: boolean;
  current_price_cents: number | null;
}

function formatUSD(cents: number | null): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(d: string): string {
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return d;
  }
}

export default function PublicEventsListPage() {
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/public/events')
      .then(r => r.json())
      .then(data => {
        if (data.ok) setEvents(data.events || []);
        else setError(data.error || 'failed to load events');
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <header className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight">Vecto Pilot Events</h1>
          <p className="mt-2 text-slate-400">
            Upcoming driver mentor sessions hosted by Melody. Reserve your spot — only 6 seats per event.
          </p>
        </header>

        {loading && (
          <div className="flex items-center gap-2 text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading events...
          </div>
        )}

        {error && (
          <div className="rounded-md bg-red-900/40 border border-red-700 p-4 text-red-200">
            {error}
          </div>
        )}

        {!loading && !error && events.length === 0 && (
          <div className="rounded-md bg-slate-900 border border-slate-800 p-6 text-slate-400">
            No upcoming events right now. Check back soon.
          </div>
        )}

        <div className="grid gap-4">
          {events.map(ev => (
            <Link
              key={ev.id}
              to={`/events/${ev.slug}`}
              className="block rounded-lg bg-slate-900 border border-slate-800 hover:border-violet-500/60 transition p-6"
            >
              <div className="flex justify-between items-start gap-4 mb-2">
                <h2 className="text-2xl font-semibold">{ev.title}</h2>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-bold text-violet-400">{formatUSD(ev.current_price_cents)}</div>
                  <div className="text-xs text-slate-500">per person</div>
                </div>
              </div>

              {ev.description && (
                <p className="text-slate-400 text-sm mb-4 line-clamp-2">{ev.description}</p>
              )}

              <div className="grid sm:grid-cols-3 gap-3 text-sm text-slate-300">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-violet-400" />
                  <span>{formatDate(ev.event_date)}{ev.start_time ? ` · ${ev.start_time}` : ''}</span>
                </div>
                {ev.location_name && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-violet-400" />
                    <span className="truncate">{ev.location_name}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-violet-400" />
                  <span>
                    {ev.is_full
                      ? <span className="text-amber-400">Full · waitlist open</span>
                      : `${ev.seats_left} of ${ev.max_attendees} seats left`}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
