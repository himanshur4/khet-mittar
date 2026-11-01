import { CROPS } from "@config/crops";

/**
 * Converts an answer into something pleasant to hear: no "[S1]" markers, no markdown symbols,
 * and the guardrail's bracketed notice dropped.
 */
export function toSpeakableText(answer: string): string {
  return answer
    .replace(/\s*\[S\d+(?:\s*,\s*S\d+)*\]/g, "")
    .replace(/^\s*\(.*\)\s*$/gm, "")
    .replace(/[*_#`>]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Vocabulary hints for speech recognition (crop names in both languages, market words). */
export const STT_KEYTERMS: string[] = [
  ...Object.values(CROPS).flatMap((c) => [c.names.en, c.names.hi]),
  "mandi",
  "मंडी",
  "KVK",
  "खाद",
  "सिंचाई",
  "बारिश",
  "कीट",
];
