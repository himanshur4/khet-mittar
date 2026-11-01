import { describe, expect, it } from "vitest";
import { checkInput, MAX_QUESTION_CHARS } from "../input";

describe("checkInput", () => {
  it("accepts questions in Hindi and English", () => {
    expect(checkInput("  गेहूं में सिंचाई कब करें? ", "hi")).toEqual({
      ok: true,
      text: "गेहूं में सिंचाई कब करें?",
    });
    expect(checkInput("When to irrigate wheat?", "en").ok).toBe(true);
  });

  it("rejects empty, symbol-only and over-long input with a reply in the farmer's language", () => {
    const empty = checkInput("   ", "hi");
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reply).toContain("कृपया");
    expect(checkInput("??? 123 !!", "en")).toMatchObject({ ok: false, reason: "no_words" });
    expect(checkInput("a".repeat(MAX_QUESTION_CHARS + 1), "en")).toMatchObject({
      ok: false,
      reason: "too_long",
    });
  });

  it("strips control characters", () => {
    expect(checkInput("rain\u0000 today\u0007", "en")).toEqual({ ok: true, text: "rain today" });
  });
});
