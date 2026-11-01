/** Cheap checks on the farmer's message before spending an LLM call on it. */
import type { LanguageId } from "@config/languages";

export const MAX_QUESTION_CHARS = 1000;

export type InputCheck =
  | { ok: true; text: string }
  | { ok: false; reason: "empty" | "too_long" | "no_words"; reply: string };

const REPLIES: Record<LanguageId, Record<"empty" | "too_long" | "no_words", string>> = {
  en: {
    empty: "Please type or speak your question about your crop, weather or mandi prices.",
    too_long: `Please keep your question shorter (under ${MAX_QUESTION_CHARS} characters).`,
    no_words:
      "I could not understand that. Please ask about your crop, the weather, soil or mandi prices.",
  },
  hi: {
    empty: "कृपया अपनी फसल, मौसम या मंडी भाव के बारे में सवाल लिखें या बोलें।",
    too_long: `कृपया सवाल थोड़ा छोटा रखें (${MAX_QUESTION_CHARS} अक्षरों से कम)।`,
    no_words: "मैं समझ नहीं पाया। कृपया अपनी फसल, मौसम, मिट्टी या मंडी भाव के बारे में पूछें।",
  },
};

export function checkInput(raw: string, language: LanguageId): InputCheck {
  // Control characters can't help the model and can break logs.
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (!text) return { ok: false, reason: "empty", reply: REPLIES[language].empty };
  if (text.length > MAX_QUESTION_CHARS) {
    return { ok: false, reason: "too_long", reply: REPLIES[language].too_long };
  }
  // At least two letters in any script: rejects "???", "1234", emoji-only input.
  if ((text.match(/\p{L}/gu) ?? []).length < 2) {
    return { ok: false, reason: "no_words", reply: REPLIES[language].no_words };
  }
  return { ok: true, text };
}
