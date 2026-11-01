/**
 * Error hierarchy shared by every layer. Each error carries:
 * - `code`: stable machine-readable identifier (logged, sent to the UI),
 * - `userMessage`: something safe to show a farmer,
 * - `cause`: the original technical error, kept for logs only.
 */
export class AppError extends Error {
  readonly code: string;
  readonly userMessage: string;
  readonly status: number;

  constructor(
    message: string,
    options: { code: string; userMessage?: string; status?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.userMessage = options.userMessage ?? "Something went wrong. Please try again.";
    this.status = options.status ?? 500;
  }
}

/** An environment variable is present but malformed. This is a deploy bug, so we fail fast. */
export class ConfigError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, {
      code: "CONFIG_INVALID",
      userMessage: "The server is misconfigured. Please contact the app maintainer.",
      status: 500,
      cause,
    });
  }
}

/** A feature was used whose API key / setting is not configured. */
export class MissingConfigError extends AppError {
  readonly keys: string[];
  readonly feature: string;

  constructor(feature: string, keys: string[]) {
    super(`${feature} is not configured: missing ${keys.join(", ")} (see .env.example)`, {
      code: "CONFIG_MISSING",
      userMessage: `${feature} is not available right now (server is missing ${keys.join(", ")}).`,
      status: 503,
    });
    this.keys = keys;
    this.feature = feature;
  }
}

/** An external service failed (HTTP error, bad payload, network error). */
export class ProviderError extends AppError {
  readonly provider: string;
  readonly httpStatus: number | undefined;
  readonly retryable: boolean;

  constructor(
    provider: string,
    message: string,
    options: {
      httpStatus?: number;
      retryable?: boolean;
      cause?: unknown;
      userMessage?: string;
    } = {},
  ) {
    super(`${provider}: ${message}`, {
      code: "PROVIDER_ERROR",
      userMessage: options.userMessage ?? `${provider} is not responding right now.`,
      status: 502,
      cause: options.cause,
    });
    this.provider = provider;
    this.httpStatus = options.httpStatus;
    this.retryable = options.retryable ?? false;
  }
}

/** The provider did not answer within its time budget. Always retryable. */
export class ProviderTimeoutError extends ProviderError {
  constructor(provider: string, timeoutMs: number, cause?: unknown) {
    super(provider, `timed out after ${timeoutMs} ms`, {
      retryable: true,
      cause,
      userMessage: `${provider} took too long to respond.`,
    });
  }
}

/** Input (from a user, the LLM or an API) failed schema validation. */
export class ValidationError extends AppError {
  readonly issues: string[];

  constructor(message: string, issues: string[], userMessage?: string) {
    super(message, {
      code: "VALIDATION_FAILED",
      userMessage: userMessage ?? "Some of the information provided is not valid.",
      status: 400,
    });
    this.issues = issues;
  }
}

export class NotFoundError extends AppError {
  constructor(what: string, userMessage?: string) {
    super(`${what} not found`, {
      code: "NOT_FOUND",
      userMessage: userMessage ?? `${what} was not found.`,
      status: 404,
    });
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AppError(message, { code: "UNEXPECTED", cause: error });
}

/** Message suitable for logs and for feeding back to the LLM (never contains secrets). */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
