import type { ModelMessage } from "ai";
import type { LanguageId } from "@config/languages";
import type { GuardrailReport } from "@/core/guardrails/grounding";
import type { Citation } from "@/core/tools/types";
import { getDb, Prisma } from "./client";

/** Returns an existing conversation id, or creates a new conversation. */
export async function ensureConversation(
  id: string | undefined,
  farmerId: string | null,
  language: LanguageId,
): Promise<string> {
  const db = getDb();
  if (id) {
    const existing = await db.conversation.findUnique({ where: { id }, select: { id: true } });
    if (existing) return existing.id;
  }
  const created = await db.conversation.create({
    data: { language, ...(farmerId ? { farmerId } : {}) },
    select: { id: true },
  });
  return created.id;
}

/**
 * Recent turns as plain text for the model's context. Citation markers are stripped: ids
 * restart at S1 every turn, so an old "[S1]" would point at the wrong source.
 */
export async function loadHistory(conversationId: string, limit = 8): Promise<ModelMessage[]> {
  const rows = await getDb().message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { role: true, content: true },
  });
  return rows.reverse().flatMap((r): ModelMessage[] => {
    const content = r.content.replace(/\s*\[S\d+(?:\s*,\s*S\d+)*\]/g, "");
    if (r.role === "user") return [{ role: "user", content }];
    if (r.role === "assistant") return [{ role: "assistant", content }];
    return [];
  });
}

export async function saveMessage(params: {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  turnId?: string;
  citations?: Citation[];
  guardrail?: GuardrailReport | null;
}): Promise<void> {
  await getDb().message.create({
    data: {
      conversationId: params.conversationId,
      role: params.role,
      content: params.content,
      turnId: params.turnId ?? null,
      citations: params.citations
        ? (params.citations as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
      guardrail: params.guardrail
        ? (params.guardrail as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
    },
  });
}
