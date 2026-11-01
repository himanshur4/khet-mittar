import { logger } from "@/core/lib/logger";

export interface SseEvent {
  type: string;
}

/**
 * Server-Sent Events response. `run` pushes events; the stream closes when it settles.
 * If the browser disconnects, the signal passed to `run` aborts so the agent stops working.
 */
export function eventStream<E extends SseEvent>(
  run: (send: (event: E) => void, signal: AbortSignal) => Promise<void>,
  requestSignal: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  requestSignal.addEventListener("abort", () => abort.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const send = (event: E) => write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      // Comment lines keep proxies from closing an idle connection during slow tool calls.
      const heartbeat = setInterval(() => write(": keep-alive\n\n"), 15_000);
      try {
        await run(send, abort.signal);
      } catch (error) {
        logger.error("stream handler crashed", { err: error });
        write(
          `event: error\ndata: ${JSON.stringify({ type: "error", code: "INTERNAL", message: "Something went wrong. Please try again." })}\n\n`,
        );
      } finally {
        clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed by a disconnect
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
