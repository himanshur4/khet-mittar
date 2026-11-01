import { describe, expect, it } from "vitest";
import { searchAdvisoriesArgsSchema } from "../advisories";
import { geocodeArgsSchema } from "../geocode/schema";
import { mandiArgsSchema } from "../mandi/schema";
import { soilArgsSchema } from "../soil/schema";
import { defineTool } from "../types";
import { weatherArgsSchema } from "../weather/schema";

describe("tool argument schemas", () => {
  it("accept well-formed arguments and apply defaults", () => {
    expect(weatherArgsSchema.parse({ latitude: 19.99, longitude: 73.79 })).toEqual({
      latitude: 19.99,
      longitude: 73.79,
      days: 7,
    });
    expect(
      mandiArgsSchema.safeParse({ commodity: "onion", state: "Maharashtra", district: "Nashik" })
        .success,
    ).toBe(true);
    expect(
      searchAdvisoriesArgsSchema.safeParse({ query: "onion thrips", crop: "onion" }).success,
    ).toBe(true);
  });

  it("reject coordinates outside India, bad types and unknown crops", () => {
    expect(weatherArgsSchema.safeParse({ latitude: 51.5, longitude: -0.1 }).success).toBe(false);
    expect(weatherArgsSchema.safeParse({ latitude: "20", longitude: 74 }).success).toBe(false);
    expect(weatherArgsSchema.safeParse({ latitude: 20, longitude: 74, days: 30 }).success).toBe(
      false,
    );
    expect(soilArgsSchema.safeParse({ latitude: 20 }).success).toBe(false);
    expect(searchAdvisoriesArgsSchema.safeParse({ query: "x", crop: "banana" }).success).toBe(
      false,
    );
    expect(geocodeArgsSchema.safeParse({ place: "a" }).success).toBe(false);
  });
});

describe("defineTool", () => {
  const tool = defineTool({
    name: "getWeatherForecast",
    description: "test",
    args: weatherArgsSchema,
    timeoutMs: 1000,
    async execute(args) {
      return { data: args, sources: [], summary: "ok" };
    },
  });

  it("exposes a JSON Schema for the LLM", () => {
    expect(tool.inputJsonSchema).toMatchObject({
      type: "object",
      properties: { latitude: { type: "number" }, longitude: { type: "number" } },
    });
    expect(tool.inputJsonSchema).not.toHaveProperty("$schema");
  });

  it("returns readable issues the model can act on", () => {
    const result = tool.validate({ latitude: 99 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([expect.stringContaining("latitude: India spans")]),
      );
      expect(result.issues.some((i) => i.startsWith("longitude:"))).toBe(true);
    }
  });

  it("runs with parsed (defaulted) arguments", async () => {
    const result = tool.validate({ latitude: 20, longitude: 74 });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect((await result.run({ farmer: null })).data).toEqual({
        latitude: 20,
        longitude: 74,
        days: 7,
      });
  });
});
