// client/src/lib/voice/RealtimeSession.ts
// 2026-08-11 (todo #33): GPT Realtime (WebRTC) arm of the Coach voice switcher.
//
// Transport: WebRTC peer connection — mic goes up as a media track, the
// model's voice comes back as a remote track, and JSON events ride the
// 'oai-events' data channel. WebRTC is this arm's echo advantage: the
// browser's WebRTC stack invokes the OS-level AEC path, which matters for a
// phone-on-speaker driver with no headphones.
// Auth: ephemeral client_secret minted by our backend
// (POST /api/realtime/token — ownership-checked, GA endpoint; the real
// OPENAI_API_KEY never reaches the browser). SDP answer comes from
// api.openai.com/v1/realtime/calls (GA WebRTC endpoint).
//
// Event names: the GA event schema is handled first with beta-era fallbacks
// kept defensively — the A/B test on a real phone is the arbiter here, and
// unknown events log at debug rather than throwing.

import { API_ROUTES } from '@/constants/apiRoutes';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import {
  type VoiceSession,
  type VoiceSessionOptions,
  type VoiceTokenContext,
  buildMouthInstructions,
  buildRelayEnvelope,
  ASK_COACH_TOOL,
} from './types';

interface MintResponse {
  ok: boolean;
  token: string;
  model: string;
  context?: VoiceTokenContext;
  error?: string;
}

const SDP_ENDPOINT = 'https://api.openai.com/v1/realtime/calls';

export class RealtimeSession implements VoiceSession {
  readonly mode = 'openai' as const;
  private opts: VoiceSessionOptions;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private stopped = false;

  // 2026-08-14 (unified voice thread): turn accumulation + relay machinery.
  // Model transcript deltas accumulate here; user turns arrive final-only
  // (whisper-1 input transcription has no interim events).
  private modelBuf = '';
  private activeResponseId: string | null = null;
  // sayText relays: response.create during an active response errors
  // (conversation_already_has_active_response) — queue and dispatch on
  // response.done. The relay response's OWN transcript events are suppressed
  // by response id (the answer text is already in the chat thread).
  private sayQueue: string[] = [];
  private expectRelayResponse = false;
  private suppressedResponseIds = new Set<string>();

