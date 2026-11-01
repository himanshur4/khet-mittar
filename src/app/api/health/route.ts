import { NextResponse } from "next/server";
import { getHealthReport } from "@/core/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/health[?fresh=1] → database + provider status. 503 when a critical dependency is down. */
export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const report = await getHealthReport(fresh);
  return NextResponse.json(report, {
    status: report.status === "down" ? 503 : 200,
    headers: { "cache-control": "no-store" },
  });
}
