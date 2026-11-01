/**
 * Tiny harness for probe scripts: each probe makes one real request to an external API and
 * reports what came back, so we design clients around observed responses, not memory.
 */
import { pathToFileURL } from "node:url";

export type ProbeStatus = "ok" | "fail" | "skipped";

export interface ProbeResult {
  name: string;
  status: ProbeStatus;
  detail: string;
}

export interface HttpResult {
  status: number;
  ms: number;
  contentType: string;
  text: string;
  json: unknown;
}

export async function http(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<HttpResult> {
  const started = Date.now();
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return {
    status: res.status,
    ms: Date.now() - started,
    contentType: res.headers.get("content-type") ?? "",
    text,
    json,
  };
}

export async function probe(name: string, fn: () => Promise<string>): Promise<ProbeResult> {
  try {
    return { name, status: "ok", detail: await fn() };
  } catch (error) {
    if (error instanceof SkipProbe) return { name, status: "skipped", detail: error.message };
    return { name, status: "fail", detail: error instanceof Error ? error.message : String(error) };
  }
}

export class SkipProbe extends Error {}

export function requireKey(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new SkipProbe(`${name} not set`);
  return value;
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function printResults(results: ProbeResult[]): void {
  const icon = { ok: "OK  ", fail: "FAIL", skipped: "SKIP" } as const;
  for (const r of results) {
    console.log(`[${icon[r.status]}] ${r.name}\n       ${r.detail.replace(/\n/g, "\n       ")}`);
  }
}

/** Run `main` only when the file is executed directly (not when imported by run-all). */
export function runIfMain(metaUrl: string, main: () => Promise<ProbeResult[]>): void {
  const entry = process.argv[1];
  if (entry && metaUrl === pathToFileURL(entry).href) {
    main()
      .then((results) => {
        printResults(results);
        process.exitCode = results.some((r) => r.status === "fail") ? 1 : 0;
      })
      .catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
  }
}
