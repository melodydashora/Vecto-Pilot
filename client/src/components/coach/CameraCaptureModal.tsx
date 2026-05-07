import { useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CameraCaptureModalProps {
  open: boolean;
  onClose: () => void;
  onCapture: (dataUrl: string) => void;
}

export function CameraCaptureModal({ open, onClose, onCapture }: CameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setReady(false);

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => setReady(true);
        }
      } catch (err) {
        const message =
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Camera permission denied. Enable it in your browser settings.'
            : err instanceof DOMException && err.name === 'NotFoundError'
              ? 'No camera found on this device.'
              : 'Could not access camera.';
        setError(message);
      }
    }

    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [open]);

  function handleCapture() {
    const video = videoRef.current;
    if (!video || !ready) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    onCapture(dataUrl);
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" data-testid="camera-capture-modal">
      <div className="relative w-full max-w-lg rounded-lg bg-white dark:bg-slate-900 shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-2">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Camera</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 hover:bg-gray-100 dark:hover:bg-slate-800"
            aria-label="Close camera"
            data-testid="button-camera-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-3">
          {error ? (
            <div className="rounded border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 p-4 text-sm text-red-800 dark:text-red-200">
              {error}
            </div>
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full rounded bg-black"
              data-testid="camera-preview-video"
            />
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 dark:border-gray-700 px-4 py-2">
          <Button variant="ghost" onClick={onClose} data-testid="button-camera-cancel">
            Cancel
          </Button>
          <Button
            onClick={handleCapture}
            disabled={!ready || !!error}
            className="bg-blue-600 hover:bg-blue-700 text-white"
            data-testid="button-camera-capture"
          >
            <Camera className="mr-1 h-4 w-4" /> Capture
          </Button>
        </div>
      </div>
    </div>
  );
}
