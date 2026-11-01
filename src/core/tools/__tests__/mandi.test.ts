import { describe, expect, it } from "vitest";
import { describeTrend, districtNames, median, rankMarkets, sameDistrict } from "../mandi/analysis";
import { parseRecords, toIsoDate } from "../mandi/client";

describe("parseRecords", () => {
  it("normalises both data.gov.in resource shapes", () => {
    const rows = parseRecords([
      {
        state: "Maharashtra",
        district: "Nashik",
        market: "Lasalgaon",
        commodity: "Onion",
        variety: "Red",
        grade: "FAQ",
        arrival_date: "01/11/2026",
        min_price: "1500",
        max_price: "2,100",
        modal_price: 1850,
      },
      {
        State: "Maharashtra",
        District: "Nashik",
        Market: "Pimpalgaon",
        Commodity: "Onion",
        Variety: "Red",
        Grade: "FAQ",
        Arrival_Date: "31/10/2026",
        Min_Price: 1400,
        Max_Price: 2000,
        Modal_Price: 1700,
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      market: "Lasalgaon",
      arrivalDate: "2026-11-01",
      maxPrice: 2100,
      modalPrice: 1850,
    });
    expect(rows[1]).toMatchObject({ market: "Pimpalgaon", arrivalDate: "2026-10-31" });
  });

  it("drops malformed rows instead of failing the whole call", () => {
    const rows = parseRecords([
      {
        state: "X",
        district: "Y",
        market: "Z",
        commodity: "Onion",
        arrival_date: "yesterday",
        min_price: 1,
        max_price: 2,
        modal_price: 1,
      },
      {
        state: "X",
        district: "Y",
        market: "Z",
        commodity: "Onion",
        arrival_date: "01/11/2026",
        min_price: "NR",
        max_price: 2,
        modal_price: 1,
      },
    ]);
    expect(rows).toEqual([]);
  });

  it("parses dd/mm/yyyy and ISO dates", () => {
    expect(toIsoDate("1/11/2026")).toBe("2026-11-01");
    expect(toIsoDate("2026-11-01T00:00:00")).toBe("2026-11-01");
    expect(toIsoDate("Nov 1")).toBeNull();
  });
});

describe("market analysis", () => {
  const row = (market: string, district: string, arrivalDate: string, modalPrice: number) => ({
    state: "Maharashtra",
    district,
    market,
    commodity: "Onion",
    variety: "Red",
    grade: "FAQ",
    arrivalDate,
    minPrice: modalPrice - 200,
    maxPrice: modalPrice + 200,
    modalPrice,
  });

  it("matches district spellings loosely", () => {
    expect(sameDistrict("Nashik", "nashik ")).toBe(true);
    expect(sameDistrict("Ahmednagar", "Ahmed Nagar")).toBe(true);
    expect(sameDistrict("Pune", "Nashik")).toBe(false);
  });

  it("treats renamed districts as the same district, only within their state", () => {
    const names = districtNames("Maharashtra", "Ahmednagar");
    expect(names).toEqual(["Ahmednagar", "Ahilyanagar", "Ahmadnagar"]);
    expect(sameDistrict("Ahilyanagar", names)).toBe(true);
    expect(districtNames("Bihar", "Aurangabad")).toEqual(["Aurangabad"]);
    expect(districtNames("Maharashtra", "Aurangabad District")).toContain(
      "Chhatrapati Sambhajinagar",
    );
  });

  it("lists the farmer's district first and keeps the latest row per market", () => {
    const ranked = rankMarkets(
      [
        row("Pune", "Pune", "2026-11-01", 1900),
        row("Lasalgaon", "Nashik", "2026-10-31", 1700),
        row("Lasalgaon", "Nashik", "2026-11-01", 1800),
      ],
      "Nashik",
    );
    expect(ranked.map((r) => `${r.market}:${r.arrivalDate}`)).toEqual([
      "Lasalgaon:2026-11-01",
      "Pune:2026-11-01",
    ]);
  });

  it("describes only the observed change", () => {
    expect(
      describeTrend([
        { date: "2026-10-25", medianModalPrice: 2000, markets: 5 },
        { date: "2026-11-01", medianModalPrice: 1700, markets: 6 },
      ]),
    ).toMatchObject({ direction: "falling", changePct: -15, days: 7 });
    expect(
      describeTrend([
        { date: "2026-10-31", medianModalPrice: 1000, markets: 2 },
        { date: "2026-11-01", medianModalPrice: 1020, markets: 2 },
      ])?.direction,
    ).toBe("stable");
    expect(describeTrend([{ date: "2026-11-01", medianModalPrice: 1000, markets: 1 }])).toBeNull();
    expect(median([3, 1, 2, 10])).toBe(2.5);
  });
});
