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

const MARKER = /\[S\d+(?:\s*,\s*S\d+)*\]/g;

/**
 * POST /api/speech/translate { text, from, to } → { text, provider }
 * sarvam-translate keeps "[S1]" markers in place, so the text is sent as is. Any marker the
 * translation drops is appended at the end, so the answer's source chips stay linked.
 */
export async function POST(req: Request) {
  const body = await parseJsonBody(req, bodySchema);
  if (!body.ok) return body.response;
  try {
    const result = await getContainer().speech.translate(body.data.text, {
      from: body.data.from,
      to: body.data.to,
    });
    const kept = new Set(result.text.match(MARKER) ?? []);
    const lost = [...new Set(body.data.text.match(MARKER) ?? [])].filter((m) => !kept.has(m));
    const text = lost.length > 0 ? `${result.text} ${lost.join(" ")}` : result.text;
    return NextResponse.json({ text, provider: result.provider });
  } catch (error) {
    return speechFailure(error, "translation");
  }
}
