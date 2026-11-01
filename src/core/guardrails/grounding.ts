/**
 * Grounding guardrail: runs on the model's final answer before the farmer sees it.
 *
 * Concept: LLMs can "hallucinate" fluent but invented numbers. We cannot check meaning
 * cheaply, but we can check numbers: every number in the answer must appear in the evidence
 * (tool results, retrieved passages, profile facts). Sentences with unverifiable numbers are
 * removed; verified ones get a citation if the model forgot one; doses need an official
 * document as evidence.
 */
import type { LanguageId } from "@config/languages";

export interface EvidenceItem {
  /** Citation id (S1…) for tool/document evidence; null for profile facts from the prompt. */
  citationId: string | null;
  kind: "tool" | "document" | "profile";
  text: string;
}

export interface GuardrailReport {
  numericClaims: number;
  supported: number;
  autoCited: number;
  removed: Array<{ text: string; reason: "unsupported_number" | "unsupported_dose" }>;
  unknownCitationIds: string[];
  languageMismatch: boolean;
}

const DEVANAGARI_DIGIT = /[०-९]/g;
const NUMBER = /\d+(?:,\d{2,3})*(?:\.\d+)?/g;
const CITATION = /\s*\[(S\d+(?:\s*,\s*S\d+)*)\]/g;
const LIST_MARKER = /^(\s*(?:[-*•]|\d{1,2}[.)])\s+)/;
const SENTENCE_BREAK = /(?<=[.!?।])\s+/;

/**
 * Dose-like phrases in English and Hindi: "2 ml/litre", "500 g per acre", "@ 2.5 kg",
 * "2 मिली प्रति लीटर".
 */
const DOSE_PATTERNS = [
  /\d+(?:\.\d+)?\s*(?:ml|g|gm|gram|grams|kg|l|lit|litre|liter|litres|liters)\s*(?:\/|per)\s*(?:l\b|lit|litre|liter|acre|ha\b|hectare|tank|pump|kanal|bigha|100)/i,
  /@\s*\d/,
  /\d+(?:\.\d+)?\s*(?:मिली|मि\.ली\.|ग्राम|किलो|किग्रा|लीटर)\s*(?:\/|प्रति)/,
];

export function normalizeDigits(text: string): string {
  return text.replace(DEVANAGARI_DIGIT, (d) => String(d.charCodeAt(0) - 0x0966));
}

interface NumberToken {
  value: number;
  decimals: number;
}

export function numbersIn(text: string): NumberToken[] {
  const clean = normalizeDigits(text).replace(CITATION, " ");
  return [...clean.matchAll(NUMBER)].map((m) => {
    const raw = m[0].replace(/,/g, "");
    const dot = raw.indexOf(".");
    return { value: Number(raw), decimals: dot === -1 ? 0 : raw.length - dot - 1 };
  });
}

/** A claim supports evidence if it equals the evidence rounded to the claim's precision. */
function matches(claim: NumberToken, evidence: number): boolean {
  const tolerance = 0.5 * 10 ** -claim.decimals + 1e-9;
  return Math.abs(claim.value - evidence) <= tolerance;
}

function hasDose(sentence: string): boolean {
  return DOSE_PATTERNS.some((p) => p.test(normalizeDigits(sentence)));
}

function insertCitation(sentence: string, id: string): string {
  const m = /([.!?।])$/.exec(sentence);
  return m ? `${sentence.slice(0, -1)} [${id}]${m[1]}` : `${sentence} [${id}]`;
}

function devanagariRatio(text: string): number {
  const clean = text.replace(CITATION, "");
  const deva = (clean.match(/[ऀ-ॿ]/g) ?? []).length;
  const latin = (clean.match(/[A-Za-z]/g) ?? []).length;
  return deva + latin === 0 ? 1 : deva / (deva + latin);
}

const NOTICE: Record<LanguageId, { removed: string; empty: string }> = {
  en: {
    removed:
      "(Some figures were removed because they could not be verified against the data sources.)",
    empty:
      "I could not verify the details for this answer. Please contact your local Krishi Vigyan Kendra or the Kisan Call Centre (1800-180-1551).",
  },
  hi: {
    removed: "(कुछ आंकड़े हटा दिए गए क्योंकि उपलब्ध स्रोतों से उनकी पुष्टि नहीं हो सकी।)",
    empty:
      "इस उत्तर की जानकारी की पुष्टि नहीं हो सकी। कृपया अपने नज़दीकी कृषि विज्ञान केंद्र या किसान कॉल सेंटर (1800-180-1551) से संपर्क करें।",
  },
};

export function applyGrounding(
  answer: string,
  evidence: EvidenceItem[],
  knownCitationIds: string[],
  language: LanguageId,
): { text: string; report: GuardrailReport; citedIds: string[] } {
  const known = new Set(knownCitationIds);
  const indexed = evidence.map((e) => ({ ...e, numbers: numbersIn(e.text).map((n) => n.value) }));
  const report: GuardrailReport = {
    numericClaims: 0,
    supported: 0,
    autoCited: 0,
    removed: [],
    unknownCitationIds: [],
    languageMismatch: false,
  };

  const findSupport = (claim: NumberToken, kinds: EvidenceItem["kind"][]) =>
    indexed.find((e) => kinds.includes(e.kind) && e.numbers.some((n) => matches(claim, n)));

  const checkSentence = (input: string): string | null => {
    // Drop citation ids the model invented; keep valid ones.
    let sentence = input.replace(CITATION, (whole, ids: string) => {
      const valid = ids.split(/\s*,\s*/).filter((id) => {
        if (known.has(id)) return true;
        report.unknownCitationIds.push(id);
        return false;
      });
      return valid.length > 0 ? ` [${valid.join(", ")}]` : "";
    });
    const claims = numbersIn(sentence);
    if (claims.length === 0) return sentence;
    report.numericClaims++;

    const dose = hasDose(sentence);
    const kinds: EvidenceItem["kind"][] = dose ? ["document"] : ["tool", "document", "profile"];
    const support = claims.map((c) => findSupport(c, kinds));
    if (support.some((s) => s === undefined)) {
      report.removed.push({
        text: sentence.trim(),
        reason: dose ? "unsupported_dose" : "unsupported_number",
      });
      return null;
    }
    report.supported++;
    const cited = /\[S\d+/.test(sentence);
    const firstSourced = support.find((s) => s?.citationId);
    if (!cited && firstSourced?.citationId) {
      sentence = insertCitation(sentence, firstSourced.citationId);
      report.autoCited++;
    }
    return sentence;
  };

  const lines = answer.split("\n").map((line) => {
    if (line.trim() === "") return line;
    const marker = LIST_MARKER.exec(line)?.[1] ?? "";
    const body = line.slice(marker.length);
    const kept = body
      .split(SENTENCE_BREAK)
      .map((s) => (s.trim() ? checkSentence(s) : s))
      .filter((s): s is string => s !== null && s.trim() !== "");
    return kept.length > 0 ? marker + kept.join(" ") : null;
  });

  let text = lines
    .filter((l): l is string => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) text = NOTICE[language].empty;
  else if (report.removed.length > 0) text = `${text}\n\n${NOTICE[language].removed}`;

  report.languageMismatch = language === "hi" && devanagariRatio(text) < 0.5;
  const citedIds = [
    ...new Set([...text.matchAll(/S\d+/g)].map((m) => m[0]).filter((id) => known.has(id))),
  ];
  return { text, report, citedIds };
}
