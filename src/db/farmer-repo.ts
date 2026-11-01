import { isCropId } from "@config/crops";
import { isLanguageId } from "@config/languages";
import { soilHealthCardSchema, type FarmerContext, type ProfileInput } from "@/core/profile/types";
import { getDb, Prisma } from "./client";

type FarmerWithCrops = Prisma.FarmerGetPayload<{ include: { crops: true } }>;

function toContext(row: FarmerWithCrops): FarmerContext {
  const soil = soilHealthCardSchema.safeParse(row.soilCard);
  return {
    id: row.id,
    name: row.name,
    language: isLanguageId(row.language) ? row.language : "hi",
    locationName: row.locationName,
    latitude: row.latitude,
    longitude: row.longitude,
    state: row.state,
    district: row.district,
    crops: row.crops.flatMap((c) =>
      isCropId(c.crop)
        ? [
            {
              crop: c.crop,
              sowingDate: c.sowingDate.toISOString().slice(0, 10),
              areaAcres: c.areaAcres,
            },
          ]
        : [],
    ),
    soilCard: row.soilCard && soil.success ? soil.data : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getFarmerContext(id: string): Promise<FarmerContext | null> {
  const row = await getDb().farmer.findUnique({ where: { id }, include: { crops: true } });
  return row ? toContext(row) : null;
}

/** Creates the profile, or replaces it (crops included) when `id` exists. */
export async function saveProfile(input: ProfileInput, id?: string): Promise<FarmerContext> {
  const fields = {
    name: input.name ?? null,
    language: input.language,
    locationName: input.locationName,
    latitude: input.latitude,
    longitude: input.longitude,
    state: input.state ?? null,
    district: input.district ?? null,
    soilCard: input.soilCard ? (input.soilCard as Prisma.InputJsonValue) : Prisma.DbNull,
  };
  const crops = input.crops.map((c) => ({
    crop: c.crop,
    sowingDate: new Date(`${c.sowingDate}T00:00:00Z`),
    areaAcres: c.areaAcres ?? null,
  }));
  const db = getDb();
  const existing = id ? await db.farmer.findUnique({ where: { id }, select: { id: true } }) : null;
  const row = existing
    ? await db.farmer.update({
        where: { id: existing.id },
        data: { ...fields, crops: { deleteMany: {}, create: crops } },
        include: { crops: true },
      })
    : await db.farmer.create({
        data: { ...fields, crops: { create: crops } },
        include: { crops: true },
      });
  return toContext(row);
}

export async function listFarmersWithCrops(): Promise<FarmerContext[]> {
  const rows = await getDb().farmer.findMany({
    where: { crops: { some: {} } },
    include: { crops: true },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toContext);
}
