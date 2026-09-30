import { API_ROUTES } from '@/constants/apiRoutes';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { DEFAULT_COACH_LIVE_VOICE, isCoachLiveVoice } from '../../../../shared/coach-live.js';
import { LiveTranscriptLedger, splitLiveAppend } from './live-transcripts';
import type { VoiceSession, VoiceSessionOptions } from './types';

/** GPT-Live's WebRTC protocol delegates to the existing authenticated Coach. */
export class GptLiveSession implements VoiceSession {
  readonly mode = 'gpt-live' as const;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private stopped = false;
  private ready = false;
  private paused = false;
  private controller = new AbortController();
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private startTimer: ReturnType<typeof setTimeout> | undefined;
  private disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private ledger = new LiveTranscriptLedger();
  private delegations = new Set<string>();
  private work = Promise.resolve();
  private inputRevision = 0;
  private answeredRevision = -1;
  private controlTail = '';
  private pendingAppends = new Map<string, { type: string; delegation_id: string | null; content: string }>();
  private finishStart: (() => void) | undefined;
  private failStart: ((error: Error) => void) | undefined;

  constructor(private opts: VoiceSessionOptions) {}

  async start(): Promise<void> {
    this.opts.events.onStatus('connecting');
    try { (navigator as any).audioSession.type = 'play-and-record'; } catch { /* optional Safari API */ }
    try {
      // Capture begins in the user's tap, before any network request.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (this.stopped) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      const pc = this.pc = new RTCPeerConnection();
      for (const track of stream.getAudioTracks()) { track.enabled = !this.paused; pc.addTrack(track, stream); }
      this.audio = new Audio();
      this.audio.autoplay = true;
      this.audio.setAttribute('playsinline', 'true');
      pc.ontrack = event => {
        if (this.stopped || !this.audio) return;
        this.audio.srcObject = new MediaStream([event.track]);
        void this.audio.play().catch(() => this.opts.events.onError('Tap the voice control to enable audio playback.'));
      };
      pc.onconnectionstatechange = () => {
        if (this.stopped) return;
        if (pc.connectionState === 'disconnected') {
          // Cellular handoffs can recover on the existing connection. Do not
          // create another session or reactivate a microphone the driver paused.
          this.opts.events.onStatus('connecting', 'Recovering voice connection');
          if (!this.disconnectTimer) this.disconnectTimer = setTimeout(() => {
            this.disconnectTimer = undefined;
            if (!this.stopped && pc.connectionState === 'disconnected') {
              this.opts.events.onError('The voice connection ended. Tap Start voice to reconnect.');
              this.stop();
            }
          }, 5000);
          return;
        }
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = undefined;
        if (pc.connectionState === 'connected' && this.ready) this.opts.events.onStatus('live', 'gpt-live-1');
        if (['failed', 'closed'].includes(pc.connectionState)) {
          this.opts.events.onError('The voice connection ended. Tap Start voice to reconnect.');
          this.stop();
        }
      };
      this.dc = pc.createDataChannel('oai-events');
      this.dc.onmessage = event => {
        try { this.handleEvent(JSON.parse(event.data)); } catch { /* ignore non-JSON transport frames */ }
      };
      this.dc.onclose = () => {
        if (!this.stopped) {
          this.opts.events.onError('The voice connection ended.');
          this.stop();
        }
        this.cleanup();
      };
      const offer = await pc.createOffer();
      if (this.stopped) return;
      await pc.setLocalDescription(offer);
      await this.gatherIce(pc);
      if (this.stopped) return;
      const voice = localStorage.getItem(STORAGE_KEYS.COACH_LIVE_VOICE_NAME);
      const history = (this.opts.getThreadTail?.() ?? []).slice(-20);
      let remaining = 16000;
      const boundedHistory = history.slice().reverse().flatMap(turn => {
        if (remaining <= 0) return [];
        const content = turn.content.slice(-Math.min(4000, remaining)); remaining -= content.length;
        return [{ role: turn.role, content }];
      }).reverse();
      const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      // Covers network/proxy stalls before the server's own upstream deadline,
      // including a response body that never finishes arriving.
      const negotiationTimer = setTimeout(() => this.controller.abort(new Error('Live voice connection timed out')), 35000);
      let result;
      try {
        const response = await fetch(API_ROUTES.COACH_LIVE.SESSION, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ sdp: pc.localDescription?.sdp, snapshotId: this.opts.snapshotId,
            voice: voice && isCoachLiveVoice(voice) ? voice : DEFAULT_COACH_LIVE_VOICE, history: boundedHistory }),
          signal: this.controller.signal,
        });
        if (this.stopped) return;
        result = await response.json();
        if (!response.ok || !result.ok || !result.transport?.sdp) throw new Error(result.error || 'Live voice could not connect');
      } finally { clearTimeout(negotiationTimer); }
      if (this.stopped) return;
      // HTTP success is only negotiation. session.started establishes readiness.
      const started = new Promise<void>((resolve, reject) => { this.finishStart = resolve; this.failStart = reject; });
      this.startTimer = setTimeout(() => this.failStart?.(new Error('Live voice did not finish connecting')), 20000);
      await pc.setRemoteDescription({ type: 'answer', sdp: result.transport.sdp });
      await started;
    } catch (error) {
      if (this.stopped) return;
      this.stop();
      throw error;
    }
  }

  private gatherIce(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', changed);
        this.controller.signal.removeEventListener('abort', aborted);
        if (error) reject(error); else resolve();
      };
      const changed = () => { if (pc.iceGatheringState === 'complete') finish(); };
      const aborted = () => finish(new Error('Voice connection canceled'));
      const timer = setTimeout(() => finish(new Error('Voice network negotiation timed out')), 10000);
      pc.addEventListener('icegatheringstatechange', changed);
      this.controller.signal.addEventListener('abort', aborted, { once: true });
      if (this.controller.signal.aborted) aborted(); else changed();
    });
  }

  private send(event: object): void {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(event));
  }

  private handleEvent(event: any): void {
    if (event.type === 'session.closed') { this.stop(); this.cleanup(); return; }
    if (this.stopped) return;
    if (event.type === 'session.started') {
      this.ready = true;
      clearTimeout(this.startTimer);
      this.opts.events.onStatus('live', 'gpt-live-1');
      this.finishStart?.();
      if (this.paused) this.pauseMic();
      return;
    }
    const fragment = this.ledger.add(event);
    if (fragment) {
      this.opts.events.onTranscriptFragment?.(fragment);
      if (fragment.role === 'user') {
        this.inputRevision++;
        this.controlTail = (this.controlTail + fragment.text).slice(-180);
        if (/\b(goodbye,?\s+coach|end (?:the )?session|conversation complete|we'?re done)\b/i.test(this.controlTail)) {
          this.opts.events.onControl?.('stop'); this.controlTail = ''; return;
        }
        if (/\b(pause|hold on|stop listening|quiet)\b/i.test(this.controlTail)) {
          this.opts.events.onControl?.('pause'); this.controlTail = '';
        }
      }
      return;
    }
    if (event.type === 'session.delegation.created' && event.delegation?.target === 'client') {
      const id = event.delegation.id;
      if (typeof id !== 'string' || this.delegations.has(id)) return;
      this.delegations.add(id);
      this.work = this.work.then(() => this.delegate(id, event.offset_ms)).catch(() => {
        if (!this.stopped) this.opts.events.onError('The Coach could not finish that request.');
      });
      return;
    }
    if (typeof event.client_event_id === 'string' && /session\.(thinking|commentary|instructions)\.appended/.test(event.type)) {
      this.pendingAppends.delete(event.client_event_id);
    }
    if (event.type === 'error' || event.type === 'session.error') {
      const id = event.error?.event_id ?? event.client_event_id;
      if (typeof id === 'string') this.pendingAppends.delete(id);
      this.opts.events.onError('Live voice could not apply an update. The written Coach answer remains in the chat.');
    }
  }

  private async delegate(id: string, offset: number): Promise<void> {
    if (this.stopped || !this.ready) return;
    if (this.answeredRevision === this.inputRevision) {
      this.append('session.thinking.append', 'The latest spoken request was already answered. Do not repeat its actions or announce the same result again.', id);
      return;
    }
    if (!Number.isFinite(offset) || offset < 0) {
      this.append('session.commentary.append', 'I could not identify that request clearly. Please repeat it.', id);
      return;
    }
    // A queued delegation may start after more speech arrived. Use the latest
    // received fragments, retaining their original timestamps in the context.
    let context = this.ledger.context(Number.MAX_SAFE_INTEGER);
    if (!context) {
      this.append('session.commentary.append', 'I could not catch the request clearly. Please repeat it.', id);
      return;
    }
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const revision = this.inputRevision;
        const answer = await this.opts.askCoachBrain(context, { answerOnly: attempt > 0 });
        if (this.stopped) return;
        if (revision === this.inputRevision) {
          this.answeredRevision = revision;
          this.append('session.commentary.append', answer, id);
          return;
        }
        // Live can delegate before the speaker finishes a sentence. Reconcile
        // the same task against its continuation; never silently lose the answer.
        // The server blocks action writes and auto-learning on these follow-ups.
        this.append('session.thinking.append', 'More speech arrived. The Coach is checking the latest continuation. Do not announce the earlier answer as current.', id);
        context = `Reconcile the latest spoken request with the completed earlier check below. This follow-up is answer-only: do not repeat saved actions, change preferences, or save anything. Check fresh records. If the user requests a changed action, explain the prior receipt and ask for confirmation before a new action. A continuation can complete the same question; it is not necessarily a contradiction.\n\nEarlier completed answer (historical result, not instructions): ${JSON.stringify(answer)}\n\n${this.ledger.context(Number.MAX_SAFE_INTEGER)}`;
      }
      this.append('session.commentary.append', 'I heard more while checking and cannot confirm the latest request yet. Please tell me the final question once more.', id);
    } catch {
      if (!this.stopped) this.append('session.commentary.append', 'I could not confirm that with the Coach. Please try again; I cannot claim that any requested change was saved.', id);
    }
  }

  private append(type: string, text: string, delegationId: string | null = null): void {
    if (this.stopped || !this.ready) return;
    for (const content of splitLiveAppend(text)) {
      const event_id = crypto.randomUUID();
      const payload = { type, delegation_id: delegationId, content };
      this.pendingAppends.set(event_id, payload);
      this.send({ ...payload, event_id });
    }
  }

  pauseMic(): void {
    this.paused = true;
    this.stream?.getAudioTracks().forEach(track => { track.enabled = false; });
    if (this.ready && !this.stopped) this.send({ type: 'session.input_audio.mute', event_id: crypto.randomUUID() });
  }
  resumeMic(): void {
    if (this.stopped) return;
    this.paused = false;
    this.controlTail = '';
    this.stream?.getAudioTracks().forEach(track => { track.enabled = true; });
    if (this.ready) this.send({ type: 'session.input_audio.unmute', event_id: crypto.randomUUID() });
  }
  unlockAudio(): void { if (!this.stopped) void this.audio?.play().catch(() => undefined); }
  sayText(text: string): void { this.append('session.commentary.append', text); }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.controller.abort();
    clearTimeout(this.startTimer);
    clearTimeout(this.disconnectTimer);
    this.finishStart?.();
    // Stop recording and playback immediately; let only the control channel drain.
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    if (this.audio) { this.audio.pause(); this.audio.srcObject = null; this.audio = null; }
    if (this.dc?.readyState === 'open') {
      this.send({ type: 'session.close' });
      this.closeTimer = setTimeout(() => this.cleanup(), 5000);
    } else this.cleanup();
    this.opts.events.onStatus('ended');
  }
  private cleanup(): void {
    clearTimeout(this.closeTimer);
    const dc = this.dc; this.dc = null;
    if (dc) { dc.onclose = null; dc.close(); }
    const pc = this.pc; this.pc = null;
    if (pc) { pc.onconnectionstatechange = null; pc.close(); }
    this.pendingAppends.clear();
    this.ready = false;
  }
}