  constructor(opts: VoiceSessionOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    const { events } = this.opts;
    events.onStatus('connecting');

    // Same iOS audio-routing declaration as the Gemini arm (see its start()):
    // audible with ringer off, correct call routing. Applied synchronously
    // inside the user's tap.
    try {
      (navigator as any).audioSession.type = 'play-and-record';
    } catch { /* API absent outside Safari — fine */ }

    // 1. Mint the ephemeral client_secret (backend enforces auth + ownership).
    const authToken = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    const res = await fetch(API_ROUTES.REALTIME.TOKEN, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authToken && { Authorization: `Bearer ${authToken}` }),
      },
      body: JSON.stringify({ userId: this.opts.userId, snapshotId: this.opts.snapshotId }),
    });
    const mint = (await res.json()) as MintResponse;
    if (!res.ok || !mint.ok || !mint.token) {
      throw new Error(mint.error || `Realtime token mint failed (HTTP ${res.status})`);
    }

    // 2. Mic inside the user-gesture chain. AEC constraints are explicit even
    //    though WebRTC would usually default them on — determinism over vibes.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    // 3. Peer connection: mic up, model voice down.
    this.pc = new RTCPeerConnection();
    for (const track of this.stream.getTracks()) this.pc.addTrack(track, this.stream);

    this.audioEl = new Audio();
    this.audioEl.autoplay = true;
    // playsinline: without it iOS pushes the model's voice into the fullscreen
    // system player instead of playing inside the page.
    this.audioEl.setAttribute('playsinline', 'true');
    this.pc.ontrack = (e) => {
      if (this.audioEl && e.streams[0]) {
        this.audioEl.srcObject = e.streams[0];
        void this.audioEl.play().catch(() => undefined); // gesture already granted
      }
    };

    this.pc.onconnectionstatechange = () => {
      const s = this.pc?.connectionState;
      if (this.stopped) return;
      if (s === 'connected') events.onStatus('live', mint.model);
      else if (s === 'failed' || s === 'disconnected' || s === 'closed') {
        events.onStatus('ended', `peer connection ${s}`);
        this.stop();
      }
    };

    // 4. Data channel: session config on open, events in.
    this.dc = this.pc.createDataChannel('oai-events');
    this.dc.onopen = () => {
      this.dcSend({
        type: 'session.update',
        session: {
          // GA schema: session.type is REQUIRED in every session.update —
          // omitting it is rejected with "Missing required parameter:
          // session.type" (hit live in the 2026-08-12 phone A/B). The server
          // mint (server/api/chat/realtime.js) already sends it.
          type: 'realtime',
          instructions: buildMouthInstructions(mint.context),
          tools: [
            {
              type: 'function',
              name: ASK_COACH_TOOL.name,
              description: ASK_COACH_TOOL.description,
              parameters: ASK_COACH_TOOL.parameters,
            },
          ],
          tool_choice: 'auto',
        },
      });
    };
    this.dc.onmessage = (e) => {
      try {
        this.handleEvent(JSON.parse(e.data));
      } catch { /* non-JSON frame */ }
    };

    // 5. SDP negotiation against the GA calls endpoint.
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    const sdpRes = await fetch(`${SDP_ENDPOINT}?model=${encodeURIComponent(mint.model)}`, {
      method: 'POST',
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${mint.token}`,
        'Content-Type': 'application/sdp',
      },
    });
    if (!sdpRes.ok) {
      const detail = await sdpRes.text().catch(() => '');
      throw new Error(`Realtime SDP exchange failed (HTTP ${sdpRes.status}) ${detail.slice(0, 200)}`);
    }
    const answerSdp = await sdpRes.text();
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  }

  private dcSend(payload: any): void {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(payload));
  }

  /** delta/done transcript events carry response_id top-level; response.*
   *  lifecycle events nest it at response.id. Read both defensively. */
  private eventResponseId(event: any): string | undefined {
    return event?.response_id ?? event?.response?.id;
  }

  private handleEvent(event: any): void {
    const { events } = this.opts;
    switch (event?.type) {
      // Driver started speaking — no interim text exists (whisper-1 is
      // final-only), but the UI can show a listening ghost line.
      case 'input_audio_buffer.speech_started':
        events.onUserTranscriptDelta('…');
        break;

      // Driver's speech transcript (whisper-1 input transcription, configured
      // server-side in the mint). Final-only — commits the turn directly.
      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript) events.onUserTurnFinal(String(event.transcript).trim());
        break;

      // Response lifecycle — needed for relay queueing + suppression.
      case 'response.created': {
        const id = this.eventResponseId(event);
        if (id) {
          this.activeResponseId = id;
          if (this.expectRelayResponse) {
            this.suppressedResponseIds.add(id);
            this.expectRelayResponse = false;
          }
        }
        break;
      }
      case 'response.done': {
        const id = this.eventResponseId(event);
        if (id) this.suppressedResponseIds.delete(id);
        this.activeResponseId = null;
        const queued = this.sayQueue.shift();
        if (queued) this.dispatchRelay(queued);
        break;
      }

      // Model speech transcript — GA name first, beta-era fallback second.
      // Deltas accumulate; the emitted delta is the whole line so far.
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta': {
        const id = this.eventResponseId(event);
        if (id && this.suppressedResponseIds.has(id)) break; // relay speech
        if (event.delta) {
          this.modelBuf += event.delta;
          events.onModelTranscriptDelta(this.modelBuf);
        }
        break;
      }
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done': {
        const id = this.eventResponseId(event);
        const full = String(event.transcript ?? this.modelBuf).trim();
        this.modelBuf = '';
        if (id && this.suppressedResponseIds.has(id)) break; // relay speech
        if (full) events.onModelTurnFinal(full);
        break;
      }

      // Function call completed → run the brain, return output, ask for the
      // spoken follow-up response.
      case 'response.output_item.done': {
        const item = event.item;
        if (item?.type === 'function_call' && item.name === ASK_COACH_TOOL.name) {
          let question = '';
          try { question = JSON.parse(item.arguments || '{}').question ?? ''; } catch { /* malformed args */ }
          void this.runBrainCall(item.call_id, question);
        }
        break;
      }

      case 'error':
        events.onError(event.error?.message || 'Realtime session error');
        break;

      default:
        // Unknown/uninteresting event types are expected — GA schema evolves.
        break;
    }
  }

  private async runBrainCall(callId: string, question: string): Promise<void> {
    let answer: string;
    try {
      answer = await this.opts.askCoachBrain(question);
    } catch (err) {
      answer = `The coach backend could not be reached (${err instanceof Error ? err.message : 'unknown error'}). Tell the driver you couldn't check right now.`;
    }
    if (this.stopped) return;
    this.dcSend({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output: JSON.stringify({ answer }) },
    });
    this.dcSend({ type: 'response.create' });
  }

  /** Tap-to-talk pause: WebRTC transmits silence (track.enabled=false), so
   *  server VAD never fires. Session stays warm; resume is always a user tap. */
  pauseMic(): void {
    this.stream?.getAudioTracks().forEach((t) => { t.enabled = false; });
    this.opts.events.onUserTranscriptDelta('');
  }

  resumeMic(): void {
    this.stream?.getAudioTracks().forEach((t) => { t.enabled = true; });
  }

  /** Speak a chat-screen answer through the mouth (see VoiceSession.sayText). */
  sayText(text: string, context?: { userMessage?: string }): void {
    if (this.stopped || this.dc?.readyState !== 'open') return;
    const envelope = buildRelayEnvelope(text, context);
    if (this.activeResponseId) {
      // response.create during an active response errors — queue for
      // dispatch on response.done.
      this.sayQueue.push(envelope);
      return;
    }
    this.dispatchRelay(envelope);
  }

  private dispatchRelay(envelope: string): void {
    if (this.stopped) return;
    // Per-response instructions (GA): no fake user message enters the
    // conversation; the generated response still joins context
    // (conversation: 'auto' default) so voice follow-ups work.
    this.expectRelayResponse = true;
    this.dcSend({ type: 'response.create', response: { instructions: envelope } });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.dc?.close();
    this.dc = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.srcObject = null;
      this.audioEl = null;
    }
    this.pc?.close();
    this.pc = null;
    this.sayQueue = [];
    this.suppressedResponseIds.clear();
    // Commit any in-flight coach line so the thread keeps what was heard.
    if (this.modelBuf.trim()) {
      this.opts.events.onModelTurnFinal(this.modelBuf.trim());
    }
    this.modelBuf = '';
    this.opts.events.onStatus('ended');
  }
}
