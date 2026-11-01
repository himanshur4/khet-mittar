import { NextResponse } from "next/server";
import { getContainer } from "@/core/container";
import { ValidationError } from "@/core/lib/errors";
import { errorResponse } from "../_lib/http";

export const runtime = "nodejs";

/** GET /api/geocode?q=Nashik&state=Maharashtra → place matches (for the profile form). */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = params.get("q")?.trim() ?? "";
  if (q.length < 2 || q.length > 100) {
    return errorResponse(
      new ValidationError(
        "bad query",
        ["q: 2–100 characters"],
        "Type at least 2 letters of the place name.",
      ),
    );
  }
  try {
    const result = await getContainer().geocoder.search(q, params.get("state") ?? undefined);
    return NextResponse.json({
      places: result.data.slice(0, 6),
      source: result.source,
      fetchedAt: result.fetchedAt.toISOString(),
      freshness: result.freshness,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
