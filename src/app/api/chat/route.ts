import { z } from "zod";
import { LANGUAGE_IDS } from "@config/languages";
import { handleChatTurn } from "@/core/agent/chat-service";
import type { AgentEvent } from "@/core/agent/types";
import { AppError } from "@/core/lib/errors";
import { errorResponse, parseJsonBody } from "../_lib/http";
import { clientKey, rateLimit } from "../_lib/rate-limit";
import { eventStream } from "../_lib/sse";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  // Generous cap here; the input guardrail gives the farmer a friendly limit message.
  message: z.string().max(4000),
  language: z.enum(LANGUAGE_IDS).default("hi"),
  conversationId: z.string().max(64).optional(),
  farmerId: z.string().max(64).optional(),
});

/** POST /api/chat → text/event-stream of AgentEvent (turn_start, step, text_delta, final, error). */
export async function POST(req: Request) {
  // ~1 question every 5 s per client: plenty for a farmer, but caps runaway LLM spend.
  const limit = rateLimit(`chat:${clientKey(req)}`, 12, 60_000);
  if (!limit.ok) {
    return errorResponse(
      new AppError("rate limited", {
        code: "RATE_LIMITED",
        status: 429,
        userMessage: `Too many questions at once. Please wait ${limit.retryAfterSeconds} seconds.`,
      }),
    );
  }
  const body = await parseJsonBody(req, bodySchema);
  if (!body.ok) return body.response;
  return eventStream<AgentEvent>(
    (send, signal) => handleChatTurn(body.data, send, signal),
    req.signal,
  );
}
