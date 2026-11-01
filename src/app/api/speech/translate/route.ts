import { NextResponse } from "next/server";
import { z } from "zod";
import { LANGUAGE_IDS } from "@config/languages";
import { getContainer } from "@/core/container";
import { parseJsonBody } from "../../_lib/http";
import { speechFailure } from "../_shared";

export const runtime = "nodejs";

const bodySchema = z.object({
  text: z.string().trim().min(1).max(4000),
  from: z.enum([...LANGUAGE_IDS, "auto"]),
  to: z.enum(LANGUAGE_IDS),
});

/**
 * POST /api/speech/translate { text, from, to } → { text, provider }
 * Citation markers are protected so translated answers keep their source chips.
 */
export async function POST(req: Request) {
  const body = await parseJsonBody(req, bodySchema);
  if (!body.ok) return body.response;
  const markers: string[] = [];
  const protectedText = body.data.text.replace(/\[S\d+(?:\s*,\s*S\d+)*\]/g, (m) => {
    markers.push(m);
    return `⟦${markers.length - 1}⟧`;
  });
  try {
    const result = await getContainer().speech.translate(protectedText, {
      from: body.data.from,
      to: body.data.to,
    });
    const restored = result.text.replace(
      /⟦\s*(\d+)\s*⟧/g,
      (_, i: string) => markers[Number(i)] ?? "",
    );
    return NextResponse.json({ text: restored, provider: result.provider });
  } catch (error) {
    return speechFailure(error, "translation");
  }
}
