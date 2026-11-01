import { defineConfig } from "prisma/config";

// Prisma 7 does not read .env by itself. A missing file is fine: CI and Vercel inject real env vars.
try {
  process.loadEnvFile();
} catch {
  // no .env file
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Read directly (not via `env()`, which throws) so `prisma generate` works without a database.
  datasource: { url: process.env.DATABASE_URL },
});
