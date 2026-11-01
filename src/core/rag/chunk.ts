/**
 * Splits extracted document text into retrieval chunks. Pure functions, no I/O.
 *
 * Concept: an embedding summarises a whole chunk as one vector, so a chunk should hold one
 * idea (a few sentences about one topic). Chunks overlap slightly so a fact that straddles a
 * boundary still appears whole in at least one chunk.
 */

export interface PageText {
  page: number;
  text: string;
}

export interface TextChunk {
  content: string;
  section: string | null;
  pageFrom: number;
  pageTo: number;
  tokenEstimate: number;
}

export interface ChunkOptions {
  /** Upper bound per chunk; ~250–300 tokens of English, well inside embedding input limits. */
  maxChars: number;
  /** Text carried from the end of one chunk into the next. */
  overlapChars: number;
  /** Chunks smaller than this are merged forward instead of flushed at a heading. */
  minChars: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxChars: 1100,
  overlapChars: 180,
  minChars: 250,
};

interface Unit {
  text: string;
  page: number;
  section: string | null;
}

/** Rough token count (≈4 chars/token for English). Used for logging and budgeting only. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const isPageNumber = (line: string) => /^(page\s*)?\d{1,4}$/i.test(line);

/**
 * Marks a heading line produced by the HTML parser. A private-use code point, so it can never
 * collide with real document text (PDFs use "#" as a footnote marker, for example).
 */
export const HEADING_MARK = "";

const CONNECTORS = new Set(["and", "of", "for", "the", "in", "to", "with", "on", "at", "or", "a"]);

/** Sentence boundary, including the Devanagari danda (।). */
const SENTENCE_BREAK = /(?<=[.!?।])\s+(?=[A-Z0-9(•"'ऀ-ॿ])/;

export type HeadingLevel = "major" | "minor";

/**
 * Heading heuristic for PDF text. Major: short ALL-CAPS lines ("RABI ONION"). Minor: short
 * Title Case lines ("Improved Varieties"), accepted only right after a sentence ended, because a
 * wrapped mid-sentence line can also look like Title Case.
 */
export function headingOf(
  line: string,
  previousEndedSentence = true,
): { text: string; level: HeadingLevel } | null {
  if (line.startsWith(HEADING_MARK)) {
    const text = line.slice(HEADING_MARK.length).trim();
    return text ? { text, level: "major" } : null;
  }
  const letters = line.replace(/[^A-Za-z]/g, "");
  const digits = line.replace(/[^0-9]/g, "").length;
  const words = line.split(" ");
  if (line.length > 60 || words.length > 8 || letters.length < 4 || /[.,;:]$/.test(line)) {
    return null;
  }
  // Lists of variety codes ("HD 2824, PBW 443") are capitals but not headings.
  if (digits > letters.length * 0.15) return null;
  if (letters === letters.toUpperCase()) return { text: line, level: "major" };
  const titleCase =
    words.length <= 5 &&
    line.length <= 40 &&
    digits === 0 &&
    words.every((w) => CONNECTORS.has(w) || /^[A-Z(]/.test(w));
  return titleCase && previousEndedSentence ? { text: line, level: "minor" } : null;
}

/** Joins wrapped lines into paragraphs and tags each sentence with its page and section. */
export function toUnits(pages: PageText[], baseSection: string | null): Unit[] {
  const units: Unit[] = [];
  let major: string | null = null;
  let minor: string | null = null;
  const sectionLabel = () => {
    const parts = [baseSection, major, minor].filter((p): p is string => Boolean(p));
    // "Wheat › WHEAT" would say the same thing twice.
    const unique = parts.filter(
      (p, i) => parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i,
    );
    return unique.join(" › ") || null;
  };

  for (const { page, text } of pages) {
    let paragraph = "";
    const flush = () => {
      const clean = paragraph.replace(/\s+/g, " ").trim();
      paragraph = "";
      if (clean.length === 0) return;
      const section = sectionLabel();
      for (const sentence of clean.split(SENTENCE_BREAK)) {
        if (sentence.trim()) units.push({ text: sentence.trim(), page, section });
      }
    };

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/\s+/g, " ").trim();
      if (!line || isPageNumber(line)) continue;
      const heading = headingOf(line, paragraph === "" || /[.!?:)।]$/.test(paragraph));
      if (heading) {
        flush();
        if (heading.level === "major") {
          major = heading.text;
          minor = null;
        } else {
          minor = heading.text;
        }
        continue;
      }
      // Re-join words hyphenated across a line break ("irriga-" + "tion").
      if (/[a-z]-$/.test(paragraph) && /^[a-z]/.test(line)) {
        paragraph = paragraph.slice(0, -1) + line;
      } else {
        paragraph += (paragraph ? " " : "") + line;
      }
    }
    flush();
  }
  return units;
}

/** Splits an over-long unit (e.g. a flattened table) at word boundaries. */
function splitLong(unit: Unit, maxChars: number): Unit[] {
  if (unit.text.length <= maxChars) return [unit];
  const parts: Unit[] = [];
  let rest = unit.text;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(" ", maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;
    parts.push({ ...unit, text: rest.slice(0, cut).trim() });
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push({ ...unit, text: rest });
  return parts;
}

export function chunkPages(
  pages: PageText[],
  baseSection: string | null,
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): TextChunk[] {
  const units = toUnits(pages, baseSection).flatMap((u) => splitLong(u, options.maxChars));
  const chunks: TextChunk[] = [];
  let current: Unit[] = [];
  let length = 0;

  const emit = () => {
    if (current.length === 0) return;
    const content = current.map((u) => u.text).join(" ");
    chunks.push({
      content,
      section: current[0]!.section,
      pageFrom: current[0]!.page,
      pageTo: current[current.length - 1]!.page,
      tokenEstimate: estimateTokens(content),
    });
  };

  for (const unit of units) {
    const sectionChanged = current.length > 0 && unit.section !== current[0]!.section;
    const tooLong = length + unit.text.length + 1 > options.maxChars;
    if (current.length > 0 && (tooLong || (sectionChanged && length >= options.minChars))) {
      emit();
      // Overlap: carry trailing sentences into the next chunk, but never across sections.
      const carried: Unit[] = [];
      let carriedLength = 0;
      if (!sectionChanged) {
        for (let i = current.length - 1; i >= 0; i--) {
          const u = current[i]!;
          if (carriedLength + u.text.length > options.overlapChars) break;
          carried.unshift(u);
          carriedLength += u.text.length + 1;
        }
      }
      current = carried;
      length = carriedLength;
    }
    current.push(unit);
    length += unit.text.length + 1;
  }
  emit();
  return chunks;
}
