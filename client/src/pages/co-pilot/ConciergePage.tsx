import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, ExternalLink, QrCode } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function ConciergePage() {
  const [copyMessage, setCopyMessage] = useState('');
  // A generic entry link assigns each guest their own anonymous bookmark.
  const publicUrl = `${window.location.origin}/c`;
  return (
    <div className="max-w-2xl mx-auto p-4 pb-24">
      <Card className="bg-white border-gray-200 shadow-sm">
        <CardHeader className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-t-xl"><CardTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" /> Share the AI Concierge</CardTitle></CardHeader>
        <CardContent className="flex flex-col items-center gap-5 pt-6">
          <p className="text-gray-600 text-center">Guests can scan for local help, then bookmark their own concierge. Your driver profile, contact details, and ride data are not shared.</p>
          <QRCodeSVG value={publicUrl} size={200} title="Open the anonymous Vecto concierge" />
          <Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(publicUrl); setCopyMessage('Link copied'); } catch { setCopyMessage(`Copy this link: ${publicUrl}`); } }}><Copy className="h-4 w-4 mr-2" />Copy guest link</Button>
          {copyMessage && <p role="status" className="text-sm break-all">{copyMessage}</p>}
          <a href="/c" target="_blank" rel="noopener noreferrer" className="text-blue-700 flex items-center gap-2"><ExternalLink className="h-4 w-4" />Open guest concierge</a>
        </CardContent>
      </Card>
    </div>
  );
}
