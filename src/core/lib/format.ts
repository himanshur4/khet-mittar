/** Display helpers shared by tools, alerts and the UI. All times are shown in IST. */

const IST = "Asia/Kolkata";

/** e.g. "1 Nov 2026, 12:05 pm IST". */
export function formatIst(date: Date | string, locale: "en" | "hi" = "en"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const text = new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", {
    timeZone: IST,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return `${text} IST`;
}

/** Calendar date (YYYY-MM-DD) in IST, used for "today" comparisons and dedupe keys. */
export function istDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(date);
}

/** Whole days between two YYYY-MM-DD calendar dates (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
