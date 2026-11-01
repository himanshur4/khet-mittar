/**
 * Minimal structured logger: one JSON line per event so logs stay greppable in Vercel.
 * Deliberately dependency-free; swap for pino if log volume ever matters.
 */
type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const configured = process.env.LOG_LEVEL;
  if (
    configured === "debug" ||
    configured === "info" ||
    configured === "warn" ||
    configured === "error"
  ) {
    return LEVEL_ORDER[configured];
  }
  return process.env.NODE_ENV === "test" ? LEVEL_ORDER.warn : LEVEL_ORDER.info;
}

function serializeError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  return {
    name: error.name,
    message: error.message,
    ...(error.cause !== undefined ? { cause: serializeError(error.cause) } : {}),
  };
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

function createLogger(bindings: Record<string, unknown>): Logger {
  const write = (level: Level, msg: string, data?: Record<string, unknown>) => {
    if (LEVEL_ORDER[level] < threshold()) return;
    const entry: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      msg,
      ...bindings,
    };
    for (const [key, value] of Object.entries(data ?? {})) {
      entry[key] = key === "err" || value instanceof Error ? serializeError(value) : value;
    }
    const line = JSON.stringify(entry);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };

  return {
    debug: (msg, data) => write("debug", msg, data),
    info: (msg, data) => write("info", msg, data),
    warn: (msg, data) => write("warn", msg, data),
    error: (msg, data) => write("error", msg, data),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

export const logger: Logger = createLogger({ app: "khetmitra" });
