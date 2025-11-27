// Voice utilities for speech recognition and text-to-speech

const SpeechRecognition =
  (typeof window !== "undefined" &&
    ((window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition)) ||
  null;

export interface VoiceState {
  isListening: boolean;
  transcript: string;
  isFinal: boolean;
}

export function initSpeechRecognition(
  onTranscript: (transcript: string, isFinal: boolean) => void,
  onError: (error: string) => void
): (() => void) | null {
  if (!SpeechRecognition) {
    onError("Speech Recognition not supported in this browser");
    return null;
  }

  const recognition = new (SpeechRecognition as any)();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onstart = () => {
    console.log("[voice] Speech recognition started");
  };

  recognition.onresult = (event: any) => {
    let interim = "";
    let isFinal = false;

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        isFinal = true;
        onTranscript(transcript, true);
      } else {
        interim += transcript + " ";
      }
    }

    if (interim) {
      onTranscript(interim.trim(), false);
    }
  };

  recognition.onerror = (event: any) => {
    console.error("[voice] Recognition error:", event.error);
    onError(event.error || "Speech recognition error");
  };

  recognition.onend = () => {
    console.log("[voice] Speech recognition ended");
  };

  const stopListening = () => {
    if (recognition) {
      recognition.stop();
    }
  };

  recognition.start();
  return stopListening;
}

export async function textToSpeech(
  text: string,
  onAudioReady: (blob: Blob) => void,
  onError: (error: string) => void
): Promise<void> {
  try {
    console.log("[voice-tts] Requesting audio for:", text.substring(0, 50));

    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || `TTS failed: ${res.status}`);
    }

    const blob = await res.blob();
    console.log("[voice-tts] Audio generated, size:", blob.size);
    onAudioReady(blob);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[voice-tts] Error:", msg);
    onError(msg);
  }
}

export function playAudio(blob: Blob, onEnd?: () => void): void {
  try {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    
    if (onEnd) {
      audio.onended = () => {
        URL.revokeObjectURL(url);
        onEnd();
      };
    }

    console.log("[voice-play] Playing audio");
    audio.play().catch((err) => console.error("[voice-play] Error:", err));
  } catch (err) {
    console.error("[voice-play] Error:", err);
  }
}
