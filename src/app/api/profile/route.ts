import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEnv } from "@/core/lib/env";
import { NotFoundError } from "@/core/lib/errors";
import { profileInputSchema } from "@/core/profile/types";
import { getFarmerContext, saveProfile } from "@/db/farmer-repo";
import { errorResponse, parseJsonBody } from "../_lib/http";

export const runtime = "nodejs";

/** GET /api/profile?id=… → FarmerContext */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return errorResponse(new NotFoundError("Profile", "No profile id given."));
  try {
    requireEnv("DATABASE_URL", "Profiles");
    const farmer = await getFarmerContext(id);
    if (!farmer)
      return errorResponse(
        new NotFoundError("Profile", "Profile not found. Please create it again."),
      );
    return NextResponse.json({ profile: farmer });
  } catch (error) {
    return errorResponse(error);
  }
}

const bodySchema = profileInputSchema.extend({ id: z.string().max(64).optional() });

/** POST /api/profile { id?, ...profile } → creates or replaces the profile. */
export async function POST(req: Request) {
  const body = await parseJsonBody(req, bodySchema);
  if (!body.ok) return body.response;
  try {
    requireEnv("DATABASE_URL", "Profiles");
    const { id, ...input } = body.data;
    const profile = await saveProfile(input, id);
    return NextResponse.json({ profile });
  } catch (error) {
    return errorResponse(error);
  }
}
