// client/src/pages/welcome/hooks.ts
// 2026-05-15: iPad kiosk helpers for the public /welcome surface.
// useVoiceCommands → webkitSpeechRecognition wrapper with command dictionary
// useSoundFx       → Web Audio synth for click / whoosh / correct / wrong / chime / fanfare
// useKioskGestures → keyboard arrows, touch swipe, fullscreen toggle

import { useCallback, useEffect, useRef, useState } from 'react';

// ── Minimal Web Speech API types (browsers don't ship these in lib.dom) ──
type SpeechRecognitionAlt = { transcript: string; confidence: number };
type SpeechRecognitionEvtResult = { 0: SpeechRecognitionAlt; isFinal: boolean; length: number };
interface SpeechRecognitionEvent {
  results: { [k: number]: SpeechRecognitionEvtResult; length: number };
  resultIndex: number;
}
interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onend:    ((e: Event) => void) | null;
  onerror:  ((e: Event) => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

// ════════════════════════════════════════════════════════════════════════
// useVoiceCommands
// ════════════════════════════════════════════════════════════════════════

export type VoiceCommand =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'home' }
  | { type: 'quiz' }
  | { type: 'restart' }
  | { type: 'choice'; letter: 'A' | 'B' | 'C' | 'TRUE' | 'FALSE' };

function parseCommand(transcript: string): VoiceCommand | null {
  const t = transcript.toLowerCase().trim();
  if (/\b(next|forward|continue|advance|go on)\b/.test(t))  return { type: 'next' };
  if (/\b(back|previous|go back)\b/.test(t))                return { type: 'back' };
  if (/\b(home|start over|beginning)\b/.test(t))            return { type: 'home' };
  if (/\b(quiz|start (the )?quiz|test me)\b/.test(t))       return { type: 'quiz' };
  if (/\b(restart|retake|try again|do over)\b/.test(t))     return { type: 'restart' };
  if (/\b(true|yes)\b/.test(t))                             return { type: 'choice', letter: 'TRUE' };
  if (/\b(false|no|nope)\b/.test(t))                        return { type: 'choice', letter: 'FALSE' };
  if (/\b(letter )?a\b|^a$/.test(t))                        return { type: 'choice', letter: 'A' };
  if (/\b(letter )?b\b|^b$/.test(t))                        return { type: 'choice', letter: 'B' };
  if (/\b(letter )?c\b|^c$/.test(t))                        return { type: 'choice', letter: 'C' };
  return null;
}

export function useVoiceCommands(
  enabled: boolean,
  onCommand: (cmd: VoiceCommand) => void,
): { supported: boolean; listening: boolean; lastTranscript: string } {
  const [listening, setListening] = useState(false);
  const [lastTranscript, setLastTranscript] = useState('');
  const recogRef = useRef<SpeechRecognitionInstance | null>(null);
  const onCommandRef = useRef(onCommand);
  useEffect(() => { onCommandRef.current = onCommand; }, [onCommand]);

  const Ctor = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : undefined;
  const supported = Boolean(Ctor);

  useEffect(() => {
    if (!Ctor || !enabled) {
      if (recogRef.current) { try { recogRef.current.abort(); } catch { /* noop */ } recogRef.current = null; }
      setListening(false);
      return;
    }
    const r = new Ctor();
    r.lang = 'en-US';
    r.continuous = false;
    r.interimResults = false;
    let stopped = false;

    r.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      if (!last) return;
      const text = last[0].transcript;
      setLastTranscript(text);
      const cmd = parseCommand(text);
      if (cmd) onCommandRef.current(cmd);
    };
    r.onend = () => {
      if (stopped) return;
      try { r.start(); } catch { /* iOS double-start guard */ }
    };
    r.onerror = () => { /* most errors recover via onend → restart */ };

    recogRef.current = r;
    try { r.start(); setListening(true); } catch { setListening(false); }

    return () => {
      stopped = true;
      try { r.abort(); } catch { /* noop */ }
      recogRef.current = null;
      setListening(false);
    };
  }, [Ctor, enabled]);

  return { supported, listening, lastTranscript };
}

// ════════════════════════════════════════════════════════════════════════
// useSoundFx
// ════════════════════════════════════════════════════════════════════════

export type SoundName = 'click' | 'whoosh' | 'correct' | 'wrong' | 'chime' | 'fanfare' | 'honk';

