/** Pure functions over real price rows: ranking nearby markets and describing observed trends. */
import type { MandiPriceRow, TrendPoint } from "./schema";

export const normalizePlace = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

export function sameDistrict(a: string, b: string): boolean {
  const x = normalizePlace(a);
  const y = normalizePlace(b);
  return x.length > 0 && y.length > 0 && (x === y || x.startsWith(y) || y.startsWith(x));
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return NaN;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Latest row per market, district markets first, then most recent, then by name. */
export function rankMarkets(rows: MandiPriceRow[], district?: string): MandiPriceRow[] {
  const latest = new Map<string, MandiPriceRow>();
  for (const row of rows) {
    const key = `${row.district}|${row.market}|${row.variety}`;
    const seen = latest.get(key);
    if (!seen || row.arrivalDate > seen.arrivalDate) latest.set(key, row);
  }
  return [...latest.values()].sort((a, b) => {
    const da = district && sameDistrict(a.district, district) ? 1 : 0;
    const db = district && sameDistrict(b.district, district) ? 1 : 0;
    return (
      db - da || b.arrivalDate.localeCompare(a.arrivalDate) || a.market.localeCompare(b.market)
    );
  });
}

export interface ObservedTrend {
  from: TrendPoint;
  to: TrendPoint;
  days: number;
  changePct: number;
  direction: "rising" | "falling" | "stable";
}

/**
 * Describes what already happened between the first and last observed day. Deliberately no
 * extrapolation: KhetMitra never predicts prices.
 */
export function describeTrend(points: TrendPoint[]): ObservedTrend | null {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const from = sorted[0];
  const to = sorted[sorted.length - 1];
  if (!from || !to || from.date === to.date || from.medianModalPrice <= 0) return null;
  const changePct =
    Math.round(((to.medianModalPrice - from.medianModalPrice) / from.medianModalPrice) * 1000) / 10;
  const days = Math.round((Date.parse(to.date) - Date.parse(from.date)) / 86_400_000);
  // Within ±3% is ordinary day-to-day noise in mandi modal prices.
  const direction = Math.abs(changePct) < 3 ? "stable" : changePct > 0 ? "rising" : "falling";
  return { from, to, days, changePct, direction };
}
