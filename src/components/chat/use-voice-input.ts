"use client";

import { useCallback, useRef, useState } from "react";
import type { LanguageId } from "@config/languages";
import {
  browserRecognitionAvailable,
  recognizeInBrowser,
  recordingAvailable,
  SpeechError,
  startRecording,
  transcribeOnServer,
  type Recorder,
  type SpeechFailure,
} from "@/lib/speech-client";

export type VoiceState = "idle" | "recording" | "transcribing";

/**
 * Mic button logic. Prefers server STT (Sarvam, better for Indian languages) and falls back to
 * the browser's recognizer if the server is unavailable or fails mid-session.
 */
export function useVoiceInput(options: {
  language: LanguageId;
  serverAvailable: boolean;
  onText: (text: string) => void;
  onError: (reason: SpeechFailure | "switched-to-browser") => void;
}) {
  const [state, setState] = useState<VoiceState>("idle");
  const [forceBrowser, setForceBrowser] = useState(false);
  const recorder = useRef<Recorder | null>(null);
  const browserStop = useRef<(() => void) | null>(null);
  const { language, serverAvailable, onText, onError } = options;

  const useServer = serverAvailable && !forceBrowser && recordingAvailable();
  const supported = useServer || browserRecognitionAvailable();

  const runBrowser = useCallback(() => {
    const session = recognizeInBrowser(language);
    browserStop.current = session.stop;
    setState("recording");
    session.result
      .then(onText)
      .catch((e: unknown) => onError(e instanceof SpeechError ? e.reason : "server-failed"))
      .finally(() => {
        browserStop.current = null;
        setState("idle");
      });
  }, [language, onText, onError]);

  const finishRecording = useCallback(async () => {
    const active = recorder.current;
    if (!active) return;
    recorder.current = null;
    setState("transcribing");
    try {
      const audio = await active.stop();
      onText(await transcribeOnServer(audio, language));
    } catch (e) {
      const reason = e instanceof SpeechError ? e.reason : "server-failed";
      if (reason === "server-failed" && browserRecognitionAvailable()) {
        setForceBrowser(true);
        onError("switched-to-browser");
      } else {
        onError(reason);
      }
    } finally {
      setState("idle");
    }
  }, [language, onText, onError]);

  const toggle = useCallback(async () => {
    if (state === "transcribing") return;
    if (state === "recording") {
      if (browserStop.current) browserStop.current();
      else await finishRecording();
      return;
    }
    if (!useServer) {
      if (browserRecognitionAvailable()) runBrowser();
      else onError("unsupported");
      return;
    }
    try {
      recorder.current = await startRecording(() => void finishRecording());
      setState("recording");
    } catch (e) {
      onError(e instanceof SpeechError ? e.reason : "mic-unavailable");
    }
  }, [state, useServer, runBrowser, finishRecording, onError]);

  return { state, toggle, supported };
}
