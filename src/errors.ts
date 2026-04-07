/**
 * Base error thrown for any non-2xx response from the TCG Price Lookup API.
 *
 * The backend returns errors as `{ error: "<message>" }` (flat string).
 * Inspect `status` to branch on the HTTP code, or use the typed subclasses.
 */
export class TcgLookupError extends Error {
  readonly status: number;
  readonly url: string;
  /** Raw response body, parsed as JSON when possible. */
  readonly body: unknown;

  constructor(message: string, opts: { status: number; url: string; body: unknown }) {
    super(message);
    this.name = "TcgLookupError";
    this.status = opts.status;
    this.url = opts.url;
    this.body = opts.body;
  }
}

/** 401 — missing or invalid API key. */
export class AuthenticationError extends TcgLookupError {
  constructor(opts: { status: number; url: string; body: unknown; message: string }) {
    super(opts.message, opts);
    this.name = "AuthenticationError";
  }
}

/** 403 — your plan does not include access to this resource (e.g. history on Free). */
export class PlanAccessError extends TcgLookupError {
  constructor(opts: { status: number; url: string; body: unknown; message: string }) {
    super(opts.message, opts);
    this.name = "PlanAccessError";
  }
}

/** 404 — card / set / game does not exist. */
export class NotFoundError extends TcgLookupError {
  constructor(opts: { status: number; url: string; body: unknown; message: string }) {
    super(opts.message, opts);
    this.name = "NotFoundError";
  }
}

/** 429 — rate limit exceeded. */
export class RateLimitError extends TcgLookupError {
  constructor(opts: { status: number; url: string; body: unknown; message: string }) {
    super(opts.message, opts);
    this.name = "RateLimitError";
  }
}

/** Map an HTTP status + body to the most specific error subclass. */
export function errorFromResponse(opts: {
  status: number;
  url: string;
  body: unknown;
}): TcgLookupError {
  const message = extractMessage(opts.body) ?? `HTTP ${opts.status}`;
  const args = { ...opts, message };
  switch (opts.status) {
    case 401:
      return new AuthenticationError(args);
    case 403:
      return new PlanAccessError(args);
    case 404:
      return new NotFoundError(args);
    case 429:
      return new RateLimitError(args);
    default:
      return new TcgLookupError(message, opts);
  }
}

function extractMessage(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === "string") return err;
  }
  return null;
}
