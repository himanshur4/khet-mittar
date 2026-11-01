/** Turns a downloaded advisory (PDF or HTML) into per-page plain text. */
import { parse as parseHtmlDocument } from "node-html-parser";
import { extractText, getDocumentProxy } from "unpdf";
import { HEADING_MARK, type PageText } from "./chunk";

export async function parsePdf(bytes: Uint8Array): Promise<PageText[]> {
  // unpdf transfers (detaches) the buffer it is given, so hand it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return (text as string[]).map((t, i) => ({ page: i + 1, text: t }));
}

/** Block elements become line breaks; h1–h4 become marked heading lines for the chunker. */
export function parseHtml(html: string): PageText[] {
  const root = parseHtmlDocument(html);
  root
    .querySelectorAll("script, style, noscript, nav, header, footer, form, svg")
    .forEach((n) => n.remove());
  const main = root.querySelector("main, article, #content, .content") ?? root;
  const lines: string[] = [];
  for (const el of main.querySelectorAll("h1, h2, h3, h4, p, li, td, th, pre, blockquote")) {
    const text = el.textContent.replace(/\s+/g, " ").trim();
    if (!text) continue;
    lines.push(/^H[1-4]$/.test(el.tagName) ? `${HEADING_MARK}${text}` : text);
  }
  return [{ page: 1, text: lines.join("\n") }];
}

/** Keeps only the configured page ranges (1-based, inclusive). */
export function selectPages(pages: PageText[], from: number, to: number): PageText[] {
  return pages.filter((p) => p.page >= from && p.page <= to);
}
