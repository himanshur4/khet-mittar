import { describe, expect, it } from "vitest";
import { chunkPages, headingOf, HEADING_MARK, toUnits } from "../chunk";

const sentence = (n: number) =>
  `Sentence number ${n} explains one practice in detail for the crop.`;

describe("headingOf", () => {
  it("detects ALL-CAPS major headings and Title Case minor headings", () => {
    expect(headingOf("RABI ONION")).toEqual({ text: "RABI ONION", level: "major" });
    expect(headingOf("Improved Varieties")).toEqual({ text: "Improved Varieties", level: "minor" });
    expect(headingOf(`${HEADING_MARK}Irrigation`)).toEqual({ text: "Irrigation", level: "major" });
  });

  it("ignores variety-code lists, sentences and mid-sentence Title Case lines", () => {
    expect(headingOf("HD 2824, HD 2733, PBW 443")).toBeNull();
    expect(headingOf("Apply urea after the first irrigation.")).toBeNull();
    expect(headingOf("Improved Varieties", false)).toBeNull();
    expect(headingOf("# Apply 12 kg K2O per acre")).toBeNull();
  });
});

describe("toUnits", () => {
  it("re-joins hyphenated words, drops page numbers and tracks sections", () => {
    const units = toUnits(
      [
        {
          page: 3,
          text: "WHEAT\n12\nGive the first irri-\ngation at crown root initiation.\nWeed Control\nUse clean seed.",
        },
      ],
      "Wheat chapter",
    );
    expect(units.map((u) => u.text)).toEqual([
      "Give the first irrigation at crown root initiation.",
      "Use clean seed.",
    ]);
    expect(units[0]!.section).toBe("Wheat chapter › WHEAT");
    expect(units[1]!.section).toBe("Wheat chapter › WHEAT › Weed Control");
  });
});

describe("chunkPages", () => {
  const text = Array.from({ length: 40 }, (_, i) => sentence(i)).join(" ");

  it("respects the size limit and overlaps consecutive chunks", () => {
    const chunks = chunkPages([{ page: 1, text }], null, {
      maxChars: 400,
      overlapChars: 120,
      minChars: 100,
    });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(400);
    for (let i = 1; i < chunks.length; i++) {
      const firstSentence = chunks[i]!.content.split(". ")[0]!;
      expect(chunks[i - 1]!.content).toContain(firstSentence);
    }
  });

  it("never carries overlap across a section change and records pages", () => {
    const pages = [
      { page: 5, text: `ONION\n${sentence(1)} ${sentence(2)} ${sentence(3)} ${sentence(4)}` },
      { page: 6, text: `TOMATO\n${sentence(5)} ${sentence(6)}` },
    ];
    const chunks = chunkPages(pages, null, { maxChars: 1000, overlapChars: 200, minChars: 100 });
    expect(chunks.map((c) => c.section)).toEqual(["ONION", "TOMATO"]);
    expect(chunks[1]!.content.startsWith("Sentence number 5")).toBe(true);
    expect(chunks[1]).toMatchObject({ pageFrom: 6, pageTo: 6 });
  });

  it("splits a single over-long unit at word boundaries", () => {
    const table = Array.from({ length: 300 }, (_, i) => `cell${i}`).join(" ");
    const chunks = chunkPages([{ page: 1, text: table }], null, {
      maxChars: 500,
      overlapChars: 0,
      minChars: 100,
    });
    expect(chunks.every((c) => c.content.length <= 500)).toBe(true);
    expect(chunks.map((c) => c.content).join(" ")).toBe(table);
  });
});
