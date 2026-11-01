import { NextResponse } from "next/server";
import type { z } from "zod";
import { AppError, toAppError, ValidationError } from "@/core/lib/errors";
import { logger } from "@/core/lib/logger";
import { formatZodIssues } from "@/core/tools/types";

/** Friendly JSON error for the client; full detail goes to the log. */
export function errorResponse(error: unknown): NextResponse {
  const appError = toAppError(error);
  if (appError.status >= 500) logger.error("request failed", { err: error, code: appError.code });
  return NextResponse.json(
    {
      error: {
        code: appError.code,
        message: appError.userMessage,
        ...(appError instanceof ValidationError ? { issues: appError.issues } : {}),
      },
    },
    { status: appError.status },
  );
}

export async function parseJsonBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: errorResponse(new ValidationError("body is not JSON", ["body: expected JSON"])),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: errorResponse(
        new ValidationError("invalid request body", formatZodIssues(parsed.error)),
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

export { AppError };
