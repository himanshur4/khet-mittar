import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { runAlertChecksFor } from "@/core/alerts/service";
import { getEnv, requireEnv } from "@/core/lib/env";
import { AppError, MissingConfigError, NotFoundError } from "@/core/lib/errors";
import { getFarmerContext, listFarmersWithCrops } from "@/db/farmer-repo";
import { errorResponse, parseJsonBody } from "../../_lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

function bearerMatches(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  // Constant-time compare so the secret can't be guessed byte by byte from response timing.
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** GET /api/alerts/run: Vercel Cron (Authorization: Bearer $CRON_SECRET). Checks every farmer. */
export async function GET(req: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return errorResponse(new MissingConfigError("Scheduled alerts", ["CRON_SECRET"]));
  if (!bearerMatches(req.headers.get("authorization"), secret)) {
    return errorResponse(
      new AppError("bad cron secret", {
        code: "UNAUTHORIZED",
        status: 401,
        userMessage: "Unauthorized.",
      }),
    );
  }
  try {
    requireEnv("DATABASE_URL", "Alerts");
    const summary = await runAlertChecksFor(await listFarmersWithCrops());
    return NextResponse.json({ summary });
  } catch (error) {
    return errorResponse(error);
  }
}

const lastManualRun = new Map<string, number>();
/** The button is per-farmer and cheap, but repeated clicks shouldn't trigger repeated LLM calls. */
const MANUAL_COOLDOWN_MS = 15_000;

const bodySchema = z.object({ farmerId: z.string().min(1).max(64) });

/** POST /api/alerts/run { farmerId }: the "Run alert check now" button, scoped to one farmer. */
export async function POST(req: Request) {
  const body = await parseJsonBody(req, bodySchema);
  if (!body.ok) return body.response;
  const { farmerId } = body.data;
  const last = lastManualRun.get(farmerId) ?? 0;
  if (Date.now() - last < MANUAL_COOLDOWN_MS) {
    return errorResponse(
      new AppError("cooldown", {
        code: "RATE_LIMITED",
        status: 429,
        userMessage: "An alert check just ran. Please wait a few seconds.",
      }),
    );
  }
  lastManualRun.set(farmerId, Date.now());
  try {
    requireEnv("DATABASE_URL", "Alerts");
    const farmer = await getFarmerContext(farmerId);
    if (!farmer) return errorResponse(new NotFoundError("Profile", "Save your profile first."));
    const summary = await runAlertChecksFor([farmer]);
    return NextResponse.json({ summary });
  } catch (error) {
    return errorResponse(error);
  }
}
