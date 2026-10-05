// client/src/components/offer-analyzer/SetupCard.tsx
// 2026-07-03 (todo #10): Siri Shortcut install + identity-bridge token card.
// Content ground truth: docs/architecture/SIRI_SHORTCUT_ANALYZE.md (iCloud link,
// hands-free triggers, one-time shortcut edits). Token contract: design §7 —
// GET /shortcut-token (get-or-create), POST /shortcut-token/regenerate (rotate).

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/useToast';
import { getAuthHeader } from '@/utils/co-pilot-helpers';
import { API_ROUTES } from '@/constants/apiRoutes';
import { createAndroidLauncher } from '@/lib/android-launcher';
import AndroidMacroDroidGuide from './AndroidMacroDroidGuide';
import {
  ChevronDown,
  Download,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  Smartphone,
} from 'lucide-react';

// Canonical share link (SIRI_SHORTCUT_ANALYZE.md) — not an /api route, so it
// lives here rather than in apiRoutes.ts.
const SHORTCUT_ICLOUD_URL = 'https://www.icloud.com/shortcuts/cce34c892b394d3fb3e5cebd19f317c5';

function downloadSetupFile(content: string, fileName: string, type: string) {
  const objectUrl = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
}

interface ShortcutTokenInfo {
  token: string;
  created_at?: string | null;
  device_label?: string | null;
}

const TRIGGERS = [
  { name: 'Back Tap', detail: 'Settings → Accessibility → Touch → Back Tap → Double or Triple Tap → "Analyze 2"' },
  { name: 'Action Button (iPhone 15 Pro and newer)', detail: 'Settings → Action Button → Shortcut → "Analyze 2"' },
  { name: 'Voice', detail: 'Say "Hey Siri, Analyze 2" — works by shortcut name, no setup' },
  { name: 'AssistiveTouch', detail: 'Settings → Accessibility → Touch → AssistiveTouch → Single-Tap → "Analyze 2" (one floating on-screen button)' },
] as const;

const SHORTCUT_EDITS = [
  'In the "Get Contents of URL" action, rename the form field "lattitude" to "latitude" (typo silently drops your GPS).',
  'Add a form field "image" of type File with the Screenshot as its value — upgrades analysis from text-only to Vision + OCR.',
  'Paste your token (below) into the empty header row as "X-Shortcut-Token" — this links offers and rules to your account.',
] as const;

