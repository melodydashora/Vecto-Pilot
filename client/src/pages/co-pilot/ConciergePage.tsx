// client/src/pages/co-pilot/ConciergePage.tsx
// 2026-02-13: Driver's authenticated concierge tab
// Shows QR code for sharing, driver card preview, and share link

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, QrCode, Copy, RefreshCw, Check, ExternalLink, AlertCircle } from 'lucide-react';
import { DriverCard } from '@/components/concierge/DriverCard';
import { API_ROUTES } from '@/constants/apiRoutes';
import { getAuthHeader } from '@/utils/co-pilot-helpers';
import { useToast } from '@/hooks/useToast';

interface DriverPreview {
  name: string;
  phone?: string | null;
  token?: string | null;
  vehicle?: {
    year: number;
    make: string;
    model: string;
    seatbelts: number;
  } | null;
}

export default function ConciergePage() {
  const { toast } = useToast();
  const [preview, setPreview] = useState<DriverPreview | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Build the public URL from the current origin
  const publicUrl = shareToken ? `${window.location.origin}/c/${shareToken}` : null;

  // Load token and preview on mount
  useEffect(() => {
    loadConciergeData();
  }, []);

  async function loadConciergeData() {
    setIsLoading(true);
    setLoadError(null);
    try {
      // Fetch token and preview in parallel
      const [tokenRes, previewRes] = await Promise.all([
        fetch(API_ROUTES.CONCIERGE.TOKEN, { headers: getAuthHeader() }),
        fetch(API_ROUTES.CONCIERGE.PREVIEW, { headers: getAuthHeader() }),
      ]);

      const tokenData = await tokenRes.json();
      const previewData = await previewRes.json();

      if (previewData.ok) {
        setPreview(previewData);
      }

      if (tokenData.ok && tokenData.token) {
        setShareToken(tokenData.token);
      } else {
        // Auto-generate token on first visit
        await generateToken();
      }
    } catch (err) {
      console.error('[concierge] Load error:', err);
      setLoadError('Could not load concierge data. Tap retry.');
    } finally {
      setIsLoading(false);
    }
  }

  async function generateToken() {
    setIsGenerating(true);
    setLoadError(null);
    try {
      const res = await fetch(API_ROUTES.CONCIERGE.TOKEN, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.ok && data.token) {
        setShareToken(data.token);
        toast({
          title: 'QR Code Updated',
          description: 'Your concierge link has been regenerated.',
        });
      } else {
        setLoadError(data.error || 'Failed to generate QR code.');
      }
    } catch (err) {
      console.error('[concierge] Generate token error:', err);
      setLoadError('Failed to generate QR code. Please try again.');
      toast({
        title: 'Error',
        description: 'Failed to generate QR code. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  }

  async function copyLink() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: 'Link Copied',
        description: 'Share this link with your passengers.',
      });
    } catch {
      // Fallback for older browsers
      const input = document.createElement('input');
      input.value = publicUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
        <p className="text-sm text-gray-500">Loading your concierge...</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
      {/* QR Code Card */}
      <Card className="bg-white border-gray-200 shadow-sm">
        <CardHeader className="pb-2 text-center">
          <CardTitle className="flex items-center justify-center gap-2 text-lg">
            <QrCode className="h-5 w-5 text-teal-500" />
            Your Concierge QR Code
          </CardTitle>
          <CardDescription>
            Passengers can scan this to discover events and places nearby
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 pb-6">
          {/* Error state — show retry button */}
          {loadError && !shareToken && (
            <div className="w-[200px] h-[200px] bg-red-50 rounded-xl flex flex-col items-center justify-center gap-3 border border-red-200">
              <AlertCircle className="h-8 w-8 text-red-400" />
              <p className="text-red-600 text-xs text-center px-4">{loadError}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={loadConciergeData}
                className="gap-1.5"
              >
                <RefreshCw className="h-3 w-3" />
                Retry
              </Button>
            </div>
          )}

          {/* QR Code */}
          {shareToken && (
            <div className="bg-white p-4 rounded-xl border-2 border-gray-100">
              <QRCodeSVG
                value={publicUrl || ''}
                size={200}
                level="M"
                includeMargin={false}
                bgColor="#ffffff"
                fgColor="#0f172a"
              />
            </div>
          )}

          {/* Generating state (no error, no token yet) */}
          {!shareToken && !loadError && (
            <div className="w-[200px] h-[200px] bg-gray-100 rounded-xl flex flex-col items-center justify-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-teal-400" />
              <p className="text-gray-400 text-sm">Generating QR code...</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 w-full">
            <Button
              variant="outline"
              size="sm"
              onClick={copyLink}
              disabled={!publicUrl}
              className="flex-1 gap-1.5"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-green-500" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copy Link
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={generateToken}
              disabled={isGenerating}
              className="gap-1.5"
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Regenerate
            </Button>
          </div>

          {/* Preview link */}
          {publicUrl && (
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-teal-600 hover:text-teal-700 flex items-center gap-1"
            >
              <ExternalLink className="h-3 w-3" />
              Preview public page
            </a>
          )}
        </CardContent>
      </Card>

      {/* Card Preview */}
      {preview && (
        <>
          <p className="text-sm text-gray-500 text-center">
            How passengers see you:
          </p>
          <DriverCard
            name={preview.name}
            phone={preview.phone}
            vehicle={preview.vehicle}
          />
        </>
      )}
    </div>
  );
}
