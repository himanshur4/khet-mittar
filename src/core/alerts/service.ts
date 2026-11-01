/** Wires the alert engine to real providers, the database and (if configured) the LLM. */
import { createAiSdkClient } from "@/core/agent/llm";
import { PROMPT_VERSION } from "@/core/agent/prompts/system";
import { resolveChatModels } from "@/core/agent/providers";
import { getContainer } from "@/core/container";
import { logger } from "@/core/lib/logger";
import type { FarmerContext } from "@/core/profile/types";
import { dbAlertStore } from "@/db/alert-repo";
import { createDbTraceSink } from "@/db/trace-repo";
import {
  createAgentAlertWriter,
  runAlertCheck,
  type AlertRunSummary,
  type AlertWriter,
} from "./engine";

function agentWriter(): AlertWriter | null {
  try {
    const models = resolveChatModels();
    return createAgentAlertWriter({
      tools: getContainer().tools,
      models: {
        primary: createAiSdkClient(models.primary),
        fallback: models.fallback ? createAiSdkClient(models.fallback) : null,
      },
      traceFor: (turnId) =>
        createDbTraceSink({ turnId, conversationId: null, promptVersion: PROMPT_VERSION }),
    });
  } catch (error) {
    // No LLM key: alerts still fire, with template text built from the real forecast.
    logger.warn("alert writer unavailable; using templates", { err: error });
    return null;
  }
}

export function runAlertChecksFor(farmers: FarmerContext[]): Promise<AlertRunSummary> {
  return runAlertCheck({
    farmers,
    weather: getContainer().weather,
    store: dbAlertStore,
    writer: agentWriter(),
  });
}
