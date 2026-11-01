import { describeError } from "@/core/lib/errors";
import { logger } from "@/core/lib/logger";
import { defineTool, type SourceRef } from "../types";
import { usdaTextureClass, type SoilProvider } from "./client";
import { soilArgsSchema } from "./schema";

export function createSoilTool(soil: SoilProvider) {
  return defineTool({
    name: "getSoilData",
    description:
      "Soil properties at a location: modelled topsoil pH, organic carbon, nitrogen, texture (sand/silt/clay) and CEC from ISRIC SoilGrids, plus the farmer's own Soil Health Card values if saved in their profile (lab-tested, so prefer these). Use for fertiliser, liming or crop-suitability questions.",
    args: soilArgsSchema,
    timeoutMs: 20_000,
    async execute({ latitude, longitude }, ctx) {
      const sources: SourceRef[] = [];
      let soilGrids: Record<string, unknown>;
      try {
        const result = await soil.profile(latitude, longitude);
        const top = result.data["0-5cm"] ?? {};
        const sand = top.sand?.value;
        const silt = top.silt?.value;
        const clay = top.clay?.value;
        // SoilGrids reports texture fractions in % (g/kg ÷ 10); the triangle needs all three.
        const texture =
          sand !== undefined && silt !== undefined && clay !== undefined
            ? usdaTextureClass(sand, silt, clay)
            : null;
        soilGrids = {
          note: "Modelled estimate at 250 m resolution, not a field test",
          topsoilTextureClass: texture,
          byDepth: result.data,
        };
        sources.push({
          kind: "tool",
          title: result.source,
          detail: `Point ${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
          url: "https://soilgrids.org",
          fetchedAt: result.fetchedAt.toISOString(),
          freshness: result.freshness,
        });
      } catch (error) {
        logger.warn("SoilGrids unavailable", { err: error });
        soilGrids = { unavailable: `ISRIC SoilGrids did not respond (${describeError(error)})` };
      }

      const card = ctx.farmer?.soilCard ?? null;
      if (card && ctx.farmer) {
        sources.push({
          kind: "tool",
          title: "Farmer's Soil Health Card (entered in profile)",
          detail: card.testedOn ? `Tested on ${card.testedOn}` : "Test date not recorded",
          url: "https://soilhealth.dac.gov.in",
          fetchedAt: ctx.farmer.updatedAt,
        });
      }

      return {
        data: {
          soilHealthCard: card
            ? {
                ...card,
                units: "pH; EC dS/m; organic carbon %; N, P, K kg/ha; S, Zn, Fe, B ppm",
              }
            : null,
          soilGrids,
          ...(card || sources.length > 0
            ? {}
            : {
                suggestion:
                  "No soil data available. A free Soil Health Card test is available through the nearest soil testing laboratory or Krishi Vigyan Kendra (soilhealth.dac.gov.in).",
              }),
        },
        sources,
        summary: `SoilGrids ${"unavailable" in soilGrids ? "unavailable" : `ok (${String(soilGrids.topsoilTextureClass ?? "texture n/a")})`}; Soil Health Card ${card ? "present" : "not saved"}`,
      };
    },
  });
}
