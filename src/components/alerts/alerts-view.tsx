"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  BellRing,
  CloudRain,
  LoaderCircle,
  RefreshCw,
  Snowflake,
  Thermometer,
  Wind,
} from "lucide-react";
import type { AlertRunSummary } from "@/core/alerts/engine";
import { formatIst } from "@/core/lib/format";
import type { Citation } from "@/core/tools/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useApp } from "../app-context";
import { AnswerText } from "../chat/answer-text";
import { SourceChips } from "../chat/source-chips";

interface AlertItem {
  id: string;
  crop: string;
  kind: string;
  severity: "info" | "warning" | "severe";
  title: string;
  message: string;
  eventDate: string;
  evidence: {
    metric?: {
      name: string;
      value: number;
      unit: string;
      threshold: number;
      thresholdSource: string;
    };
    daysAfterSowing?: number;
  };
  citations: Citation[];
  read: boolean;
  createdAt: string;
}

const KIND_ICON: Record<string, typeof CloudRain> = {
  heavy_rain: CloudRain,
  rain_before_inputs: CloudRain,
  heat_stress: Thermometer,
  cold_stress: Snowflake,
  strong_wind: Wind,
};

const SEVERITY_STYLE = {
  severe: "border-l-red-500",
  warning: "border-l-amber-500",
  info: "border-l-sky-500",
} as const;

export function AlertsView() {
  const { t, farmerId, language } = useApp();
  const [alerts, setAlerts] = useState<AlertItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!farmerId) return;
    const res = await fetch(`/api/alerts?farmerId=${encodeURIComponent(farmerId)}`).catch(
      () => null,
    );
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? t.networkError);
      return;
    }
    const data = (await res.json()) as { alerts: AlertItem[] };
    setError(null);
    setAlerts(data.alerts);
    const unread = data.alerts.filter((a) => !a.read).map((a) => a.id);
    if (unread.length > 0) {
      void fetch("/api/alerts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ farmerId, ids: unread }),
      }).catch(() => undefined);
    }
  }, [farmerId, t]);

  useEffect(() => {
    // Initial fetch of the inbox; the effect only kicks off the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const runCheck = async () => {
    if (!farmerId) return;
    setRunning(true);
    setSummary(null);
    try {
      const res = await fetch("/api/alerts/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ farmerId }),
      });
      const body = (await res.json()) as { summary?: AlertRunSummary; error?: { message: string } };
      if (body.summary) {
        setSummary(t.checkSummary(body.summary.alertsCreated, body.summary.risksFound));
        await load();
      } else {
        setSummary(body.error?.message ?? t.networkError);
      }
    } catch {
      setSummary(t.networkError);
    } finally {
      setRunning(false);
    }
  };

  if (!farmerId) {
    return (
      <div className="py-8">
        <h1 className="text-xl font-semibold">{t.alertsTitle}</h1>
        <p className="mt-2 text-muted-foreground">{t.alertsIntro}</p>
        <p className="mt-4 rounded-lg border border-dashed p-3 text-sm">
          {t.noProfileHint}{" "}
          <Link href="/profile" className="font-medium text-primary underline">
            {t.addProfile}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t.alertsTitle}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t.alertsIntro}</p>
        </div>
        <Button onClick={() => void runCheck()} disabled={running} size="lg">
          {running ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          {running ? t.running : t.runCheck}
        </Button>
      </div>
      {summary && (
        <p
          className="mt-3 rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground"
          role="status"
        >
          {summary}
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}

      <ul className="mt-5 space-y-3">
        {alerts?.length === 0 && <li className="text-muted-foreground">{t.noAlerts}</li>}
        {alerts?.map((a) => {
          const Icon = KIND_ICON[a.kind] ?? BellRing;
          const m = a.evidence.metric;
          return (
            <li
              key={a.id}
              className={cn("rounded-xl border border-l-4 bg-card p-4", SEVERITY_STYLE[a.severity])}
            >
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <h2 className="font-semibold">{a.title}</h2>
                    {!a.read && (
                      <span className="size-2 rounded-full bg-primary" aria-label="new" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t.eventOn}: {a.eventDate} · {formatIst(a.createdAt, language)}
                  </p>
                  <div className="mt-2 text-sm">
                    <AnswerText text={a.message} />
                  </div>
                  {m && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t.evidence}: {m.name} {m.value} {m.unit} ≥ {m.threshold} {m.unit} (
                      {m.thresholdSource})
                      {a.evidence.daysAfterSowing !== undefined
                        ? ` · ${a.evidence.daysAfterSowing} DAS`
                        : ""}
                    </p>
                  )}
                  <SourceChips citations={a.citations} language={language} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
