import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { requireEnv } from "@/core/lib/env";

export { Prisma } from "@/generated/prisma/client";

const globalForDb = globalThis as unknown as { khetmitraDb?: PrismaClient };

/**
 * One Prisma client per process, created on first use (so a missing DATABASE_URL surfaces as
 * a clear `MissingConfigError` at call time instead of crashing every import).
 * Stored on globalThis so Next.js dev hot-reloads don't open a new pool each time.
 */
export function getDb(): PrismaClient {
  if (!globalForDb.khetmitraDb) {
    const adapter = new PrismaPg({
      connectionString: requireEnv("DATABASE_URL", "Database"),
      // Fail a request in 5 s rather than hang it when the database is unreachable.
      connectionTimeoutMillis: 5_000,
      max: 5,
    });
    globalForDb.khetmitraDb = new PrismaClient({ adapter });
  }
  return globalForDb.khetmitraDb;
}
