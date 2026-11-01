import { z } from "zod";
import { CROP_IDS } from "@config/crops";
import type { AdvisoryRetriever } from "@/core/rag/retrieve";
import { defineTool, type SourceRef } from "../types";

export const searchAdvisoriesArgsSchema = z.object({
  query: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .describe(
      "Specific search in English: crop + problem/practice + stage, e.g. 'wheat first irrigation crown root initiation' or 'onion thrips management'",
    ),
  crop: z.enum(CROP_IDS).optional().describe("Restrict to documents about this crop"),
});

export function createSearchAdvisoriesTool(retriever: AdvisoryRetriever) {
  return defineTool({
    name: "searchAdvisories",
    description:
      "Search official agricultural advisories (ICAR, state agricultural university Packages of Practices, NIPHM IPM packages, IMD agromet bulletins) and return the most relevant passages. Use for any agronomic advice: varieties, sowing, fertiliser, irrigation, pests/diseases, chemical names and doses, harvest. Doses may only be quoted from these passages.",
    args: searchAdvisoriesArgsSchema,
    timeoutMs: 15_000,
    async execute({ query, crop }, ctx) {
      const crops = crop ? [crop] : (ctx.farmer?.crops.map((c) => c.crop) ?? undefined);
      const passages = await retriever.search(query, { crops, limit: 5 });
      if (passages.length === 0) {
        const indexed = await retriever.indexedChunks().catch(() => 0);
        return {
          data: {
            passages: [],
            note:
              indexed === 0
                ? "The advisory library has not been ingested yet, so no official guidance is available."
                : "No passage matched. Try a more specific query (crop + practice), or say the official advisory does not cover this.",
          },
          sources: [],
          summary: indexed === 0 ? "advisory index empty" : `no passages for "${query}"`,
        };
      }
      const sources: SourceRef[] = passages.map((p) => ({
        kind: "document",
        title: p.title,
        detail: [
          p.section,
          p.pageFrom
            ? `p. ${p.pageFrom}${p.pageTo && p.pageTo !== p.pageFrom ? `–${p.pageTo}` : ""}`
            : null,
          p.region !== "India" ? `${p.region} recommendations` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        url: p.url,
        fetchedAt: p.fetchedAt.toISOString(),
      }));
      return {
        data: {
          passages: passages.map((p, i) => ({
            // Replaced by the orchestrator with this passage's citation id (e.g. "S4").
            sourceIndex: i,
            document: p.title,
            publisher: p.publisher,
            region: p.region,
            section: p.section,
            similarity: Math.round(p.similarity * 100) / 100,
            excerpt: p.content,
          })),
        },
        sources,
        summary: `${passages.length} passages; top: ${passages[0]!.title}${passages[0]!.section ? ` › ${passages[0]!.section}` : ""} (${passages[0]!.similarity.toFixed(2)})`,
      };
    },
  });
}
