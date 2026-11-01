"use client";

import { Database, ExternalLink, FileText } from "lucide-react";
import type { LanguageId } from "@config/languages";
import { formatIst } from "@/core/lib/format";
import type { Citation } from "@/core/tools/types";
import { cn } from "@/lib/utils";
import { useApp } from "../app-context";

export function SourceChips({
  citations,
  highlighted,
  language,
}: {
  citations: Citation[];
  highlighted?: string | null;
  language: LanguageId;
}) {
  const { t } = useApp();
  if (citations.length === 0) return null;
  return (
    <div className="mt-3 border-t pt-2">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t.sources}</p>
      <ul className="flex flex-wrap gap-1.5">
        {citations.map((c) => {
          const Icon = c.kind === "document" ? FileText : Database;
          const body = (
            <>
              <span className="font-semibold text-primary">{c.id}</span>
              <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0">
                <span className="line-clamp-1 font-medium">{c.title}</span>
                {c.detail && <span className="line-clamp-1 text-muted-foreground">{c.detail}</span>}
                <span className="text-muted-foreground">
                  {t.fetched} {formatIst(c.fetchedAt, language)}
                </span>
              </span>
              {c.freshness === "stale-cache" && (
                <span className="rounded bg-amber-100 px-1 text-[0.65rem] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                  {t.cachedBadge}
                </span>
              )}
              {c.url && (
                <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              )}
            </>
          );
          const className = cn(
            "flex max-w-full items-start gap-1.5 rounded-lg border bg-background px-2 py-1 text-left text-xs sm:max-w-[22rem]",
            highlighted === c.id && "border-primary ring-2 ring-primary/30",
          );
          return (
            <li key={c.id} id={`cite-${c.id}`} className="max-w-full">
              {c.url ? (
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(className, "hover:bg-muted")}
                >
                  {body}
                </a>
              ) : (
                <div className={className}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
