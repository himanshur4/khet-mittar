import { NextResponse } from "next/server";
import { MissingConfigError, toAppError } from "@/core/lib/errors";
import { logger } from "@/core/lib/logger";

/**
 * Speech failures never break the conversation: the client gets `fallback: "browser"` and
 * switches to the Web Speech API (or plain text) instead.
 */
export function speechFailure(error: unknown, what: string): NextResponse {
  const appError = toAppError(error);
  if (!(error instanceof MissingConfigError)) logger.warn(`${what} failed`, { err: error });
  return NextResponse.json(
    { error: { code: appError.code, message: appError.userMessage }, fallback: "browser" },
    { status: error instanceof MissingConfigError ? 503 : 502 },
  );
}
