"use client";

import { Brain, ShieldCheck, TriangleAlert, Wrench } from "lucide-react";
import type { TraceStep } from "@/core/agent/types";
import { cn } from "@/lib/utils";
import { useApp } from "../app-context";

export interface TurnMeta {
  turnId: string;
  model: string;
  promptVersion: string;
}

const KIND_ICON = {
  llm: Brain,
  tool: Wrench,
  guardrail: ShieldCheck,
  error: TriangleAlert,
} as const;

const STATUS_STYLE: Record<TraceStep["status"], string> = {
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  invalid_args: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  error: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  fallback: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
};

/** Live view of the agent loop: every LLM call, tool call (with args), retry and guardrail. */
export function TracePanel({
  steps,
  meta,
  busy,
}: {
  steps: TraceStep[];
  meta: TurnMeta | null;
  busy: boolean;
}) {
  const { t } = useApp();
  const totalMs = steps.reduce((sum, s) => sum + s.latencyMs, 0);
  return (
    <section aria-label={t.traceTitle} className="flex h-full flex-col">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{t.traceTitle}</h2>
        {steps.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {steps.length} steps · {(totalMs / 1000).toFixed(1)} s
          </span>
        )}
      </div>
      {meta && (
        <p className="mb-2 text-[0.7rem] text-muted-foreground">
          model <code>{meta.model}</code> · prompt <code>{meta.promptVersion}</code>
        </p>
      )}
      {steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">{busy ? t.thinking : t.traceEmpty}</p>
      ) : (
        <ol className="space-y-2 overflow-y-auto">
          {steps.map((step) => {
            const Icon = KIND_ICON[step.kind];
            return (
              <li key={step.index} className="rounded-lg border bg-card p-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="font-mono font-medium">{step.name}</span>
                  <span
                    className={cn(
                      "rounded px-1 py-px text-[0.65rem] font-medium",
                      STATUS_STYLE[step.status],
                    )}
                  >
                    {step.status.replace("_", " ")}
                  </span>
                  {step.attempt && step.attempt > 1 && (
                    <span className="text-[0.65rem] text-muted-foreground">
                      attempt {step.attempt}
                    </span>
                  )}
                  <span className="ml-auto tabular-nums text-muted-foreground">
                    {step.latencyMs} ms
                  </span>
                </div>
                {step.summary && <p className="mt-1 text-muted-foreground">{step.summary}</p>}
                {step.error && <p className="mt-1 text-red-700 dark:text-red-300">{step.error}</p>}
                {step.citationIds && step.citationIds.length > 0 && (
                  <p className="mt-1 text-muted-foreground">→ {step.citationIds.join(", ")}</p>
                )}
                {step.args !== undefined && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-muted-foreground">args</summary>
                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-1.5 text-[0.65rem]">
                      {JSON.stringify(step.args, null, 2)}
                    </pre>
                  </details>
                )}
              </li>
            );
          })}
          {busy && (
            <li className="animate-pulse px-1 text-xs text-muted-foreground">{t.thinking}</li>
          )}
        </ol>
      )}
    </section>
  );
}
