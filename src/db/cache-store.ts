import { createMemoryCacheStore, layeredCacheStore, type CacheStore } from "@/core/lib/http";
import { logger } from "@/core/lib/logger";
import { getDb, Prisma } from "./client";

/**
 * Circuit breaker: after a database error, skip the DB layer for a short while. Otherwise every
 * cache read during an outage would wait for the 5 s connection timeout before the real API call.
 */
const OPEN_FOR_MS = 30_000;
let openUntil = 0;

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  if (Date.now() < openUntil) throw new Error("database cache temporarily bypassed");
  try {
    return await fn();
  } catch (error) {
    openUntil = Date.now() + OPEN_FOR_MS;
    logger.warn("database cache unavailable; bypassing it for 30 s", { err: error });
    throw error;
  }
}

/** Postgres-backed cache (`api_cache`): survives restarts and serverless cold starts. */
export const dbCacheStore: CacheStore = {
  get(key) {
    return guarded(async () => {
      const row = await getDb().apiCache.findUnique({ where: { key } });
      return row
        ? {
            key: row.key,
            source: row.source,
            payload: row.payload,
            fetchedAt: row.fetchedAt,
            expiresAt: row.expiresAt,
          }
        : null;
    });
  },
  set(entry) {
    return guarded(async () => {
      const data = {
        source: entry.source,
        payload: entry.payload as Prisma.InputJsonValue,
        fetchedAt: entry.fetchedAt,
        expiresAt: entry.expiresAt,
      };
      await getDb().apiCache.upsert({
        where: { key: entry.key },
        create: { key: entry.key, ...data },
        update: data,
      });
    });
  },
};

const globalForCache = globalThis as unknown as { khetmitraCache?: CacheStore };

/** Memory first (fast, works when the DB is down), then Postgres (shared, durable). */
export function getCacheStore(): CacheStore {
  globalForCache.khetmitraCache ??= layeredCacheStore(createMemoryCacheStore(), dbCacheStore);
  return globalForCache.khetmitraCache;
}
