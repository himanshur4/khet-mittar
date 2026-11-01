import { describe, expect, it } from "vitest";
import { applyGrounding, numbersIn, type EvidenceItem } from "../grounding";

const weather: EvidenceItem = {
  citationId: "S1",
  kind: "tool",
  text: JSON.stringify({ daily: [{ date: "2026-11-02", rainMm: 48.2, tMaxC: 30.7 }] }),
};
const ipm: EvidenceItem = {
  citationId: "S2",
  kind: "document",
  text: "Spray fipronil 5 SC @ 1.5 ml per litre of water against thrips.",
};
const profile: EvidenceItem = {
  citationId: null,
  kind: "profile",
  text: "Onion sown on 2026-10-15: 17 days after sowing",
};
const evidence = [weather, ipm, profile];
const ids = ["S1", "S2"];

describe("applyGrounding", () => {
  it("keeps sentences whose numbers are in the evidence", () => {
    const { text, report } = applyGrounding(
      "Rain of 48.2 mm is forecast on 2 Nov [S1].",
      evidence,
      ids,
      "en",
    );
    expect(text).toBe("Rain of 48.2 mm is forecast on 2 Nov [S1].");
    expect(report.supported).toBe(1);
    expect(report.removed).toHaveLength(0);
  });

  it("accepts numbers rounded to the precision the model wrote", () => {
    const { report } = applyGrounding("It will be about 31 °C [S1].", evidence, ids, "en");
    expect(report.removed).toHaveLength(0);
    expect(
      applyGrounding("It will be 30.2 °C [S1].", evidence, ids, "en").report.removed,
    ).toHaveLength(1);
  });

  it("removes sentences with numbers that no source contains", () => {
    const { text, report } = applyGrounding(
      "Rain of 48.2 mm is expected [S1]. Onion prices will reach 4000 next week.",
      evidence,
      ids,
      "en",
    );
    expect(text).toContain("48.2 mm");
    expect(text).not.toContain("4000");
    expect(text).toContain("could not be verified");
    expect(report.removed[0]!.reason).toBe("unsupported_number");
  });

  it("adds the missing citation for a verified number", () => {
    const { text, report } = applyGrounding("Expect 48.2 mm of rain.", evidence, ids, "en");
    expect(text).toBe("Expect 48.2 mm of rain [S1].");
    expect(report.autoCited).toBe(1);
  });

  it("requires doses to come from an official document", () => {
    const fromDoc = applyGrounding("Spray fipronil @ 1.5 ml per litre [S2].", evidence, ids, "en");
    expect(fromDoc.report.removed).toHaveLength(0);
    // 30.7 is a real number, but from the weather tool, not an advisory: not a valid dose source.
    const invented = applyGrounding("Spray 30.7 ml per litre of water.", evidence, ids, "en");
    expect(invented.report.removed[0]!.reason).toBe("unsupported_dose");
  });

  it("treats profile facts as evidence without forcing a citation", () => {
    const { text, report } = applyGrounding("Your onion is 17 days old.", evidence, ids, "en");
    expect(text).toBe("Your onion is 17 days old.");
    expect(report.autoCited).toBe(0);
  });

  it("drops citation ids that do not exist", () => {
    const { text, report } = applyGrounding(
      "Drain the field before the rain [S9].",
      evidence,
      ids,
      "en",
    );
    expect(text).toBe("Drain the field before the rain.");
    expect(report.unknownCitationIds).toEqual(["S9"]);
  });

  it("reads Devanagari digits", () => {
    expect(numbersIn("४८.२ मिमी")).toEqual([{ value: 48.2, decimals: 1 }]);
    const { report } = applyGrounding("कल ४८.२ मिमी बारिश होगी [S1]।", evidence, ids, "hi");
    expect(report.removed).toHaveLength(0);
    expect(report.languageMismatch).toBe(false);
  });

  it("keeps list structure and flags English replies to Hindi users", () => {
    const { text, report } = applyGrounding(
      "- Drain fields.\n- Rain 48.2 mm [S1].",
      evidence,
      ids,
      "hi",
    );
    expect(text.split("\n")).toEqual(["- Drain fields.", "- Rain 48.2 mm [S1]."]);
    expect(report.languageMismatch).toBe(true);
  });

  it("falls back to a safe message when nothing can be verified", () => {
    const { text } = applyGrounding("Yield will be 25 quintals.", evidence, ids, "en");
    expect(text).toContain("Kisan Call Centre");
  });
});
