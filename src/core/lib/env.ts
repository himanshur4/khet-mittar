/**
 * Environment configuration, validated once with Zod.
 *
 * Policy (see README "Configuration"):
 * - A variable that is set but malformed throws `ConfigError` on first access, so a bad
 *   deploy fails fast and loudly.
 * - A variable that is missing does NOT crash the server. Each feature asks for its keys via
 *   `requireEnv()`, which throws `MissingConfigError` with the exact variable name. The rest of
 *   the app keeps working and `/api/health` shows what is missing.
 */
import { z } from "zod";
import { ConfigError, MissingConfigError } from "./errors";
import { logger } from "./logger";

// "KEY=" in a .env file means "not set", not "set to the empty string".
function blankAsUnset<T extends z.ZodType>(schema: T) {
  return z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema);
}

const provider = z.enum(["google", "openai"]);

const envSchema = z.object({
  NODE_ENV: blankAsUnset(z.enum(["development", "test", "production"]).default("development")),
  DATABASE_URL: blankAsUnset(
    z
      .string()
      .regex(/^postgres(ql)?:\/\//, "must start with postgres:// or postgresql://")
      .optional(),
  ),
  LLM_PROVIDER: blankAsUnset(provider.default("google")),
  LLM_MODEL: blankAsUnset(z.string().optional()),
  LLM_FALLBACK_PROVIDER: blankAsUnset(provider.optional()),
  LLM_FALLBACK_MODEL: blankAsUnset(z.string().optional()),
  EMBEDDING_PROVIDER: blankAsUnset(provider.optional()),
  EMBEDDING_MODEL: blankAsUnset(z.string().optional()),
  GOOGLE_GENERATIVE_AI_API_KEY: blankAsUnset(z.string().optional()),
  OPENAI_API_KEY: blankAsUnset(z.string().optional()),
  DATA_GOV_IN_API_KEY: blankAsUnset(z.string().optional()),
  MANDI_RESOURCE_ID: blankAsUnset(
    z
      .string()
      .regex(/^[0-9a-f-]{36}$/i, "must be a data.gov.in resource UUID")
      .optional(),
  ),
  SARVAM_API_KEY: blankAsUnset(z.string().optional()),
  CRON_SECRET: blankAsUnset(z.string().min(16, "use at least 16 random characters").optional()),
  LOG_LEVEL: blankAsUnset(z.enum(["debug", "info", "warn", "error"]).default("info")),
});

export type Env = z.infer<typeof envSchema>;
export type LlmProviderName = z.infer<typeof provider>;

let cached: Env | undefined;

/** Parsed environment. Throws `ConfigError` listing every malformed variable. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`Invalid environment variables:\n  - ${problems.join("\n  - ")}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test hook: forget the cached parse after mutating `process.env`. */
export function resetEnvCache(): void {
  cached = undefined;
}

type StringKey = {
  [K in keyof Env]-?: Env[K] extends string | undefined ? K : never;
}[keyof Env];

/** Returns the value or throws `MissingConfigError` naming the variable and the feature. */
export function requireEnv(key: StringKey, feature: string): string {
  const value = getEnv()[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new MissingConfigError(feature, [key]);
  }
  return value;
}

export function apiKeyVarFor(providerName: LlmProviderName): StringKey {
  return providerName === "google" ? "GOOGLE_GENERATIVE_AI_API_KEY" : "OPENAI_API_KEY";
}

export interface FeatureConfigStatus {
  feature: string;
  configured: boolean;
  missing: string[];
}

/** Which features are usable with the current configuration. Never throws. */
export function featureConfigStatus(): FeatureConfigStatus[] {
  let env: Env;
  try {
    env = getEnv();
  } catch {
    return [
      { feature: "configuration", configured: false, missing: ["(invalid values, see logs)"] },
    ];
  }
  const embeddingProvider = env.EMBEDDING_PROVIDER ?? env.LLM_PROVIDER;
  const features: Array<[string, StringKey[]]> = [
    ["Database", ["DATABASE_URL"]],
    [`LLM (${env.LLM_PROVIDER})`, [apiKeyVarFor(env.LLM_PROVIDER)]],
    [`Embeddings (${embeddingProvider})`, [apiKeyVarFor(embeddingProvider)]],
    ["Mandi prices (data.gov.in)", ["DATA_GOV_IN_API_KEY"]],
    ["Speech & translation (Sarvam AI)", ["SARVAM_API_KEY"]],
    ["Scheduled alerts (cron)", ["CRON_SECRET"]],
  ];
  return features.map(([feature, keys]) => {
    const missing = keys.filter((k) => !env[k]);
    return { feature, configured: missing.length === 0, missing };
  });
}

/** Startup report: one clear log line per missing feature so misconfiguration is obvious. */
export function logConfigReport(): void {
  try {
    getEnv();
  } catch (error) {
    logger.error("Invalid configuration", { err: error });
    throw error;
  }
  const missing = featureConfigStatus().filter((f) => !f.configured);
  if (missing.length === 0) {
    logger.info("Configuration OK: all features configured");
    return;
  }
  for (const f of missing) {
    logger.warn(`Feature disabled until configured: ${f.feature}`, { missing: f.missing });
  }
}
