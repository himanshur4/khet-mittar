/**
 * Proactive alert check: for every farmer, fetch the real forecast, detect IMD-threshold risks
 * in the next 72 h, and create one alert per crop × risk × day, written by the agent from the
 * official advisories (template text if the LLM is unavailable). Event-driven by design:
 * triggered by Vercel Cron or the "Run alert check now" button, idempotent via dedupe keys.
 */
import { randomUUID } from "node:crypto";
import { CROPS, type CropId } from "@config/crops";
import { runAgentTurn } from "@/core/agent/orchestrator";
import type { LlmClient, TraceSink } from "@/core/agent/types";
import { describeError } from "@/core/lib/errors";
import { daysBetween, istDateKey } from "@/core/lib/format";
import { logger } from "@/core/lib/logger";
import type { FarmerContext } from "@/core/profile/types";
import { createToolRegistry, type ToolRegistry } from "@/core/tools/registry";
import type { Citation, SourceRef } from "@/core/tools/types";
import type { WeatherProvider } from "@/core/tools/weather/client";
import { ALERT_HORIZON_DAYS, dedupeKey, detectWeatherRisks, type RiskEvent } from "./rules";
import { alertTitle, templateAlertMessage } from "./templates";

export interface NewAlert {
  farmerId: string;
  crop: CropId;
  kind: RiskEvent["kind"];
  severity: RiskEvent["severity"];
  title: string;
  message: string;
  eventDate: string;
  evidence: Record<string, unknown>;
  citations: Citation[];
  turnId: string | null;
  dedupeKey: string;
}

export interface AlertStore {
  exists(dedupeKey: string): Promise<boolean>;
  create(alert: NewAlert): Promise<void>;
}

export interface AlertWriter {
  write(params: {
    farmer: FarmerContext;
    crop: FarmerContext["crops"][number];
    risk: RiskEvent;
    forecastSource: SourceRef;
  }): Promise<{ message: string; citations: Citation[]; turnId: string } | null>;
}

export interface AlertRunSummary {
  ranAt: string;
  farmersChecked: number;
  risksFound: number;
  alertsCreated: number;
  duplicatesSkipped: number;
  writtenByAgent: number;
  errors: Array<{ farmerId: string; error: string }>;
}

/** Bounds LLM spend per run; remaining risks are picked up by the next run. */
const MAX_NEW_ALERTS_PER_RUN = 25;

export function createAgentAlertWriter(deps: {
  tools: ToolRegistry;
  models: { primary: LlmClient; fallback: LlmClient | null };
  traceFor?: (turnId: string) => TraceSink;
}): AlertWriter {
  const advisoryTool = deps.tools.get("searchAdvisories");
  // The forecast is supplied as context; the alert agent only needs the advisory library.
  const tools = createToolRegistry(advisoryTool ? [advisoryTool] : []);
  return {
    async write({ farmer, crop, risk, forecastSource }) {
      const today = istDateKey();
      const cropName = CROPS[crop.crop].names.en;
      const question = [
        "[Proactive alert task] Write a short alert for this farmer about a forecast weather risk.",
        `Risk: ${risk.metric.name} of ${risk.metric.value} ${risk.metric.unit} is forecast for ${risk.date} (${risk.metric.thresholdSource}).`,
        `Crop: ${cropName}, sown on ${crop.sowingDate} (${daysBetween(crop.sowingDate, today)} days after sowing).`,
        `First call searchAdvisories for what official advisories recommend for ${cropName} at this growth stage in this weather.`,
        "Then write: what is expected and when (cite the forecast id), and 2–3 concrete actions to take before it arrives (cite the advisory ids). At most 70 words. No greeting.",
      ].join("\n");
      const turnId = randomUUID();
      const result = await runAgentTurn({
        question,
        history: [],
        farmer,
        language: farmer.language,
        tools,
        models: deps.models,
        emit: () => {},
        trace: deps.traceFor?.(turnId),
        conversationId: null,
        turnId,
        context: [
          {
            label: "Forecast that triggered this alert",
            source: forecastSource,
            data: {
              date: risk.date,
              [risk.metric.name]: `${risk.metric.value} ${risk.metric.unit}`,
              classification: risk.metric.thresholdSource,
            },
          },
        ],
        limits: { maxSteps: 4, turnBudgetMs: 30_000 },
      });
      return result.ok ? { message: result.answer, citations: result.citations, turnId } : null;
    },
  };
}

export async function runAlertCheck(deps: {
  farmers: FarmerContext[];
  weather: WeatherProvider;
  store: AlertStore;
  writer: AlertWriter | null;
  now?: Date;
}): Promise<AlertRunSummary> {
  const now = deps.now ?? new Date();
  const today = istDateKey(now);
  const summary: AlertRunSummary = {
    ranAt: now.toISOString(),
    farmersChecked: 0,
    risksFound: 0,
    alertsCreated: 0,
    duplicatesSkipped: 0,
    writtenByAgent: 0,
    errors: [],
  };

  for (const farmer of deps.farmers) {
    summary.farmersChecked++;
    try {
      const forecast = await deps.weather.forecast(
        farmer.latitude,
        farmer.longitude,
        ALERT_HORIZON_DAYS + 1,
      );
      const risks = detectWeatherRisks(forecast.data, today);
      summary.risksFound += risks.length;
      for (const crop of farmer.crops) {
        for (const risk of risks) {
          const key = dedupeKey(farmer.id, crop.crop, risk);
          if (await deps.store.exists(key)) {
            summary.duplicatesSkipped++;
            continue;
          }
          if (summary.alertsCreated >= MAX_NEW_ALERTS_PER_RUN) break;
          const forecastSource: SourceRef = {
            kind: "tool",
            title: forecast.source,
            detail: `Forecast for ${risk.date} near ${farmer.locationName}`,
            url: "https://open-meteo.com/en/docs",
            fetchedAt: forecast.fetchedAt.toISOString(),
            freshness: forecast.freshness,
          };
          const written = deps.writer
            ? await deps.writer
                .write({ farmer, crop, risk, forecastSource })
                .catch((err: unknown) => {
                  logger.warn("agent could not write alert; using template", { err });
                  return null;
                })
            : null;
          if (written) summary.writtenByAgent++;
          await deps.store.create({
            farmerId: farmer.id,
            crop: crop.crop,
            kind: risk.kind,
            severity: risk.severity,
            title: alertTitle(risk.kind, crop.crop, farmer.language),
            message:
              written?.message ?? templateAlertMessage(risk, crop.crop, farmer.language, "S1"),
            eventDate: risk.date,
            evidence: {
              metric: risk.metric,
              forecastSource: forecast.source,
              forecastFetchedAt: forecast.fetchedAt.toISOString(),
              freshness: forecast.freshness,
              daysAfterSowing: daysBetween(crop.sowingDate, today),
            },
            citations: written?.citations ?? [{ ...forecastSource, id: "S1" }],
            turnId: written?.turnId ?? null,
            dedupeKey: key,
          });
          summary.alertsCreated++;
        }
      }
    } catch (error) {
      logger.warn("alert check failed for farmer", { farmerId: farmer.id, err: error });
      summary.errors.push({ farmerId: farmer.id, error: describeError(error) });
    }
  }
  return summary;
}
