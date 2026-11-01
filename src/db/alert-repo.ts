import type { AlertStore, NewAlert } from "@/core/alerts/engine";
import { getDb, Prisma } from "./client";

export const dbAlertStore: AlertStore = {
  async exists(dedupeKey) {
    const row = await getDb().alert.findUnique({ where: { dedupeKey }, select: { id: true } });
    return row !== null;
  },
  async create(alert: NewAlert) {
    await getDb().alert.create({
      data: {
        farmerId: alert.farmerId,
        crop: alert.crop,
        kind: alert.kind,
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        eventDate: new Date(`${alert.eventDate}T00:00:00Z`),
        evidence: alert.evidence as Prisma.InputJsonValue,
        citations: alert.citations as unknown as Prisma.InputJsonValue,
        turnId: alert.turnId,
        dedupeKey: alert.dedupeKey,
      },
    });
  },
};

export async function listAlerts(farmerId: string, limit = 50) {
  const rows = await getDb().alert.findMany({
    where: { farmerId },
    orderBy: [{ createdAt: "desc" }],
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    crop: r.crop,
    kind: r.kind,
    severity: r.severity,
    title: r.title,
    message: r.message,
    eventDate: r.eventDate.toISOString().slice(0, 10),
    evidence: r.evidence,
    citations: r.citations,
    turnId: r.turnId,
    read: r.readAt !== null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function markAlertsRead(farmerId: string, ids: string[]): Promise<number> {
  const result = await getDb().alert.updateMany({
    where: { farmerId, id: { in: ids }, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}
