// client/src/pages/events/PublicEventSignupPage.tsx
// 2026-04-25: Public event detail + signup form (no auth required).
// Plan: docs/plans/PLAN_event-signup-page-2026-04-25.md

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Calendar, MapPin, Users, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface PriceTier {
  min_count: number;
  price_cents: number;
}

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
  price_tiers: PriceTier[];
}

function formatUSD(cents: number | null): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(d: string): string {
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
  } catch {
    return d;
  }
}

export default function PublicEventSignupPage() {
  const { slug } = useParams<{ slug: string }>();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [pickupAddress, setPickupAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ status: string; message: string; price_cents: number | null } | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/public/events/${slug}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) setEvent(data.event);
        else setError(data.error || 'event not found');
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!slug || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/events/${slug}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName,
          email,
          phone: phone || undefined,
          pickup_address: pickupAddress || undefined,
          notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setResult({ status: data.status, message: data.message, price_cents: data.price_cents });
      } else {
        setError(data.error || 'signup failed');
      }
    } catch (e: any) {
      setError(e.message || 'signup failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 px-4 py-12">
        <div className="max-w-xl mx-auto">
          <Link to="/events" className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200 text-sm mb-6">
            <ArrowLeft className="w-4 h-4" /> Back to events
          </Link>
          <div className="rounded-md bg-red-900/40 border border-red-700 p-4 text-red-200">
            {error || 'Event not found.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <Link to="/events" className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200 text-sm mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to events
        </Link>

        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">{event.title}</h1>
          {event.description && <p className="mt-3 text-slate-300">{event.description}</p>}

          <div className="mt-5 grid sm:grid-cols-2 gap-3 text-sm text-slate-300">
            <div className="flex items-start gap-2">
              <Calendar className="w-4 h-4 mt-0.5 text-violet-400 shrink-0" />
              <span>
                {formatDate(event.event_date)}
                {event.start_time ? ` · ${event.start_time}` : ''}
                {event.end_time ? ` – ${event.end_time}` : ''}
              </span>
            </div>
            {event.location_name && (
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 mt-0.5 text-violet-400 shrink-0" />
                <div>
                  <div>{event.location_name}</div>
                  {event.location_address && (
                    <div className="text-slate-400 text-xs">{event.location_address}</div>
                  )}
                </div>
              </div>
            )}
            <div className="flex items-start gap-2">
              <Users className="w-4 h-4 mt-0.5 text-violet-400 shrink-0" />
              <span>
                {event.is_full
                  ? <span className="text-amber-400">All 6 seats taken — joining the waitlist</span>
                  : `${event.seats_left} of ${event.max_attendees} seats left`}
              </span>
            </div>
          </div>
        </header>

        <div className="mb-6 rounded-lg bg-violet-950/40 border border-violet-800 p-5">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-sm text-violet-300 uppercase tracking-wide">Current price per person</div>
              <div className="text-3xl font-bold text-violet-100">{formatUSD(event.current_price_cents)}</div>
            </div>
            <div className="text-xs text-violet-300/80">{event.confirmed_count} confirmed</div>
          </div>

          {event.price_tiers && event.price_tiers.length > 1 && (
            <div className="mt-3 pt-3 border-t border-violet-900 text-xs text-violet-300/90">
              <div className="font-medium mb-1">Price drops as more people sign up:</div>
              <ul className="space-y-0.5">
                {event.price_tiers.map((t, i) => (
                  <li key={i}>
                    {t.min_count}+ signed up → <span className="font-mono">{formatUSD(t.price_cents)}</span>
                    {' '}per person
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {result ? (
          <div className={`rounded-lg p-6 border ${
            result.status === 'confirmed'
              ? 'bg-emerald-950/40 border-emerald-700'
              : 'bg-amber-950/40 border-amber-700'
          }`}>
            <div className="flex items-start gap-3">
              {result.status === 'confirmed'
                ? <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
                : <AlertCircle className="w-6 h-6 text-amber-400 shrink-0" />}
              <div>
                <div className="text-lg font-semibold">
                  {result.status === 'confirmed' ? "You're confirmed!" : "You're on the waitlist"}
                </div>
                <p className="mt-1 text-sm text-slate-300">{result.message}</p>
                {result.price_cents != null && result.status === 'confirmed' && (
                  <p className="mt-3 text-sm">
                    Your locked-in price: <strong className="text-emerald-300">{formatUSD(result.price_cents)}</strong>
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <h2 className="text-lg font-semibold">Reserve your seat</h2>

            <Field label="Full name *">
              <input
                type="text"
                required
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                className="input"
              />
            </Field>

            <Field label="Email *">
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="input"
              />
            </Field>

            <Field label="Phone">
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="input"
              />
            </Field>

            <Field label="Pickup address (helps us route the day)">
              <input
                type="text"
                value={pickupAddress}
                onChange={e => setPickupAddress(e.target.value)}
                placeholder="e.g. 123 Main St, Dallas TX"
                className="input"
              />
            </Field>

            <Field label="Anything else we should know?">
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                className="input"
              />
            </Field>

            {error && (
              <div className="rounded-md bg-red-900/40 border border-red-700 p-3 text-sm text-red-200">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-60 disabled:cursor-not-allowed py-3 font-semibold transition"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {event.is_full ? 'Join waitlist' : 'Reserve my seat'}
            </button>

            <p className="text-xs text-slate-500 text-center">
              No payment is collected here — Melody will follow up by email with payment details.
            </p>
          </form>
        )}
      </div>

      <style>{`
        .input {
          width: 100%;
          background: rgb(15 23 42);
          border: 1px solid rgb(51 65 85);
          border-radius: 0.5rem;
          padding: 0.625rem 0.875rem;
          color: rgb(241 245 249);
          font-size: 0.875rem;
        }
        .input:focus {
          outline: none;
          border-color: rgb(139 92 246);
          box-shadow: 0 0 0 3px rgb(139 92 246 / 0.2);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-sm text-slate-300 mb-1">{label}</div>
      {children}
    </label>
  );
}
