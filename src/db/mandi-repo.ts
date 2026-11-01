import type { MandiPriceRepository, TrendPoint } from "@/core/tools/mandi/schema";
import { getDb, Prisma } from "./client";

/** Normalised place comparison in SQL: letters only, lower case, prefix match. */
const placeMatch = (column: Prisma.Sql, value: string) =>
  Prisma.sql`regexp_replace(lower(${column}), '[^a-z]', '', 'g') LIKE regexp_replace(lower(${value}), '[^a-z]', '', 'g') || '%'`;

export const dbMandiRepository: MandiPriceRepository = {
  async save(rows, source, fetchedAt) {
    if (rows.length === 0) return;
    await getDb().mandiPrice.createMany({
      data: rows.map((r) => ({
        ...r,
        arrivalDate: new Date(`${r.arrivalDate}T00:00:00Z`),
        source,
        fetchedAt,
      })),
      // The unique key (market, commodity, variety, grade, date…) makes re-fetches idempotent.
      skipDuplicates: true,
    });
  },

  async dailyMedians({ commodities, state, district, sinceDate }) {
    const districtFilter = district
      ? Prisma.sql`AND ${placeMatch(Prisma.sql`district`, district)}`
      : Prisma.empty;
    const rows = await getDb().$queryRaw<Array<{ date: string; median: unknown; markets: number }>>`
      SELECT to_char(arrival_date, 'YYYY-MM-DD') AS date,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY modal_price) AS median,
             count(DISTINCT market)::int AS markets
      FROM mandi_prices
      WHERE commodity = ANY(${commodities}::text[])
        AND ${placeMatch(Prisma.sql`state`, state)}
        ${districtFilter}
        AND arrival_date >= ${sinceDate}::date
      GROUP BY arrival_date
      ORDER BY arrival_date`;
    return rows.map((r): TrendPoint => ({
      date: r.date,
      medianModalPrice: Math.round(Number(r.median)),
      markets: r.markets,
    }));
  },
};