export default function SetupCard() {
  const { toast } = useToast();
  const [tokenInfo, setTokenInfo] = useState<ShortcutTokenInfo | null>(null);
  const [tokenState, setTokenState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [deviceLabel, setDeviceLabel] = useState('');
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [triggersOpen, setTriggersOpen] = useState(false);
  const [editsOpen, setEditsOpen] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const loadToken = useCallback(async () => {
    setTokenState('loading');
    try {
      const res = await fetch(API_ROUTES.OFFER_ANALYZER.SHORTCUT_TOKEN, {
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      });
      if (!res.ok) throw new Error(`GET shortcut-token failed (${res.status})`);
      const data: ShortcutTokenInfo = await res.json();
      setTokenInfo(data);
      setDeviceLabel(data.device_label || '');
      setTokenState('ready');
    } catch (err) {
      console.error('[OfferAnalyzer] failed to load shortcut token:', err);
      setTokenState('error');
    }
  }, []);

  useEffect(() => {
    loadToken();
  }, [loadToken]);

  const handleCopy = async () => {
    if (!tokenInfo?.token) return;
    try {
      await navigator.clipboard.writeText(tokenInfo.token);
      toast({ title: 'Your token copied', description: 'Paste it into your macro or Shortcut’s X-Shortcut-Token header.' });
    } catch {
      toast({ title: 'Copy failed', description: 'Select the token text and copy it manually.', variant: 'destructive' });
    }
  };

  const handleRegenerate = async () => {
    setIsBusy(true);
    try {
      const res = await fetch(API_ROUTES.OFFER_ANALYZER.SHORTCUT_TOKEN_REGENERATE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      });
      if (!res.ok) throw new Error(`Regenerate failed (${res.status})`);
      const data: ShortcutTokenInfo = await res.json();
      // Response carries token + created_at only — keep the label we already have.
      setTokenInfo((prev) => ({ ...prev, ...data }));
      setConfirmRegen(false);
      setShowToken(false);
      toast({ title: 'New token generated', description: 'Your old token no longer works — update every macro or Shortcut using it.' });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to regenerate token',
        variant: 'destructive',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveLabel = async () => {
    setIsBusy(true);
    try {
      // Server contract: POST /shortcut-token/label { label }
      const res = await fetch(API_ROUTES.OFFER_ANALYZER.SHORTCUT_TOKEN_LABEL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ label: deviceLabel.trim() || null }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      toast({ title: 'Device label saved' });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save device label',
        variant: 'destructive',
      });
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Card className="bg-white border-gray-200 shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Smartphone className="h-5 w-5 text-blue-400" />
          Phone Setup
        </CardTitle>
        <CardDescription>
          Open Offer Analyzer from your phone screen and hear your current offer decision.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <AndroidMacroDroidGuide
          hookUrl={`${window.location.origin}/api/hooks/analyze-offer`}
          tokenReady={tokenState === 'ready' && Boolean(tokenInfo?.token)}
          onCopyToken={handleCopy}
        />
        <p className="text-sm text-gray-700"><strong>No macro app needed:</strong> use browser capture below to choose an offer screenshot and hear the result. You do not need to copy a shortcut token for this option.</p>
        <Button asChild className="w-full bg-blue-600 hover:bg-blue-700">
          <a href="/co-pilot/analyze"><Smartphone className="mr-2 h-4 w-4" />Open Offer Analyzer capture</a>
        </Button>
        <div className="space-y-3 text-sm text-gray-600">
          <p><strong>iPhone:</strong> Open Offer Analyzer capture in Safari, tap Share, then Add to Home Screen. Keep that page selected when adding it.</p>
          <p><strong>Android:</strong> Open Offer Analyzer capture in Chrome, open the menu, then Add to Home screen (or Install app if offered).</p>
          <p>Configure this while parked. Opening the icon is one tap; the browser still asks you to choose an offer screenshot. Your account supplies your rules and the result is spoken.</p>
          <Button type="button" variant="outline" onClick={() => {
            const url = `${window.location.origin}/co-pilot/analyze`;
            const guide = `Offer Analyzer phone setup\n\nOpen: ${url}\n\niPhone: Safari > Share > Add to Home Screen.\nAndroid: Chrome > Menu > Add to Home screen.\n\nSign in to the same Vecto account and review your Offer Analyzer rules.\nChoose a current offer screenshot while safely stopped. Allow precise location and listen to the result.\nA result is valid only when personal rules are verified and its timestamp is current.\nThis browser launcher cannot silently capture another app. Native screenshot automation needs separate phone setup.\nNo account token is included in this file.\n`;
            downloadSetupFile(guide, 'Vecto-iPhone-Android-setup.txt', 'text/plain;charset=utf-8');
          }}><Download className="mr-2 h-4 w-4" />Download phone setup guide</Button>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2 text-sm text-gray-700">
          <p className="font-medium">Android launcher download</p>
          <p>Already using <a href="https://http-shortcuts.rmy.ch/" target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">HTTP Shortcuts</a>? Import this file with its Import / Export menu, then add Offer Analyzer to your home screen. Use the normal import option to keep existing shortcuts.</p>
          <Button type="button" variant="outline" onClick={() => {
            try {
              downloadSetupFile(createAndroidLauncher(window.location.origin), 'Vecto-Android-launcher.json', 'application/json');
            } catch (error) {
              toast({ title: 'Launcher unavailable', description: error instanceof Error ? error.message : 'Open Vecto using its secure address.', variant: 'destructive' });
            }
          }}><Download className="mr-2 h-4 w-4" />Download Android launcher</Button>
          <p className="text-xs">This opens Offer Analyzer capture in your browser. Sign in there and choose a current screenshot while safely stopped. The file contains no account token. Import and speech still need a check on your phone.</p>
        </div>
        <details className="text-sm text-gray-600">
          <summary className="cursor-pointer font-medium">Existing iPhone screenshot automation</summary>
          <p className="my-2">The shared legacy shortcut requires the edits below and a real-device check before relying on it. Point its request URL at this deployment: <code className="break-all">{`${window.location.origin}/api/hooks/analyze-offer`}</code>.</p>
          <a href={SHORTCUT_ICLOUD_URL} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline inline-flex items-center gap-1"><ExternalLink className="h-4 w-4" />Open existing iPhone shortcut</a>
        </details>

        {/* Hands-free triggers — usable while driving */}
        <Collapsible open={triggersOpen} onOpenChange={setTriggersOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="w-full flex items-center justify-between py-2 text-sm font-medium text-gray-700"
            >
              Triggers for a configured native iPhone shortcut
              <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${triggersOpen ? 'rotate-180' : ''}`} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="space-y-2 pb-2">
              {TRIGGERS.map((t) => (
                <li key={t.name} className="text-sm">
                  <span className="font-medium text-gray-800">{t.name}</span>
                  <p className="text-xs text-gray-500">{t.detail}</p>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>

        {/* One-time shortcut edits (contract fixes from the decoded plist) */}
        <Collapsible open={editsOpen} onOpenChange={setEditsOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="w-full flex items-center justify-between py-2 text-sm font-medium text-gray-700"
            >
              One-time Shortcut edits
              <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${editsOpen ? 'rotate-180' : ''}`} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol className="list-decimal list-inside space-y-2 pb-2">
              {SHORTCUT_EDITS.map((edit) => (
                <li key={edit} className="text-xs text-gray-600">
                  {edit}
                </li>
              ))}
            </ol>
          </CollapsibleContent>
        </Collapsible>

        <Separator className="bg-gray-200" />

        {/* Shortcut token — the identity bridge */}
        <div id="offer-shortcut-token" className="scroll-mt-6 space-y-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium text-gray-700">Your shortcut token</span>
          </div>
          <p className="text-xs text-gray-600">This token belongs to your signed-in account on this site. Each person must copy their own token into their macro or Shortcut. Keep it private; the guide pictures use placeholders.</p>

          {tokenState === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading token...
            </div>
          )}

          {tokenState === 'error' && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-gray-500">Could not load your token.</p>
              <Button type="button" variant="outline" size="sm" onClick={loadToken}>
                Retry
              </Button>
            </div>
          )}

          {tokenState === 'ready' && tokenInfo && (
            <>
              <div className="flex gap-2">
                <Input
                  readOnly
                  type={showToken ? 'text' : 'password'}
                  aria-label="Your private shortcut token"
                  autoComplete="off"
                  value={tokenInfo.token}
                  className="bg-gray-100 border-gray-200 text-gray-700 font-mono text-xs"
                />
                <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={handleCopy} aria-label="Copy token">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <Button type="button" variant="ghost" size="sm" className="min-h-11" aria-pressed={showToken} onClick={() => setShowToken(!showToken)}>{showToken ? 'Hide token' : 'Show token'}</Button>

              {!confirmRegen ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setConfirmRegen(true)}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Regenerate token
                </Button>
              ) : (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                  <p className="text-xs text-red-700">
                    The old token stops working immediately — update every macro or Shortcut using it.
                  </p>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setConfirmRegen(false)} disabled={isBusy}>
                      Cancel
                    </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={handleRegenerate} disabled={isBusy}>
                      {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                      Yes, regenerate
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label htmlFor="offer-device-label" className="text-sm font-medium text-gray-700">
                  Device label
                </label>
                <div className="flex gap-2">
                  <Input
                    id="offer-device-label"
                    placeholder='e.g., "My Android phone"'
                    value={deviceLabel}
                    onChange={(e) => setDeviceLabel(e.target.value)}
                    className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
                  />
                  <Button type="button" variant="outline" className="shrink-0" onClick={handleSaveLabel} disabled={isBusy}>
                    Save
                  </Button>
                </div>
                <p className="text-xs text-gray-500">A display name for the phone this token lives on.</p>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
