import type { TraceSink, TraceStep } from "@/core/agent/types";
import { logger } from "@/core/lib/logger";
import { getDb, Prisma } from "./client";

/**
 * Writes agent steps as they happen (without blocking the stream). `flush` awaits them so the
 * trace is complete before the request ends.
 */
export function createDbTraceSink(params: {
  turnId: string;
  conversationId: string | null;
  promptVersion: string;
}): TraceSink {
  const pending: Array<Promise<unknown>> = [];
  return {
    record(step: TraceStep) {
      pending.push(
        getDb()
          .agentStep.create({
            data: {
              turnId: params.turnId,
              conversationId: params.conversationId,
              stepIndex: step.index,
              kind: step.kind,
              name: step.name,
              args:
                step.args === undefined
                  ? Prisma.DbNull
                  : (JSON.parse(JSON.stringify(step.args)) as Prisma.InputJsonValue),
              resultSummary: step.summary ?? null,
              latencyMs: Math.round(step.latencyMs),
              attempt: step.attempt ?? 1,
              error: step.error ?? null,
              promptVersion: params.promptVersion,
            },
          })
          .catch((err: unknown) => logger.warn("failed to persist agent step", { err })),
      );
    },
    async flush() {
      await Promise.all(pending);
    },
  };
}

export async function getTurnSteps(turnId: string) {
  return getDb().agentStep.findMany({ where: { turnId }, orderBy: { stepIndex: "asc" } });
}
