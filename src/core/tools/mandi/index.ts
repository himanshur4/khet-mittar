import { CROPS, isCropId } from "@config/crops";
import type { Sourced } from "@/core/lib/http";
import { logger } from "@/core/lib/logger";
import { istDateKey } from "@/core/lib/format";
import { defineTool, type SourceRef } from "../types";
import { describeTrend, districtNames, rankMarkets, sameDistrict } from "./analysis";
import type { MandiPriceProvider } from "./client";
import { mandiArgsSchema, type MandiPriceRepository, type MandiPriceRow } from "./schema";

const TREND_WINDOW_DAYS = 30;
const MAX_MARKETS = 8;

export function createMandiTool(deps: {
  provider: MandiPriceProvider;
  repo: MandiPriceRepository | null;
}) {
  return defineTool({
    name: "getMandiPrices",
    description:
      "Latest wholesale mandi prices from Agmarknet for one commodity in a state: markets in the farmer's district first, min/max/modal price (Rs per quintal), arrival date, and the observed price change over recent days. Report observed prices only; never predict future prices.",
    args: mandiArgsSchema,
    timeoutMs: 30_000,
    async execute({ commodity, state, district }) {
      const key = commodity.toLowerCase();
      const names = isCropId(key) ? CROPS[key].agmarknetNames : [commodity];

      // Agmarknet spells some commodities in several ways; use the first that has reports.
      let current: Sourced<MandiPriceRow[]> | undefined;
      for (const name of names) {
        const result = await deps.provider.current(name, state);
        current ??= result;
        if (result.data.length > 0) {
          current = result;
          break;
        }
      }
      if (!current) throw new Error("no commodity name to query");
      const rows = current.data;
      const commodityName = rows[0]?.commodity ?? names[0]!;
      const sources: SourceRef[] = [
        {
          kind: "tool",
          title: "Agmarknet daily mandi prices (data.gov.in)",
          detail: `${commodityName}, ${state}`,
          url: "https://data.gov.in/resource/current-daily-price-various-commodities-various-markets-mandi",
          fetchedAt: current.fetchedAt.toISOString(),
          freshness: current.freshness,
        },
      ];

      // Renamed districts: match "Ahmednagar" (geocoder) with "Ahilyanagar" (Agmarknet).
      const districtCandidates = district ? districtNames(state, district) : [];
      // Query history with Agmarknet's own spelling, taken from today's rows when present.
      const agmarknetDistrict = district
        ? (rows.find((r) => sameDistrict(r.district, districtCandidates))?.district ?? district)
        : undefined;

      if (deps.repo && rows.length > 0) {
        await deps.repo
          .save(rows, current.source, current.fetchedAt)
          .catch((err: unknown) => logger.warn("could not store mandi rows", { err }));
      }
      if (deps.repo && agmarknetDistrict) {
        // History is best effort: the trend still works from rows saved on earlier days.
        try {
          const history = await deps.provider.history(commodityName, state, agmarknetDistrict);
          if (history.data.length > 0) {
            await deps.repo.save(history.data, history.source, history.fetchedAt);
          }
        } catch (err) {
          logger.info("Agmarknet history unavailable; using stored rows only", { err });
        }
      }

      const since = istDateKey(new Date(Date.now() - TREND_WINDOW_DAYS * 86_400_000));
      let trendScope: "district" | "state" = "district";
      let points =
        deps.repo && district
          ? await deps.repo
              .dailyMedians({
                commodities: [commodityName],
                state,
                districts: districtCandidates,
                sinceDate: since,
              })
              .catch(() => [])
          : [];
      if (points.length < 2 && deps.repo) {
        trendScope = "state";
        points = await deps.repo
          .dailyMedians({ commodities: [commodityName], state, sinceDate: since })
          .catch(() => []);
      }
      const trend = describeTrend(points);

      const ranked = rankMarkets(rows, districtCandidates).slice(0, MAX_MARKETS);
      const districtReports = district
        ? ranked.filter((r) => sameDistrict(r.district, districtCandidates))
        : [];
      const latestArrivalDate = rows.reduce<string | null>(
        (max, r) => (max === null || r.arrivalDate > max ? r.arrivalDate : max),
        null,
      );

      return {
        data: {
          commodity: commodityName,
          state,
          district: district ?? null,
          unit: "Rs per quintal (100 kg)",
          latestArrivalDate,
          marketsReportingInState: new Set(rows.map((r) => r.market)).size,
          districtHasReports: district ? districtReports.length > 0 : null,
          markets: ranked.map((r) => ({
            market: r.market,
            district: r.district,
            variety: r.variety,
            grade: r.grade,
            arrivalDate: r.arrivalDate,
            minPrice: r.minPrice,
            maxPrice: r.maxPrice,
            modalPrice: r.modalPrice,
          })),
          observedTrend: trend
            ? {
                ...trend,
                scope: trendScope,
                basis: "median modal price per day across reporting markets",
              }
            : { unavailable: "fewer than two days of observed prices so far" },
          ...(rows.length === 0
            ? {
                note: `No Agmarknet reports for ${commodityName} in ${state} today. Mandis report only on trading days; try a nearby state or ask again later.`,
              }
            : {}),
        },
        sources,
        summary:
          rows.length > 0
            ? `${commodityName}: ${ranked.length} markets, latest ${latestArrivalDate}; trend ${trend ? `${trend.direction} ${trend.changePct}% over ${trend.days} d` : "n/a"}`
            : `${commodityName}: no reports in ${state}`,
      };
    },
  });
}
