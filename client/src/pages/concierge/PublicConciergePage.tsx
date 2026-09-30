import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Loader2, MapPin, Sparkles } from 'lucide-react';
import { AskConcierge } from '@/components/concierge/AskConcierge';
import { Button } from '@/components/ui/button';
import { API_ROUTES } from '@/constants/apiRoutes';
import { validateGpsFix } from '@shared/coordinates.js';

const BOOKMARK_KEY = 'vecto_concierge_bookmark';
interface LocalContext { lat: number; lng: number; timezone: string }

export default function PublicConciergePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [readyToken, setReadyToken] = useState<string | null>(null);
  const ready = !!token && readyToken === token;
  const [savedContext, setSavedContext] = useState<{ token: string; data: LocalContext } | null>(null);
  const context = savedContext && savedContext.token === token ? savedContext.data : null;
  const tokenRef = useRef(token); tokenRef.current = token;
  const locatingRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReadyToken(null);
    setSavedContext(null);
    locatingRef.current?.abort();
    locatingRef.current = null;
    setLocating(false);
    setError(null);
    async function openBookmark() {
      let current = token;
      if (!current) {
        try { current = localStorage.getItem(BOOKMARK_KEY) || undefined; } catch { /* URL remains the bookmark when storage is unavailable. */ }
        if (!current) {
          const response = await fetch(API_ROUTES.CONCIERGE.SESSION, { method: 'POST', credentials: 'omit' });
          const data = await response.json();
          if (!response.ok || !data.token) throw new Error(data.error || 'Could not create your concierge bookmark.');
          current = data.token as string;
        }
        if (!cancelled) navigate(`/c/${encodeURIComponent(current)}`, { replace: true });
        return;
      }
      const response = await fetch(API_ROUTES.CONCIERGE.PUBLIC_PROFILE(current), { credentials: 'omit' });
      if (!response.ok) throw new Error('This bookmark is unavailable. Start a new concierge below.');
      if (!cancelled) {
        try { localStorage.setItem(BOOKMARK_KEY, current); } catch { /* No account or location is stored here. */ }
        setReadyToken(current);
      }
    }
    void openBookmark().catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; locatingRef.current?.abort(); };
  }, [token, navigate]);

  const locate = useCallback(() => {
    if (!token || !ready || locatingRef.current) return;
    setError(null);
    setSavedContext(null);
    if (!navigator.geolocation) { setError('This browser does not support location.'); return; }
    const scopeToken = token;
    const controller = new AbortController();
    locatingRef.current = controller;
    const current = () => tokenRef.current === scopeToken && locatingRef.current === controller && !controller.signal.aborted;
    setLocating(true);
    const finish = () => {
      clearTimeout(timer);
      if (locatingRef.current === controller) { locatingRef.current = null; setLocating(false); }
    };
    const timer = window.setTimeout(() => {
      if (current()) { setError('Location timed out. Try precise location again.'); finish(); }
      controller.abort();
    }, 25000);
    controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    navigator.geolocation.getCurrentPosition(async position => {
      if (!current()) return;
      try {
        const fix = validateGpsFix({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, timestamp: position.timestamp });
        if (fix.ok === false) throw new Error(fix.error);
        const response = await fetch(API_ROUTES.CONCIERGE.PUBLIC_CONTEXT(scopeToken, fix.lat, fix.lng), { credentials: 'omit', signal: controller.signal });
        const data = await response.json();
        if (!current()) return;
        if (!response.ok || !data.timezone) throw new Error(data.error || 'Could not resolve your local time.');
        new Intl.DateTimeFormat('en', { timeZone: data.timezone });
        if (data.lat !== fix.lat || data.lng !== fix.lng) throw new Error('Location changed while resolving local time. Try again.');
        setSavedContext({ token: scopeToken, data: { lat: data.lat, lng: data.lng, timezone: data.timezone } });
      } catch (err) {
        if (current()) setError(err instanceof Error ? err.message : 'Location could not be resolved.');
      } finally { if (current()) finish(); }
    }, () => {
      if (!current()) return;
      setError('Allow precise location in your browser, then try again.');
      finish();
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }, [token, ready]);

  useEffect(() => {
    let active = true;
    let permission: PermissionStatus | null = null;
    const changed = () => {
      if (active && permission?.state === 'denied') {
        locatingRef.current?.abort(); locatingRef.current = null;
        setSavedContext(null); setLocating(false);
        setError('Location permission was removed. Enable precise location to continue.');
      }
    };
    void navigator.permissions?.query({ name: 'geolocation' }).then(result => {
      if (!active) return;
      permission = result; permission.addEventListener('change', changed); changed();
    }).catch(() => { /* The actual GPS result governs browsers without permission queries. */ });
    return () => { active = false; permission?.removeEventListener('change', changed); };
  }, [token]);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-slate-950 p-3 sm:p-6">
      <section className="max-w-2xl mx-auto flex flex-col min-h-[580px] bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-sm">
        <header className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
          <Sparkles className="h-5 w-5" />
          <div><h1 className="font-semibold">AI Concierge</h1><p className="text-xs text-white/80">Your local companion</p></div>
        </header>
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 space-y-2 text-sm text-gray-600 dark:text-gray-300">
          <p>Hello! Bookmark this page to keep your anonymous concierge. No driver account is connected.</p>
          {context && <p className="flex items-center gap-2"><MapPin className="h-4 w-4" />{context.lat.toFixed(6)}, {context.lng.toFixed(6)}</p>}
          {ready && <Button type="button" variant="outline" className="text-gray-900 dark:text-gray-100 dark:bg-slate-800 dark:border-gray-600" onClick={locate} disabled={locating}>{locating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MapPin className="h-4 w-4 mr-2" />}{context ? 'Refresh my location' : 'Use my precise location'}</Button>}
          {!ready && !error && <p role="status">Opening your concierge...</p>}
          {error && <div role="alert" className="text-red-700 dark:text-red-300"><p>{error}</p>{!ready && <Button variant="outline" onClick={() => { try { localStorage.removeItem(BOOKMARK_KEY); } catch { /* optional storage */ } window.location.assign('/c'); }}>Start a new concierge</Button>}</div>}
        </div>
        {ready && token && context ? <AskConcierge key={`${token}:${context.lat}:${context.lng}`} token={token} lat={context.lat} lng={context.lng} timezone={context.timezone} /> : <div className="flex-1 p-8 text-center text-gray-600 dark:text-gray-300">Share your location to ask about nearby places, directions, and local events.</div>}
      </section>
      <p className="max-w-2xl mx-auto mt-3 text-xs text-gray-500">The concierge saves its anonymous bookmark token in this browser. Your questions and location are sent when you ask for help; your chat is not attached to a driver account or restored from this bookmark. A service security reset can require a new bookmark.</p>
      {/* 2026-09-15 (Melody): guests who drive should find the driver product from here. */}
      <p className="max-w-2xl mx-auto mt-2 text-xs text-gray-500">Drive rideshare? <Link to="/auth/sign-up" className="underline text-blue-700 dark:text-blue-300">Sign up as a driver</Link> to get the Vecto Pilot driver Coach.</p>
    </main>
  );
}
