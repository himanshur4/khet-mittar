/**
 * Sarvam AI speech-to-text (Saaras), text-to-speech (Bulbul) and translation (Mayura).
 * Request/response shapes from the official API reference (docs/PROBE_RESULTS.md).
 */
import { z } from "zod";
import { LANGUAGES } from "@config/languages";
import { MissingConfigError, ProviderError } from "@/core/lib/errors";
import { request } from "@/core/lib/http";
import type { SpeechProvider } from "./types";

const BASE_URL = "https://api.sarvam.ai";
const PROVIDER = "Sarvam AI";

export const SARVAM_MODELS = {
  stt: "saaras:v4",
  tts: "bulbul:v3",
  /**
   * Compared live on 1 Nov 2026: sarvam-translate (formal) gives plain Hindi and keeps "[S1]"
   * citation markers intact; mayura "modern-colloquial" answers in Hinglish and mayura "formal"
   * transliterates markers to "[एस1]". Mayura is kept only for "auto" source detection.
   */
  translate: "sarvam-translate:v1",
  translateAuto: "mayura:v1",
} as const;

/** Bulbul v3 accepts up to 2500 characters per request. */
export const TTS_MAX_CHARS = 2500;
/** Per-request limits: sarvam-translate 2000 characters, mayura 1000. */
const TRANSLATE_MAX_CHARS = { translate: 2000, translateAuto: 1000 } as const;

const sttResponse = z.object({
  transcript: z.string(),
  language_code: z.string().nullable().optional(),
});
const ttsResponse = z.object({ audios: z.array(z.string()).min(1) });
const translateResponse = z.object({ translated_text: z.string() });

async function parse<T>(res: Response, schema: z.ZodType<T>, what: string): Promise<T> {
  const parsed = schema.safeParse(await res.json().catch(() => null));
  if (!parsed.success)
    throw new ProviderError(PROVIDER, `unexpected ${what} response`, {
      cause: parsed.error.issues,
    });
  return parsed.data;
}

/** Splits long text at sentence ends so each piece fits one request. */
export function splitForLimit(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const pieces: string[] = [];
  let current = "";
  for (const sentence of text.split(/(?<=[.!?।])\s+/)) {
    if (current && current.length + sentence.length + 1 > max) {
      pieces.push(current);
      current = "";
    }
    current = current ? `${current} ${sentence}` : sentence.slice(0, max);
  }
  if (current) pieces.push(current);
  return pieces;
}

export function createSarvamSpeech(apiKey: string | undefined): SpeechProvider {
  const headers = () => {
    if (!apiKey) throw new MissingConfigError("Speech (Sarvam AI)", ["SARVAM_API_KEY"]);
    return { "api-subscription-key": apiKey };
  };

  return {
    async transcribe(audio, { language, keyterms }) {
      const form = new FormData();
      const ext = audio.type.includes("wav") ? "wav" : audio.type.includes("ogg") ? "ogg" : "webm";
      form.append("file", audio, `speech.${ext}`);
      form.append("model", SARVAM_MODELS.stt);
      form.append("language_code", language === "auto" ? "unknown" : LANGUAGES[language].bcp47);
      // Biasing recognition toward crop/market words improves accuracy on farming vocabulary.
      if (keyterms?.length) form.append("keyterms", JSON.stringify(keyterms.slice(0, 50)));
      const res = await request({
        provider: PROVIDER,
        url: `${BASE_URL}/speech-to-text`,
        init: { method: "POST", headers: headers(), body: form },
        timeoutMs: 20_000,
        retries: 1,
      });
      const data = await parse(res, sttResponse, "speech-to-text");
      return {
        text: data.transcript.trim(),
        detectedLanguage: data.language_code ?? null,
        provider: `${PROVIDER} ${SARVAM_MODELS.stt}`,
      };
    },

    async synthesize(text, { language }) {
      const res = await request({
        provider: PROVIDER,
        url: `${BASE_URL}/text-to-speech`,
        init: {
          method: "POST",
          headers: { ...headers(), "content-type": "application/json" },
          body: JSON.stringify({
            text: text.slice(0, TTS_MAX_CHARS),
            language_code: LANGUAGES[language].bcp47,
            model: SARVAM_MODELS.tts,
            speaker: LANGUAGES[language].ttsSpeaker,
            // MP3 is ~10x smaller than WAV, which matters on rural mobile data.
            output_audio_codec: "mp3",
          }),
        },
        timeoutMs: 20_000,
        retries: 1,
      });
      const data = await parse(res, ttsResponse, "text-to-speech");
      return {
        audioBase64: data.audios[0]!,
        mimeType: "audio/mpeg",
        provider: `${PROVIDER} ${SARVAM_MODELS.tts}`,
      };
    },

    async translate(text, { from, to }) {
      const which = from === "auto" ? "translateAuto" : "translate";
      const model = SARVAM_MODELS[which];
      const pieces = splitForLimit(text, TRANSLATE_MAX_CHARS[which]);
      const translated: string[] = [];
      for (const piece of pieces) {
        const res = await request({
          provider: PROVIDER,
          url: `${BASE_URL}/translate`,
          init: {
            method: "POST",
            headers: { ...headers(), "content-type": "application/json" },
            body: JSON.stringify({
              input: piece,
              source_language_code: from === "auto" ? "auto" : LANGUAGES[from].bcp47,
              target_language_code: LANGUAGES[to].bcp47,
              model,
              mode: "formal",
            }),
          },
          timeoutMs: 12_000,
          retries: 1,
        });
        translated.push((await parse(res, translateResponse, "translate")).translated_text);
      }
      return { text: translated.join(" "), provider: `${PROVIDER} ${model}` };
    },
  };
}
