import type { RequestContext, RequestOptions } from "../client.js";
import type {
  Card,
  CardSearchParams,
  CardSearchResponse,
  HistoryParams,
  HistoryResponse,
} from "../types.js";

/** Backend hard cap on `ids` per request. The SDK chunks larger arrays. */
export const SEARCH_IDS_CHUNK_SIZE = 20;

export class CardsResource {
  constructor(private readonly ctx: RequestContext) {}

  /**
   * Search cards by name, set, game, or batch by IDs.
   * Passing more than 20 IDs auto-chunks into multiple requests
   * and merges the results.
   */
  async search(
    params: CardSearchParams = {},
    opts: RequestOptions = {}
  ): Promise<CardSearchResponse> {
    const { ids, ...rest } = params;
    if (!ids || ids.length === 0) {
      return this.searchOnce(rest, opts);
    }
    if (ids.length <= SEARCH_IDS_CHUNK_SIZE) {
      return this.searchOnce({ ...rest, ids: ids.join(",") }, opts);
    }
    return this.searchChunked(ids, rest, opts);
  }

  /** Get a single card by its UUID. */
  async get(id: string, opts: RequestOptions = {}): Promise<Card> {
    if (!id) throw new Error("cards.get: `id` is required");
    return this.ctx.request<Card>({
      method: "GET",
      path: `/cards/${encodeURIComponent(id)}`,
      signal: opts.signal,
    });
  }

  /**
   * Daily price history for a card. Trader plan and above.
   * Free-tier API keys will receive a `PlanAccessError` (HTTP 403).
   */
  async history(
    id: string,
    params: HistoryParams = {},
    opts: RequestOptions = {}
  ): Promise<HistoryResponse> {
    if (!id) throw new Error("cards.history: `id` is required");
    return this.ctx.request<HistoryResponse>({
      method: "GET",
      path: `/cards/${encodeURIComponent(id)}/history`,
      query: { period: params.period },
      signal: opts.signal,
    });
  }

  private searchOnce(
    params: Omit<CardSearchParams, "ids"> & { ids?: string },
    opts: RequestOptions
  ): Promise<CardSearchResponse> {
    return this.ctx.request<CardSearchResponse>({
      method: "GET",
      path: "/cards/search",
      query: {
        q: params.q,
        ids: params.ids,
        game: params.game,
        set: params.set,
        limit: params.limit,
        offset: params.offset,
      },
      signal: opts.signal,
    });
  }

  private async searchChunked(
    ids: string[],
    params: Omit<CardSearchParams, "ids">,
    opts: RequestOptions
  ): Promise<CardSearchResponse> {
    const chunks = chunk(ids, SEARCH_IDS_CHUNK_SIZE);
    const responses = await Promise.all(
      chunks.map((c) => this.searchOnce({ ...params, ids: c.join(",") }, opts))
    );
    const merged: Card[] = [];
    let total = 0;
    for (const r of responses) {
      merged.push(...r.data);
      total += r.data.length;
    }
    return {
      data: merged,
      total,
      limit: params.limit ?? merged.length,
      offset: params.offset ?? 0,
    };
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
