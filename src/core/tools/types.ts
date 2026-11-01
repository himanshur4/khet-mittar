/**
 * Tool contract shared by the agent and the alert engine.
 *
 * A tool is "RPC the LLM can request": the model writes `{ name, args }`, our orchestrator
 * validates the args with the tool's Zod schema and calls `execute`. Tools never see the model.
 */
import { z } from "zod";
import type { Freshness } from "@/core/lib/http";
import type { FarmerContext } from "@/core/profile/types";

/** Where a fact came from. Rendered as a source chip and referenced inline as [S1], [S2]… */
export interface Citation {
  id: string;
  kind: "tool" | "document";
  title: string;
  detail?: string;
  url?: string;
  /** ISO timestamp of when the underlying data was fetched from the provider. */
  fetchedAt: string;
  freshness?: Freshness;
}

export type SourceRef = Omit<Citation, "id">;

export interface ToolOutput {
  /** Compact JSON sent back to the LLM; only facts it may cite. */
  data: unknown;
  sources: SourceRef[];
  /** One line for the agent-trace panel. */
  summary: string;
}

export interface ToolContext {
  farmer: FarmerContext | null;
  signal?: AbortSignal;
}

export interface ToolDefinition<TArgs> {
  name: string;
  /** Written for the LLM: when to use the tool and what the args mean. */
  description: string;
  args: z.ZodType<TArgs>;
  /** Hard ceiling for one execution, independent of the provider's own HTTP timeouts. */
  timeoutMs: number;
  execute(args: TArgs, ctx: ToolContext): Promise<ToolOutput>;
}

export type ValidationResult =
  { ok: true; run: (ctx: ToolContext) => Promise<ToolOutput> } | { ok: false; issues: string[] };

/** A tool with its arg type erased, so tools of different shapes can live in one registry. */
export interface RegisteredTool {
  name: string;
  description: string;
  /** JSON Schema handed to the LLM provider (generated from the Zod schema). */
  inputJsonSchema: Record<string, unknown>;
  timeoutMs: number;
  validate(rawArgs: unknown): ValidationResult;
}

export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(args)";
    return `${path}: ${issue.message}`;
  });
}

export function defineTool<TArgs>(def: ToolDefinition<TArgs>): RegisteredTool {
  const inputJsonSchema = z.toJSONSchema(def.args, { target: "draft-7", io: "input" }) as Record<
    string,
    unknown
  >;
  delete inputJsonSchema.$schema;
  return {
    name: def.name,
    description: def.description,
    inputJsonSchema,
    timeoutMs: def.timeoutMs,
    validate(rawArgs) {
      const parsed = def.args.safeParse(rawArgs ?? {});
      if (!parsed.success) return { ok: false, issues: formatZodIssues(parsed.error) };
      return { ok: true, run: (ctx) => def.execute(parsed.data, ctx) };
    },
  };
}

/** Shared arg schemas so every tool describes coordinates the same way. */
export const latitudeSchema = z
  .number()
  .min(6, "India spans latitude 6–38")
  .max(38, "India spans latitude 6–38")
  .describe("Latitude in decimal degrees (from geocode or the farmer profile)");

export const longitudeSchema = z
  .number()
  .min(68, "India spans longitude 68–98")
  .max(98, "India spans longitude 68–98")
  .describe("Longitude in decimal degrees (from geocode or the farmer profile)");
