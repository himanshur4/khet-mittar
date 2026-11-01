import type { LanguageId } from "@config/languages";

export interface Transcript {
  text: string;
  /** BCP-47 code detected by the provider, if any. */
  detectedLanguage: string | null;
  provider: string;
}

export interface SynthesizedSpeech {
  audioBase64: string;
  mimeType: string;
  provider: string;
}

/** Port for speech + translation; the browser Web Speech API is the client-side fallback. */
export interface SpeechProvider {
  transcribe(
    audio: Blob,
    options: { language: LanguageId | "auto"; keyterms?: string[] },
  ): Promise<Transcript>;
  synthesize(text: string, options: { language: LanguageId }): Promise<SynthesizedSpeech>;
  translate(
    text: string,
    options: { from: LanguageId | "auto"; to: LanguageId },
  ): Promise<{ text: string; provider: string }>;
}
