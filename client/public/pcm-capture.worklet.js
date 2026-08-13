// client/public/pcm-capture.worklet.js
// 2026-08-11 (todo #33): mic-capture AudioWorklet for the Gemini Live voice arm.
// Served as a static file from 'self' — a Blob-URL module would need script-src
// blob: in the CSP (worklets are governed by script-src, and Melody's phone test
// surfaced exactly that block: "Unable to load a worklet's module"). Loading
// from 'self' keeps the CSP tight instead of widening it.
// Consumed by client/src/lib/voice/pcm.ts (MicCapture).

class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
