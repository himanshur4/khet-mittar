/**
 * One chat turn end to end: input check → load profile + history → agent loop → persist.
 * Degrades instead of failing: without a database the agent still answers (no history/trace
 * persistence); without an LLM key the farmer gets a clear "not configured" message.
 */
import { randomUUID } from "node:crypto";
import type { ModelMessage } from "ai";
import type { LanguageId } from "@config/languages";
import { getContainer } from "@/core/container";
import { checkInput } from "@/core/guardrails/input";
import { getEnv } from "@/core/lib/env";
import { AppError, describeError } from "@/core/lib/errors";
import { logger } from "@/core/lib/logger";
import type { FarmerContext } from "@/core/profile/types";
import { ensureConversation, loadHistory, saveMessage } from "@/db/conversation-repo";
import { getFarmerContext } from "@/db/farmer-repo";
import { createDbTraceSink } from "@/db/trace-repo";
import { AGENT_MESSAGES } from "./messages";
import { createAiSdkClient } from "./llm";
import { runAgentTurn } from "./orchestrator";
import { PROMPT_VERSION } from "./prompts/system";
import { resolveChatModels } from "./providers";
import type { AgentEvent } from "./types";

export interface ChatRequest {
  message: string;
  language: LanguageId;
  conversationId?: string;
  farmerId?: string;
}

const EMPTY_REPORT = {
  numericClaims: 0,
  supported: 0,
  autoCited: 0,
  removed: [],
  unknownCitationIds: [],
  languageMismatch: false,
};

export async function handleChatTurn(
  req: ChatRequest,
  emit: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const input = checkInput(req.message, req.language);
  if (!input.ok) {
    emit({
      type: "final",
      turnId: randomUUID(),
      answer: input.reply,
      citations: [],
      guardrail: EMPTY_REPORT,
      language: req.language,
    });
    return;
  }

  let models: ReturnType<typeof resolveChatModels>;
  try {
    models = resolveChatModels();
  } catch (error) {
    emit({
      type: "error",
      code: error instanceof AppError ? error.code : "LLM_UNAVAILABLE",
      message: `${AGENT_MESSAGES.llmUnavailable[req.language]} (${error instanceof AppError ? error.userMessage : describeError(error)})`,
    });
    return;
  }

  let farmer: FarmerContext | null = null;
  let conversationId: string | null = null;
  let history: ModelMessage[] = [];
  if (getEnv().DATABASE_URL) {
    try {
      farmer = req.farmerId ? await getFarmerContext(req.farmerId) : null;
      conversationId = await ensureConversation(
        req.conversationId,
        farmer?.id ?? null,
        req.language,
      );
      history = await loadHistory(conversationId);
      await saveMessage({ conversationId, role: "user", content: input.text });
    } catch (error) {
      logger.warn("database unavailable; answering without history or persistence", { err: error });
      conversationId = null;
    }
  }

  const turnId = randomUUID();
  const result = await runAgentTurn({
    question: input.text,
    history,
    farmer,
    language: req.language,
    tools: getContainer().tools,
    models: {
      primary: createAiSdkClient(models.primary),
      fallback: models.fallback ? createAiSdkClient(models.fallback) : null,
    },
    emit,
    trace: conversationId
      ? createDbTraceSink({ turnId, conversationId, promptVersion: PROMPT_VERSION })
      : undefined,
    conversationId,
    signal,
    turnId,
  });

  if (conversationId && result.ok) {
    await saveMessage({
      conversationId,
      role: "assistant",
      content: result.answer,
      turnId,
      citations: result.citations,
      guardrail: result.guardrail,
    }).catch((err: unknown) => logger.warn("failed to save assistant message", { err }));
  }
}
