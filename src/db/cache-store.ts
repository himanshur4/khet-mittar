import { createMemoryCacheStore, layeredCacheStore, type CacheStore } from "@/core/lib/http";
import { getDb, Prisma } from "./client";

/** Postgres-backed cache (`api_cache`): survives restarts and serverless cold starts. */
export const dbCacheStore: CacheStore = {
  async get(key) {
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
  },
  async set(entry) {
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
  },
};

const globalForCache = globalThis as unknown as { khetmitraCache?: CacheStore };

/** Memory first (fast, works when the DB is down), then Postgres (shared, durable). */
export function getCacheStore(): CacheStore {
  globalForCache.khetmitraCache ??= layeredCacheStore(createMemoryCacheStore(), dbCacheStore);
  return globalForCache.khetmitraCache;
}
