/**
 * Health report for /api/health and the UI status dot. Each check has a short timeout and
 * the report is cached for a minute, so the indicator never hammers rate-limited providers.
 */
import { resolveEmbeddingModel } from "@/core/agent/providers";
import { DEFAULT_MODELS } from "@/core/agent/models";
import { featureConfigStatus, getEnv, type FeatureConfigStatus } from "@/core/lib/env";
import { describeError } from "@/core/lib/errors";
import { request } from "@/core/lib/http";
import { getDb } from "@/db/client";
import { countChunks } from "@/db/vector";
import { DEFAULT_CURRENT_RESOURCE_ID } from "@/core/tools/mandi/client";

export interface CheckResult {
  ok: boolean;
  /** false = not configured (skipped), as opposed to configured-but-failing. */
  configured: boolean;
  latencyMs?: number;
  detail: string;
}

export interface HealthReport {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  checks: Record<string, CheckResult>;
  config: FeatureConfigStatus[];
}

const TIMEOUT_MS = 4_000;

async function timed(fn: () => Promise<string>): Promise<CheckResult> {
  const started = Date.now();
  try {
    const detail = await fn();
    return { ok: true, configured: true, latencyMs: Date.now() - started, detail };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      latencyMs: Date.now() - started,
      detail: describeError(error),
    };
  }
}

const notConfigured = (what: string): CheckResult => ({
  ok: false,
  configured: false,
  detail: `${what} not set`,
});

async function ping(provider: string, url: string, init?: RequestInit): Promise<string> {
  const res = await request({ provider, url, init, timeoutMs: TIMEOUT_MS, retries: 0 });
  return `HTTP ${res.status}`;
}

export async function buildHealthReport(): Promise<HealthReport> {
  const env = getEnv();
  const dbConfigured = Boolean(env.DATABASE_URL);
  const llmKey =
    env.LLM_PROVIDER === "google" ? env.GOOGLE_GENERATIVE_AI_API_KEY : env.OPENAI_API_KEY;
  const model = env.LLM_MODEL ?? DEFAULT_MODELS[env.LLM_PROVIDER].chat;

  const [database, openMeteo, soilGrids, dataGovIn, llm] = await Promise.all([
    dbConfigured
      ? timed(async () => {
          await Promise.race([
            getDb().$queryRaw`SELECT 1`,
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
          ]);
          return "connected";
        })
      : Promise.resolve(notConfigured("DATABASE_URL")),
    timed(() =>
      ping(
        "Open-Meteo",
        "https://api.open-meteo.com/v1/forecast?latitude=28.6&longitude=77.2&daily=temperature_2m_max&forecast_days=1",
      ),
    ),
    timed(() =>
      ping(
        "ISRIC SoilGrids",
        "https://rest.isric.org/soilgrids/v2.0/properties/query?lon=77.2&lat=28.6&property=phh2o&depth=0-5cm&value=mean",
      ),
    ),
    env.DATA_GOV_IN_API_KEY
      ? timed(() =>
          ping(
            "data.gov.in",
            `https://api.data.gov.in/resource/${env.MANDI_RESOURCE_ID ?? DEFAULT_CURRENT_RESOURCE_ID}?api-key=${encodeURIComponent(env.DATA_GOV_IN_API_KEY ?? "")}&format=json&limit=1`,
          ),
        )
      : Promise.resolve(notConfigured("DATA_GOV_IN_API_KEY")),
    llmKey
      ? timed(async () => {
          // Model-listing endpoints are free, so this checks the key without spending tokens.
          if (env.LLM_PROVIDER === "google") {
            await ping(
              "Gemini",
              `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${encodeURIComponent(llmKey)}`,
            );
          } else {
            await ping("OpenAI", "https://api.openai.com/v1/models", {
              headers: { authorization: `Bearer ${llmKey}` },
            });
          }
          return `${env.LLM_PROVIDER} ${model} reachable`;
        })
      : Promise.resolve(
          notConfigured(
            env.LLM_PROVIDER === "google" ? "GOOGLE_GENERATIVE_AI_API_KEY" : "OPENAI_API_KEY",
          ),
        ),
  ]);

  let advisoryIndex: CheckResult;
  if (!database.ok)
    advisoryIndex = { ok: false, configured: database.configured, detail: "database unavailable" };
  else {
    advisoryIndex = await timed(async () => {
      const embeddingModel = resolveEmbeddingModel().modelId;
      const n = await countChunks(embeddingModel);
      if (n === 0) throw new Error(`no chunks for ${embeddingModel}: run npm run ingest`);
      return `${n} chunks (${embeddingModel})`;
    });
  }

  // Sarvam has no free ping endpoint, so report configuration only (no paid call per check).
  const sarvam: CheckResult = env.SARVAM_API_KEY
    ? { ok: true, configured: true, detail: "key configured (not pinged)" }
    : notConfigured("SARVAM_API_KEY");

  const checks = { database, llm, advisoryIndex, openMeteo, soilGrids, dataGovIn, sarvam };
  const critical = [database, llm, openMeteo];
  const status = critical.some((c) => !c.ok)
    ? "down"
    : Object.values(checks).every((c) => c.ok)
      ? "ok"
      : "degraded";
  return { status, checkedAt: new Date().toISOString(), checks, config: featureConfigStatus() };
}

let cached: { at: number; report: HealthReport } | undefined;

export async function getHealthReport(fresh = false): Promise<HealthReport> {
  if (!fresh && cached && Date.now() - cached.at < 60_000) return cached.report;
  const report = await buildHealthReport();
  cached = { at: Date.now(), report };
  return report;
}
