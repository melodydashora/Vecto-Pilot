// client/src/lib/voice/pcm.ts
// 2026-08-11 (todo #33): PCM16 audio plumbing for the Gemini Live arm.
// Live API contract (verified 2026-08-11): input = raw 16-bit PCM @ 16 kHz LE,
// output = raw 16-bit PCM @ 24 kHz LE, both base64 over the WebSocket.
//
// Capture: getUserMedia (browser AEC constraints are LOAD-BEARING — the Live
// API has no server-side echo cancellation; without echoCancellation:true the
// model's own voice loops back and its server VAD interrupts itself) →
// AudioWorklet → downsample to 16 kHz → base64 chunks.
// Playback: base64 chunks → AudioBuffer(24 kHz) → sequentially scheduled
// AudioBufferSourceNodes (the context resamples buffers automatically, so we
// never force a context sampleRate — Safari-safe).

// 2026-08-11: worklet is a static file (client/public/pcm-capture.worklet.js),
// NOT an inline Blob URL — worklet modules are governed by CSP script-src, and
// the Blob approach needed script-src blob: (Melody's phone test: "Unable to
// load a worklet's module"). Serving from 'self' keeps the CSP tight.
const CAPTURE_WORKLET_URL = '/pcm-capture.worklet.js';

function floatTo16(f32: Float32Array): Int16Array {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function int16ToBase64(i16: Int16Array): string {
  const bytes = new Uint8Array(i16.buffer, i16.byteOffset, i16.byteLength);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToFloat32(b64: string): Float32Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 0x8000;
  return f32;
}

/** Linear-interpolation downsample (context rate → 16 kHz). */
function downsample(f32: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return f32;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(f32.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, f32.length - 1);
    out[i] = f32[i0] + (f32[i1] - f32[i0]) * (pos - i0);
  }
  return out;
}

export const MIC_TARGET_RATE = 16000;
export const PLAYBACK_RATE = 24000;

/**
 * Microphone capture → 16 kHz PCM16 base64 chunks (~128 ms batches).
 * start() must be reached from a user gesture for iOS audio unlock.
 */
export class MicCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private pending: Float32Array[] = [];
  private pendingLen = 0;

  async start(onChunk: (base64Pcm16: string) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true, // load-bearing — see file header
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule(CAPTURE_WORKLET_URL);
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'pcm-capture');
    const batchSamples = Math.floor(this.ctx.sampleRate * 0.128); // ~128 ms
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      this.pending.push(e.data);
      this.pendingLen += e.data.length;
      if (this.pendingLen >= batchSamples) {
        const merged = new Float32Array(this.pendingLen);
        let off = 0;
        for (const p of this.pending) { merged.set(p, off); off += p.length; }
        this.pending = [];
        this.pendingLen = 0;
        const down = downsample(merged, this.ctx!.sampleRate, MIC_TARGET_RATE);
        onChunk(int16ToBase64(floatTo16(down)));
      }
    };
    source.connect(this.node);
    // Worklet needs a destination path to keep pulling; gain 0 keeps it silent.
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.node.connect(sink);
    sink.connect(this.ctx.destination);
  }

  stop(): void {
    this.node?.port.close();
    this.node?.disconnect();
    this.node = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.pending = [];
    this.pendingLen = 0;
  }
}

/**
 * Sequential PCM16 playback with barge-in flush.
 * enqueue() schedules chunks gap-free; flush() hard-stops everything queued
 * (the Live API sends `interrupted` when its server VAD hears the driver).
 */
export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();

  private ensureCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  enqueue(base64Pcm16: string): void {
    const ctx = this.ensureCtx();
    const f32 = base64ToFloat32(base64Pcm16);
    if (!f32.length) return;
    const buf = ctx.createBuffer(1, f32.length, PLAYBACK_RATE);
    buf.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const t = Math.max(ctx.currentTime, this.nextTime);
    src.start(t);
    this.nextTime = t + buf.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  /** Barge-in: kill everything scheduled, reset the timeline. */
  flush(): void {
    for (const src of this.sources) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    this.sources.clear();
    this.nextTime = 0;
  }

  close(): void {
    this.flush();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
