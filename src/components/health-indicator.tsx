"use client";

import { useState } from "react";
import { useApp } from "./app-context";
import { cn } from "@/lib/utils";

const LABELS: Record<string, string> = {
  database: "Database",
  llm: "LLM",
  advisoryIndex: "Advisory library",
  openMeteo: "Weather (Open-Meteo)",
  soilGrids: "Soil (SoilGrids)",
  dataGovIn: "Mandi prices (data.gov.in)",
  sarvam: "Voice (Sarvam AI)",
};

export function HealthIndicator() {
  const { health, t, refreshHealth } = useApp();
  const [open, setOpen] = useState(false);
  const status = health?.status;
  const label =
    status === "ok"
      ? t.statusOk
      : status === "degraded"
        ? t.statusDegraded
        : status === "down"
          ? t.statusDown
          : t.statusUnknown;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          refreshHealth();
        }}
        className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        aria-expanded={open}
        aria-label={label}
        title={label}
      >
        <span
          className={cn(
            "size-2.5 rounded-full",
            status === "ok" && "bg-emerald-500",
            status === "degraded" && "bg-amber-500",
            status === "down" && "bg-red-500",
            !status && "animate-pulse bg-muted-foreground/40",
          )}
        />
        <span className="hidden sm:inline">{label}</span>
      </button>
      {open && health && (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border bg-popover p-3 text-xs shadow-lg">
          <ul className="space-y-1.5">
            {Object.entries(health.checks).map(([key, check]) => (
              <li key={key} className="flex items-start gap-2">
                <span
                  className={cn(
                    "mt-1 size-2 shrink-0 rounded-full",
                    check.ok
                      ? "bg-emerald-500"
                      : check.configured
                        ? "bg-red-500"
                        : "bg-muted-foreground/40",
                  )}
                />
                <span>
                  <span className="font-medium">{LABELS[key] ?? key}</span>
                  <span className="block text-muted-foreground">
                    {check.detail}
                    {check.latencyMs !== undefined ? ` · ${check.latencyMs} ms` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
