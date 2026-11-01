import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEnv } from "@/core/lib/env";
import { ValidationError } from "@/core/lib/errors";
import { listAlerts, markAlertsRead } from "@/db/alert-repo";
import { errorResponse, parseJsonBody } from "../_lib/http";

export const runtime = "nodejs";

/** GET /api/alerts?farmerId=… → newest alerts first. */
export async function GET(req: Request) {
  const farmerId = new URL(req.url).searchParams.get("farmerId");
  if (!farmerId)
    return errorResponse(new ValidationError("missing farmerId", ["farmerId: required"]));
  try {
    requireEnv("DATABASE_URL", "Alerts");
    return NextResponse.json({ alerts: await listAlerts(farmerId) });
  } catch (error) {
    return errorResponse(error);
  }
}

const readSchema = z.object({
  farmerId: z.string().min(1).max(64),
  ids: z.array(z.string().max(64)).min(1).max(100),
});

/** PATCH /api/alerts { farmerId, ids } → marks alerts as read. */
export async function PATCH(req: Request) {
  const body = await parseJsonBody(req, readSchema);
  if (!body.ok) return body.response;
  try {
    requireEnv("DATABASE_URL", "Alerts");
    return NextResponse.json({ updated: await markAlertsRead(body.data.farmerId, body.data.ids) });
  } catch (error) {
    return errorResponse(error);
  }
}
