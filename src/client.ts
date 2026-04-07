import { errorFromResponse, type TcgLookupError } from "./errors.js";
import type { RateLimitInfo } from "./types.js";
import { CardsResource } from "./resources/cards.js";
import { SetsResource } from "./resources/sets.js";
import { GamesResource } from "./resources/games.js";

const DEFAULT_BASE_URL = "https://api.tcgpricelookup.com/v1";
const DEFAULT_USER_AGENT = "tcglookup-js/0.1.0";

export interface RetryOptions {
  /** Max retry attempts after the initial request. Default 0 (retries off). */
  attempts: number;
  /** Base delay in ms. Each retry waits `baseDelayMs * 2^attempt` + jitter. */
  baseDelayMs?: number;
}

export interface TcgLookupClientOptions {
  apiKey: string;
  baseUrl?: string;
  /**
   * Custom fetch implementation. Defaults to the global `fetch`.
   * Useful for testing or for runtimes without a global fetch.
   */
  fetch?: typeof fetch;
  /** Per-request timeout in milliseconds. Default 30_000. */
  timeoutMs?: number;
  /**
   * Optional retry policy for 429 / 5xx responses. Off by default —
   * the SDK will not retry unless you opt in.
   */
  retry?: RetryOptions;
  /** Override the default User-Agent header (Node only; browsers strip it). */
  userAgent?: string;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

/**
 * Internal request hook used by resource classes.
 * Exposed via the client so resources don't need their own fetch wiring.
 */
export interface RequestContext {
  request<T>(opts: {
    method: "GET";
    path: string;
    query?: Record<string, string | number | undefined>;
    signal?: AbortSignal;
  }): Promise<T>;
  rateLimit: RateLimitInfo;
}

export class TcgLookupClient implements RequestContext {
  readonly cards: CardsResource;
  readonly sets: SetsResource;
  readonly games: GamesResource;

  /** Rate-limit headers from the most recent successful response. */
  rateLimit: RateLimitInfo = { limit: null, remaining: null };

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retry: Required<RetryOptions>;
  private readonly userAgent: string;

  constructor(opts: TcgLookupClientOptions) {
    if (!opts?.apiKey || typeof opts.apiKey !== "string") {
      throw new Error("TcgLookupClient: `apiKey` is required");
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new Error(
        "TcgLookupClient: no global `fetch` available. Pass `{ fetch }` explicitly or use Node 18+."
      );
    }
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.retry = {
      attempts: opts.retry?.attempts ?? 0,
      baseDelayMs: opts.retry?.baseDelayMs ?? 500,
    };
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;

    this.cards = new CardsResource(this);
    this.sets = new SetsResource(this);
    this.games = new GamesResource(this);
  }

  async request<T>(opts: {
    method: "GET";
    path: string;
    query?: Record<string, string | number | undefined>;
    signal?: AbortSignal;
  }): Promise<T> {
    const url = this.buildUrl(opts.path, opts.query);
    let attempt = 0;
    while (true) {
      try {
        return await this.dispatch<T>(url, opts.method, opts.signal);
      } catch (err) {
        if (!this.shouldRetry(err, attempt)) throw err;
        await this.sleep(this.backoffMs(attempt));
        attempt++;
      }
    }
  }

  private async dispatch<T>(
    url: string,
    method: "GET",
    externalSignal: AbortSignal | undefined
  ): Promise<T> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          "X-API-Key": this.apiKey,
          accept: "application/json",
          "user-agent": this.userAgent,
        },
        signal: controller.signal,
      });

      this.captureRateLimit(res);

      const body = await this.parseBody(res);
      if (!res.ok) {
        throw errorFromResponse({ status: res.status, url, body });
      }
      return body as T;
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener("abort", onAbort);
    }
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const url = new URL(this.baseUrl + (path.startsWith("/") ? path : `/${path}`));
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === "") continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async parseBody(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private captureRateLimit(res: Response): void {
    const limit = res.headers.get("x-ratelimit-limit");
    const remaining = res.headers.get("x-ratelimit-remaining");
    this.rateLimit = {
      limit: limit ? Number(limit) : null,
      remaining: remaining ? Number(remaining) : null,
    };
  }

  private shouldRetry(err: unknown, attempt: number): boolean {
    if (attempt >= this.retry.attempts) return false;
    if (!err || typeof err !== "object") return false;
    const status = (err as TcgLookupError).status;
    return status === 429 || (typeof status === "number" && status >= 500);
  }

  private backoffMs(attempt: number): number {
    const base = this.retry.baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * this.retry.baseDelayMs;
    return base + jitter;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
