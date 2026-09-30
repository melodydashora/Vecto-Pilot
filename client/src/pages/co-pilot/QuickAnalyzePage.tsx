import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Loader2, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { API_ROUTES } from '@/constants/apiRoutes';
import { getAuthHeader } from '@/utils/co-pilot-helpers';
import { readSpokenOfferResult, type SpokenOfferResult } from '@/lib/offer-capture';
import { validateGpsFix } from '@shared/coordinates.js';

export default function QuickAnalyzePage() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SpokenOfferResult | null>(null);
  const [expired, setExpired] = useState(false);
  const [ageSeconds, setAgeSeconds] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    void fetch(API_ROUTES.OFFER_ANALYZER.SHORTCUT_TOKEN, { headers: getAuthHeader(), signal: abort.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !data.token) throw new Error('Your account could not be connected. Reopen Offer Analyzer to sign in and check your rules.');
        setToken(data.token);
      }).catch(err => { if (!abort.signal.aborted) setError(err.message); });
    return () => { abort.abort(); controller.current?.abort(); window.speechSynthesis?.cancel(); };
  }, []);

  useEffect(() => {
    if (!result?.analyzedAt) return;
    const analyzedTime = Date.parse(result.analyzedAt);
    const updateAge = () => setAgeSeconds(Math.max(0, Math.floor((Date.now() - analyzedTime) / 1000)));
    updateAge();
    const tick = window.setInterval(updateAge, 1000);
    const remaining = Math.max(0, 30000 - (Date.now() - analyzedTime));
    const timeout = window.setTimeout(() => { setExpired(true); window.speechSynthesis?.cancel(); window.clearInterval(tick); }, remaining);
    return () => { window.clearTimeout(timeout); window.clearInterval(tick); };
  }, [result]);

  const speak = useCallback((text: string) => {
    if (!window.speechSynthesis) { setError('Speech is unavailable in this browser. Read the result only when safely stopped.'); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onerror = event => { if (!['canceled', 'interrupted'].includes(event.error)) setError('Audio could not play. Tap Speak result when safe.'); };
    window.speechSynthesis.speak(utterance);
  }, []);

  const analyze = async (file: File) => {
    if (busy || !token) return;
    setError(null); setResult(null); setExpired(false);
    window.speechSynthesis?.cancel();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError('Choose a JPEG, PNG, or WebP screenshot no larger than 5 MB.'); return;
    }
    setBusy(true);
    const abort = new AbortController(); controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 45000);
    try {
      if (!navigator.geolocation) throw new Error('Precise location is unavailable in this browser.');
      const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }));
      if (abort.signal.aborted) return;
      const fix = validateGpsFix({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, timestamp: position.timestamp });
      if (fix.ok === false) throw new Error(fix.error);
      const body = new FormData();
      body.append('image', file);
      body.append('latitude', fix.lat.toFixed(6));
      body.append('longitude', fix.lng.toFixed(6));
      body.append('source', 'vecto_browser');
      const response = await fetch(API_ROUTES.OFFER_ANALYZER.ANALYZE, { method: 'POST', headers: { 'X-Shortcut-Token': token }, body, signal: abort.signal });
      if (!response.ok) throw new Error('Offer analysis is unavailable. Decide manually when safe.');
      const next = readSpokenOfferResult(await response.json());
      if (abort.signal.aborted) return;
      setResult(next);
      speak(next.voice);
    } catch (err) {
      if (!abort.signal.aborted) {
        const message = err instanceof Error ? err.message : 'Precise location or analysis is unavailable. Decide manually when safe.';
        setError(message);
        speak('No data. Decide manually when safe.');
      } else if (controller.current === abort) setError('Analysis timed out. Decide manually when safe.');
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
    }
  };

  return (
    <main className="max-w-xl mx-auto p-4 pb-28 space-y-5 bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100">
      <h1 className="text-2xl font-bold">Analyze an offer</h1>
      <p className="text-gray-600 dark:text-gray-300">Choose a current offer screenshot. Vecto checks your personal rules and speaks the result. Set up and select files while safely stopped.</p>
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Offer screenshot" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void analyze(file); }} />
      <Button className="w-full min-h-20 text-lg" disabled={!token || busy} onClick={() => fileInput.current?.click()}>{busy ? <Loader2 className="h-6 w-6 mr-3 animate-spin" /> : <Camera className="h-6 w-6 mr-3" />}{busy ? 'Checking location and your rules...' : 'Choose screenshot and analyze'}</Button>
      {!token && !error && <p role="status">Connecting to your account...</p>}
      {error && <p role="alert" className="p-3 bg-red-50 text-red-800 rounded-lg">{error}</p>}
      {result && <section aria-live="polite" className="p-5 border border-gray-200 dark:border-gray-600 bg-white dark:bg-slate-800 rounded-xl space-y-3">
        <h2 className="text-3xl font-bold">{expired ? 'EXPIRED' : result.decision}</h2>
        <p>{expired ? 'This result is over 30 seconds old. Analyze a current offer.' : result.reason}</p>
        {result.verified && <p className="text-sm text-gray-600 dark:text-gray-300">Personal rules verified{result.rulesVersion != null ? ` - version ${result.rulesVersion}` : ' - from your signup preferences'}.</p>}
        {result.analyzedAt && <p className="text-xs text-gray-500 dark:text-gray-400">Analyzed <time dateTime={result.analyzedAt}>{ageSeconds} seconds ago</time></p>}
        <Button variant="outline" className="text-gray-900 dark:text-gray-100 dark:bg-slate-800 dark:border-gray-600" disabled={expired} onClick={() => speak(result.voice)}><Volume2 className="h-4 w-4 mr-2" />Speak result</Button>
      </section>}
      <Link className="block text-blue-700 dark:text-blue-300 underline" to="/co-pilot/offer-analyzer">Rules and phone setup</Link>
      <p className="text-xs text-gray-500 dark:text-gray-400">This browser shortcut opens Vecto; choosing a screenshot needs your interaction. It cannot capture another app automatically or accept a ride for you.</p>
    </main>
  );
}
