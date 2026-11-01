import { NextResponse } from "next/server";
import { z } from "zod";
import { LANGUAGE_IDS } from "@config/languages";
import { getContainer } from "@/core/container";
import { TTS_MAX_CHARS } from "@/core/speech/sarvam";
import { toSpeakableText } from "@/core/speech/text";
import { parseJsonBody } from "../../_lib/http";
import { speechFailure } from "../_shared";

export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({
  text: z.string().trim().min(1).max(8000),
  language: z.enum(LANGUAGE_IDS),
});

/** POST /api/speech/tts { text, language } → { audioBase64, mimeType, provider } */
export async function POST(req: Request) {
  const body = await parseJsonBody(req, bodySchema);
  if (!body.ok) return body.response;
  const speakable = toSpeakableText(body.data.text).slice(0, TTS_MAX_CHARS);
  if (!speakable)
    return NextResponse.json(
      { error: { code: "EMPTY", message: "Nothing to read aloud." } },
      { status: 400 },
    );
  try {
    const speech = await getContainer().speech.synthesize(speakable, {
      language: body.data.language,
    });
    return NextResponse.json(speech);
  } catch (error) {
    return speechFailure(error, "text-to-speech");
  }
}
