/**
 * Sliding-window rate limiter kept in memory. Per server instance only (serverless instances
 * don't share it), which is enough to stop one client from draining the LLM quota.
 */
const hits = new Map<string, number[]>();

export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "local";
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return { ok: false, retryAfterSeconds: Math.ceil((windowMs - (now - recent[0]!)) / 1000) };
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) {
    // Bound memory: drop the oldest keys.
    for (const k of [...hits.keys()].slice(0, 1_000)) hits.delete(k);
  }
  return { ok: true };
}
