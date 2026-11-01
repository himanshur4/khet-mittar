import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ProviderError, ProviderTimeoutError } from "../errors";
import { createMemoryCacheStore, fetchJson, redactUrl, request } from "../http";

const noSleep = async () => {};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function scriptedFetch(responses: Array<Response | Error | "hang">) {
  let calls = 0;
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const next = responses[Math.min(calls, responses.length - 1)]!;
    calls++;
    if (next === "hang") {
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("timed out", "TimeoutError")),
        ),
      );
    }
    if (next instanceof Error) throw next;
    return next.clone();
  }) as typeof fetch;
  return { impl, calls: () => calls };
}

describe("request", () => {
  it("retries retryable statuses, then succeeds", async () => {
    const f = scriptedFetch([json({}, 503), json({}, 429), json({ ok: true })]);
    const res = await request({
      provider: "test",
      url: "https://x.test",
      retries: 2,
      fetchImpl: f.impl,
      sleep: noSleep,
    });
    expect(res.status).toBe(200);
    expect(f.calls()).toBe(3);
  });

  it("does not retry client errors", async () => {
    const f = scriptedFetch([json({ error: "bad key" }, 403), json({ ok: true })]);
    await expect(
      request({
        provider: "test",
        url: "https://x.test",
        retries: 2,
        fetchImpl: f.impl,
        sleep: noSleep,
      }),
    ).rejects.toMatchObject({ httpStatus: 403, retryable: false });
    expect(f.calls()).toBe(1);
  });

  it("times out a hanging provider", async () => {
    const f = scriptedFetch(["hang"]);
    await expect(
      request({
        provider: "slow",
        url: "https://x.test",
        timeoutMs: 50,
        fetchImpl: f.impl,
        sleep: noSleep,
      }),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it("redacts credentials in URLs", () => {
    expect(redactUrl("https://api.data.gov.in/resource/x?api-key=SECRET&limit=1")).toBe(
      "https://api.data.gov.in/resource/x?api-key=***&limit=1",
    );
  });
});

describe("fetchJson", () => {
  const schema = z.object({ value: z.number() });

  it("serves the last real response, labelled stale, when the provider is down", async () => {
    const store = createMemoryCacheStore();
    const cache = { key: "k", ttlSeconds: 60, store };
    const ok = scriptedFetch([json({ value: 42 })]);
    const first = await fetchJson({
      provider: "p",
      source: "P",
      url: "https://x.test",
      schema,
      cache,
      fetchImpl: ok.impl,
    });
    expect(first).toMatchObject({ data: { value: 42 }, freshness: "live" });

    // Expire the entry, then make the provider fail.
    const entry = (await store.get("k"))!;
    await store.set({ ...entry, expiresAt: new Date(Date.now() - 1) });
    const down = scriptedFetch([json({}, 503)]);
    const stale = await fetchJson({
      provider: "p",
      source: "P",
      url: "https://x.test",
      schema,
      cache,
      retries: 1,
      fetchImpl: down.impl,
      sleep: noSleep,
    });
    expect(stale.freshness).toBe("stale-cache");
    expect(stale.data.value).toBe(42);
    expect(stale.fetchedAt.getTime()).toBe(first.fetchedAt.getTime());
  });

  it("uses a fresh cache entry without calling the provider", async () => {
    const store = createMemoryCacheStore();
    const cache = { key: "k", ttlSeconds: 60, store };
    const f = scriptedFetch([json({ value: 1 })]);
    await fetchJson({
      provider: "p",
      source: "P",
      url: "https://x.test",
      schema,
      cache,
      fetchImpl: f.impl,
    });
    const second = await fetchJson({
      provider: "p",
      source: "P",
      url: "https://x.test",
      schema,
      cache,
      fetchImpl: f.impl,
    });
    expect(second.freshness).toBe("fresh-cache");
    expect(f.calls()).toBe(1);
  });

  it("rejects responses that don't match the schema, with no cache to fall back on", async () => {
    const f = scriptedFetch([json({ value: "not a number" })]);
    await expect(
      fetchJson({ provider: "p", source: "P", url: "https://x.test", schema, fetchImpl: f.impl }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
