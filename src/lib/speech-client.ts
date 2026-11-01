/**
 * Browser-side speech: record → server STT (Sarvam), with the Web Speech API as fallback;
 * server TTS (Sarvam) with speechSynthesis as fallback. Every failure resolves to a typed
 * reason so the UI can explain it and text input keeps working.
 */
import { LANGUAGES, type LanguageId } from "@config/languages";

export type SpeechFailure =
  "mic-denied" | "mic-unavailable" | "no-speech" | "unsupported" | "server-failed";

export class SpeechError extends Error {
  constructor(readonly reason: SpeechFailure) {
    super(reason);
  }
}

/** Sarvam's synchronous STT accepts up to 30 s; stop a little earlier to be safe. */
export const MAX_RECORDING_MS = 28_000;

// Minimal typing for the (still prefixed in Chrome) Web Speech recognition API.
interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const browserRecognitionAvailable = () => recognitionCtor() !== null;
export const recordingAvailable = () =>
  typeof window !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia) &&
  typeof MediaRecorder !== "undefined";

export interface Recorder {
  stop(): Promise<Blob>;
  cancel(): void;
}

export async function startRecording(onAutoStop: () => void): Promise<Recorder> {
  if (!recordingAvailable()) throw new SpeechError("unsupported");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    throw new SpeechError(
      name === "NotAllowedError" || name === "SecurityError" ? "mic-denied" : "mic-unavailable",
    );
  }
  const mimeType = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ].find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    };
  });
  recorder.start();
  const timer = setTimeout(onAutoStop, MAX_RECORDING_MS);
  return {
    async stop() {
      clearTimeout(timer);
      if (recorder.state !== "inactive") recorder.stop();
      return stopped;
    },
    cancel() {
      clearTimeout(timer);
      if (recorder.state !== "inactive") recorder.stop();
    },
  };
}

export async function transcribeOnServer(audio: Blob, language: LanguageId): Promise<string> {
  const form = new FormData();
  form.append("audio", audio, "speech.webm");
  form.append("language", language);
  const res = await fetch("/api/speech/stt", { method: "POST", body: form });
  if (!res.ok) throw new SpeechError("server-failed");
  const data = (await res.json()) as { text?: string };
  if (!data.text?.trim()) throw new SpeechError("no-speech");
  return data.text.trim();
}

/** One-shot recognition with the browser's built-in engine (Chrome/Edge support hi-IN). */
export function recognizeInBrowser(language: LanguageId): {
  result: Promise<string>;
  stop: () => void;
} {
  const Ctor = recognitionCtor();
  if (!Ctor) return { result: Promise.reject(new SpeechError("unsupported")), stop: () => {} };
  const rec = new Ctor();
  rec.lang = LANGUAGES[language].bcp47;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  const result = new Promise<string>((resolve, reject) => {
    let text = "";
    rec.onresult = (event) => {
      text = Array.from(event.results)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ")
        .trim();
    };
    rec.onerror = (event) =>
      reject(
        new SpeechError(
          event.error === "not-allowed"
            ? "mic-denied"
            : event.error === "no-speech"
              ? "no-speech"
              : "server-failed",
        ),
      );
    rec.onend = () => (text ? resolve(text) : reject(new SpeechError("no-speech")));
  });
  rec.start();
  return { result, stop: () => rec.stop() };
}

let currentAudio: HTMLAudioElement | null = null;

export function stopSpeaking(): void {
  currentAudio?.pause();
  currentAudio = null;
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

/** Reads text aloud: Sarvam voice first, then the browser voice. Resolves with what was used. */
export async function speak(
  text: string,
  language: LanguageId,
): Promise<"server" | "browser" | "none"> {
  stopSpeaking();
  try {
    const res = await fetch("/api/speech/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, language }),
    });
    if (res.ok) {
      const data = (await res.json()) as { audioBase64: string; mimeType: string };
      const audio = new Audio(`data:${data.mimeType};base64,${data.audioBase64}`);
      currentAudio = audio;
      await audio.play();
      return "server";
    }
  } catch {
    // fall through to the browser voice
  }
  if (typeof window === "undefined" || !window.speechSynthesis) return "none";
  const utterance = new SpeechSynthesisUtterance(
    text.replace(/\s*\[S\d+(?:\s*,\s*S\d+)*\]/g, "").replace(/[*_#`]/g, ""),
  );
  utterance.lang = LANGUAGES[language].bcp47;
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang === utterance.lang);
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
  return "browser";
}
