import type { RequestContext, RequestOptions } from "../client.js";
import type { GameListParams, GameListResponse } from "../types.js";

export class GamesResource {
  constructor(private readonly ctx: RequestContext) {}

  /** List every supported trading card game with its slug and catalog size. */
  async list(
    params: GameListParams = {},
    opts: RequestOptions = {}
  ): Promise<GameListResponse> {
    return this.ctx.request<GameListResponse>({
      method: "GET",
      path: "/games",
      query: {
        limit: params.limit,
        offset: params.offset,
      },
      signal: opts.signal,
    });
  }
}
