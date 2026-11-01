/** Languages the farmer can use. Codes are BCP-47 as expected by Sarvam AI and browsers. */
export const LANGUAGE_IDS = ["hi", "en"] as const;
export type LanguageId = (typeof LANGUAGE_IDS)[number];

export interface LanguageInfo {
  id: LanguageId;
  label: string;
  /** Sarvam STT/TTS/translate code and browser SpeechRecognition / speechSynthesis lang. */
  bcp47: "hi-IN" | "en-IN";
  /** Bulbul v3 speaker (lowercase, documented list). Bulbul voices are multilingual. */
  ttsSpeaker: string;
  /** Language name used inside LLM prompts. */
  promptName: string;
}

export const LANGUAGES: Record<LanguageId, LanguageInfo> = {
  hi: { id: "hi", label: "हिन्दी", bcp47: "hi-IN", ttsSpeaker: "priya", promptName: "Hindi" },
  en: { id: "en", label: "English", bcp47: "en-IN", ttsSpeaker: "priya", promptName: "English" },
};

export function isLanguageId(value: string): value is LanguageId {
  return (LANGUAGE_IDS as readonly string[]).includes(value);
}
