/**
 * The one way KhetMitra talks to external HTTP APIs.
 *
 * Every call gets: a per-attempt timeout, bounded retries with exponential backoff (only for
 * retryable failures of idempotent requests), Zod validation of the response, and a cache of the
 * last real response. If the provider is down we serve that cached response labelled
 * "stale-cache" with its original fetch time, never invented values.
 */
import type { z } from "zod";
import { ProviderError, ProviderTimeoutError } from "./errors";
import { logger } from "./logger";

export type Freshness = "live" | "fresh-cache" | "stale-cache";

/** Data plus provenance, so the UI can always say where a number came from and when. */
export interface Sourced<T> {
  data: T;
  source: string;
  fetchedAt: Date;
  freshness: Freshness;
}

export interface CacheEntry {
  key: string;
  source: string;
  payload: unknown;
  fetchedAt: Date;
  expiresAt: Date;
}

export interface CacheStore {
  get(key: string): Promise<CacheEntry | null>;
  set(entry: CacheEntry): Promise<void>;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface RequestOptions {
  provider: string;
  url: string | URL;
  init?: RequestInit;
  timeoutMs?: number;
  /** Extra attempts after the first. Only use > 0 for idempotent requests. */
  retries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Hide credentials that some APIs (data.gov.in, Gemini) take as query parameters. */
export function redactUrl(url: string | URL): string {
  try {
    const u = new URL(String(url));
    for (const name of [...u.searchParams.keys()]) {
      if (/key|token|secret|signature/i.test(name)) u.searchParams.set(name, "***");
    }
    return u.toString();
  } catch {
    return "(unparseable url)";
  }
}

function backoffMs(attempt: number, retryAfter: string | null): number {
  const header = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(header) && header >= 0) return Math.min(header * 1000, 5_000);
  // 300 ms, 600 ms, 1.2 s… plus jitter so parallel retries don't stampede the provider.
  return Math.min(300 * 2 ** attempt, 3_000) + Math.floor(Math.random() * 150);
}

/**
 * fetch() with timeout + retries. Resolves only with an OK response; otherwise throws
 * `ProviderError` (`ProviderTimeoutError` for timeouts) carrying the provider name.
 */
export async function request(options: RequestOptions): Promise<Response> {
  const { provider, url, init = {}, timeoutMs = 8_000, retries = 0 } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const log = logger.child({ provider, url: redactUrl(url) });

  let lastError: ProviderError | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    let retryAfter: string | null = null;
    try {
      const res = await fetchImpl(url, { ...init, signal });
      if (res.ok) {
        log.debug("http ok", { status: res.status, ms: Date.now() - started, attempt });
        return res;
      }
      retryAfter = res.headers.get("retry-after");
      const body = (await res.text().catch(() => "")).slice(0, 300);
      lastError = new ProviderError(provider, `HTTP ${res.status}`, {
        httpStatus: res.status,
        retryable: RETRYABLE_STATUS.has(res.status),
        cause: body,
      });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      lastError =
        timeout.aborted || (error instanceof DOMException && error.name === "TimeoutError")
          ? new ProviderTimeoutError(provider, timeoutMs, error)
          : new ProviderError(provider, `network error: ${String(error)}`, {
              retryable: true,
              cause: error,
            });
    }
    log.warn("http attempt failed", {
      attempt,
      ms: Date.now() - started,
      status: lastError.httpStatus,
      retryable: lastError.retryable,
      err: lastError,
    });
    if (!lastError.retryable || attempt === retries) break;
    await sleep(backoffMs(attempt, retryAfter));
  }
  throw lastError ?? new ProviderError(provider, "request failed");
}

export interface FetchJsonOptions<T> extends RequestOptions {
  schema: z.ZodType<T>;
  /** Human-readable source label shown in citations, e.g. "Open-Meteo forecast". */
  source: string;
  cache?: { key: string; ttlSeconds: number; store: CacheStore };
}

async function readCache(store: CacheStore, key: string): Promise<CacheEntry | null> {
  try {
    return await store.get(key);
  } catch (error) {
    // The cache is an optimisation and a fallback; it must never take the request down.
    logger.warn("cache read failed", { key, err: error });
    return null;
  }
}

/**
 * GET-style JSON fetch with validation, caching and stale fallback. Returns `Sourced<T>`.
 *
 * @throws {ProviderError} when the provider fails and no cached copy exists.
 */
export async function fetchJson<T>(options: FetchJsonOptions<T>): Promise<Sourced<T>> {
  const { schema, source, cache, provider } = options;
  const cached = cache ? await readCache(cache.store, cache.key) : null;

  if (cached && cached.expiresAt.getTime() > Date.now()) {
    const parsed = schema.safeParse(cached.payload);
    if (parsed.success) {
      return {
        data: parsed.data,
        source: cached.source,
        fetchedAt: cached.fetchedAt,
        freshness: "fresh-cache",
      };
    }
  }

  try {
    const res = await request(options);
    let json: unknown;
    try {
      json = await res.json();
    } catch (error) {
      throw new ProviderError(provider, "response was not valid JSON", { cause: error });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderError(provider, "response did not match the expected shape", {
        cause: parsed.error.issues.slice(0, 5),
      });
    }
    const fetchedAt = new Date();
    if (cache) {
      await cache.store
        .set({
          key: cache.key,
          source,
          payload: json,
          fetchedAt,
          expiresAt: new Date(fetchedAt.getTime() + cache.ttlSeconds * 1000),
        })
        .catch((error: unknown) =>
          logger.warn("cache write failed", { key: cache.key, err: error }),
        );
    }
    return { data: parsed.data, source, fetchedAt, freshness: "live" };
  } catch (error) {
    if (cached) {
      const parsed = schema.safeParse(cached.payload);
      if (parsed.success) {
        logger.warn("serving stale cache after provider failure", {
          provider,
          key: cached.key,
          fetchedAt: cached.fetchedAt.toISOString(),
        });
        return {
          data: parsed.data,
          source: cached.source,
          fetchedAt: cached.fetchedAt,
          freshness: "stale-cache",
        };
      }
    }
    throw error;
  }
}

/** In-process LRU-ish cache: fast path for warm servers, and still works if the DB is down. */
export function createMemoryCacheStore(maxEntries = 500): CacheStore {
  const entries = new Map<string, CacheEntry>();
  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      entries.delete(key);
      entries.set(key, entry);
      return entry;
    },
    async set(entry) {
      entries.delete(entry.key);
      entries.set(entry.key, entry);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
  };
}

/** Reads the first layer that has the key; writes to all layers. */
export function layeredCacheStore(...layers: CacheStore[]): CacheStore {
  return {
    async get(key) {
      for (const [i, layer] of layers.entries()) {
        const entry = await layer.get(key).catch(() => null);
        if (entry) {
          // Warm faster layers so the next read skips the slower ones.
          await Promise.all(layers.slice(0, i).map((l) => l.set(entry).catch(() => undefined)));
          return entry;
        }
      }
      return null;
    },
    async set(entry) {
      const results = await Promise.allSettled(layers.map((l) => l.set(entry)));
      const failed = results.find((r) => r.status === "rejected");
      if (failed && results.every((r) => r.status === "rejected")) {
        throw (failed as PromiseRejectedResult).reason;
      }
    },
  };
}