export function useSoundFx(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);

  const ensureCtx = useCallback(() => {
    if (!enabled) return null;
    if (typeof window === 'undefined') return null;
    if (!ctxRef.current) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctxRef.current = new AC();
    }
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume().catch(() => { /* noop */ });
    return ctxRef.current;
  }, [enabled]);

  const beep = useCallback((freq: number, durMs: number, type: OscillatorType = 'sine', startGain = 0.18) => {
    const ctx = ensureCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(startGain, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durMs / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durMs / 1000);
  }, [ensureCtx]);

  const noiseWhoosh = useCallback(() => {
    const ctx = ensureCtx();
    if (!ctx) return;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(2000, ctx.currentTime);
    filt.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.25);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    src.connect(filt).connect(gain).connect(ctx.destination);
    src.start();
  }, [ensureCtx]);

  const arpeggio = useCallback((freqs: number[], stepMs = 110, type: OscillatorType = 'triangle') => {
    const ctx = ensureCtx();
    if (!ctx) return;
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f, ctx.currentTime + i * stepMs / 1000);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * stepMs / 1000);
      gain.gain.linearRampToValueAtTime(0.16, ctx.currentTime + i * stepMs / 1000 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * stepMs / 1000 + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * stepMs / 1000);
      osc.stop(ctx.currentTime + i * stepMs / 1000 + 0.25);
    });
  }, [ensureCtx]);

  // 2026-05-15: 'honk' — two-tone car horn, ~400ms total, square waves for that
  // brassy bus-honk timbre. Two oscillators slightly detuned for the chord-like punch.
  const honk = useCallback(() => {
    const ctx = ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const blast = (freq: number, start: number, dur: number) => {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      osc1.type = 'square'; osc1.frequency.setValueAtTime(freq, start);
      osc2.type = 'square'; osc2.frequency.setValueAtTime(freq * 1.5, start); // perfect fifth above
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc1.connect(gain); osc2.connect(gain); gain.connect(ctx.destination);
      osc1.start(start); osc2.start(start);
      osc1.stop(start + dur); osc2.stop(start + dur);
    };
    blast(330, now,        0.18); // first "BAH"
    blast(330, now + 0.22, 0.20); // second "BAH"
  }, [ensureCtx]);

  const play = useCallback((name: SoundName) => {
    if (!enabled) return;
    switch (name) {
      case 'click':   beep(800, 60, 'square', 0.10); break;
      case 'whoosh':  noiseWhoosh(); break;
      case 'correct': arpeggio([523.25, 659.25, 783.99]); break; // C5 E5 G5
      case 'wrong':   arpeggio([440, 369.99], 160, 'sawtooth'); break; // A4 → F#4
      case 'chime':   arpeggio([1046.50, 1318.51], 90); break; // C6 E6
      case 'fanfare': arpeggio([523.25, 659.25, 783.99, 1046.50], 130, 'triangle'); break;
      case 'honk':    honk(); break;
    }
  }, [enabled, beep, noiseWhoosh, arpeggio, honk]);

  // First-gesture unlock: ctx is created on first call to ensureCtx via play().
  const unlock = useCallback(() => { ensureCtx(); }, [ensureCtx]);

  return { play, unlock };
}

// ════════════════════════════════════════════════════════════════════════
// useKioskGestures
// ════════════════════════════════════════════════════════════════════════

export function useKioskGestures(opts: {
  onNext: () => void;
  onBack: () => void;
  enabled?: boolean;
}) {
  const { onNext, onBack, enabled = true } = opts;
  const startXRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); onNext(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp')                { e.preventDefault(); onBack(); }
    };
    const handleStart = (e: TouchEvent) => { startXRef.current = e.touches[0]?.clientX ?? null; };
    const handleEnd = (e: TouchEvent) => {
      if (startXRef.current === null) return;
      const endX = e.changedTouches[0]?.clientX;
      if (endX === undefined) return;
      const dx = endX - startXRef.current;
      startXRef.current = null;
      if (Math.abs(dx) < 60) return;
      if (dx < 0) onNext(); else onBack();
    };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('touchstart', handleStart, { passive: true });
    window.addEventListener('touchend', handleEnd, { passive: true });
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('touchstart', handleStart);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [onNext, onBack, enabled]);
}

// ── Fullscreen helper (exported standalone — used by a button, not a hook) ──
export async function toggleFullscreen(target?: HTMLElement) {
  const el = target ?? document.documentElement;
  if (document.fullscreenElement) {
    try { await document.exitFullscreen(); } catch { /* noop */ }
  } else {
    try { await el.requestFullscreen(); } catch { /* noop */ }
  }
}
