import { describe, expect, it } from "vitest";
import { createPacedEmbedder, DailyQuotaError, type Embedder } from "../embed";

function fakeEmbedder(failures: string[]): Embedder & { calls: number } {
  const embedder = {
    modelId: "fake-embedding",
    calls: 0,
    async embedDocuments(docs: Array<{ title: string; text: string }>) {
      embedder.calls++;
      const failure = failures.shift();
      if (failure) throw new Error(failure);
      return docs.map(() => [1, 0, 0]);
    },
    async embedQuery() {
      return [1, 0, 0];
    },
  };
  return embedder;
}

const docs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ title: "t", text: `chunk ${i}` }));

describe("createPacedEmbedder", () => {
  it("waits as long as the provider asks after a per-minute quota error, then retries", async () => {
    const inner = fakeEmbedder([
      "Quota exceeded for metric: embed_content_free_tier_requests, requests per minute. Please retry in 0.01s.",
    ]);
    const paced = createPacedEmbedder(inner, { perMinute: 90 });
    const vectors = await paced.embedDocuments(docs(5));
    expect(vectors).toHaveLength(5);
    expect(inner.calls).toBe(2);
  });

  it("stops with a clear error when the daily quota is used up", async () => {
    const inner = fakeEmbedder(["429 RESOURCE_EXHAUSTED: embed requests per day limit exceeded"]);
    const paced = createPacedEmbedder(inner, { perMinute: 90 });
    await expect(paced.embedDocuments(docs(3))).rejects.toBeInstanceOf(DailyQuotaError);
  });

  it("treats a message naming both minute and day quotas as a per-minute limit", async () => {
    const inner = fakeEmbedder([
      "Quota exceeded. Violations: EmbedContentRequestsPerMinutePerProject, EmbedContentRequestsPerDayPerProject. Please retry in 0.01s.",
    ]);
    const paced = createPacedEmbedder(inner, { perMinute: 90 });
    expect(await paced.embedDocuments(docs(2))).toHaveLength(2);
  });

  it("splits large inputs into slices and passes other errors through", async () => {
    const inner = fakeEmbedder([]);
    const paced = createPacedEmbedder(inner, { perMinute: 90 });
    expect(await paced.embedDocuments(docs(64))).toHaveLength(64);
    expect(inner.calls).toBe(3);
    const broken = createPacedEmbedder(fakeEmbedder(["invalid API key"]), { perMinute: 90 });
    await expect(broken.embedDocuments(docs(1))).rejects.toThrow("invalid API key");
  });
});
