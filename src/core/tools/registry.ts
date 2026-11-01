import type { RegisteredTool } from "./types";

export interface ToolRegistry {
  list(): RegisteredTool[];
  get(name: string): RegisteredTool | undefined;
}

export function createToolRegistry(tools: RegisteredTool[]): ToolRegistry {
  const byName = new Map(tools.map((t) => [t.name, t]));
  if (byName.size !== tools.length) throw new Error("duplicate tool names in registry");
  return {
    list: () => [...byName.values()],
    get: (name) => byName.get(name),
  };
}
