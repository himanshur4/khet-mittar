import { NextResponse } from "next/server";
import { isLanguageId } from "@config/languages";
import { getContainer } from "@/core/container";
import { ValidationError } from "@/core/lib/errors";
import { STT_KEYTERMS } from "@/core/speech/text";
import { errorResponse } from "../../_lib/http";
import { speechFailure } from "../_shared";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Sarvam's sync API takes ≤30 s of audio; 30 s of Opus is far below this cap. */
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

/** POST /api/speech/stt (multipart: audio=<file>, language=hi|en|auto) → { text, detectedLanguage, provider } */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return errorResponse(
      new ValidationError("expected multipart form data", [
        "body: multipart/form-data with an audio file",
      ]),
    );
  }
  const audio = form.get("audio");
  const language = String(form.get("language") ?? "auto");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return errorResponse(new ValidationError("missing audio", ["audio: required non-empty file"]));
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return errorResponse(
      new ValidationError(
        "audio too large",
        ["audio: max 4 MB"],
        "That recording is too long. Please keep it under 30 seconds.",
      ),
    );
  }
  if (language !== "auto" && !isLanguageId(language)) {
    return errorResponse(new ValidationError("bad language", ["language: hi | en | auto"]));
  }
  try {
    const transcript = await getContainer().speech.transcribe(audio, {
      language: language === "auto" ? "auto" : language,
      keyterms: STT_KEYTERMS,
    });
    return NextResponse.json(transcript);
  } catch (error) {
    return speechFailure(error, "speech-to-text");
  }
}
