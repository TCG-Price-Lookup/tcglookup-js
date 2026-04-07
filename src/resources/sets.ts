import type { RequestContext, RequestOptions } from "../client.js";
import type { SetListParams, SetListResponse } from "../types.js";

export class SetsResource {
  constructor(private readonly ctx: RequestContext) {}

  /** List sets across all games, or filter by game. */
  async list(
    params: SetListParams = {},
    opts: RequestOptions = {}
  ): Promise<SetListResponse> {
    return this.ctx.request<SetListResponse>({
      method: "GET",
      path: "/sets",
      query: {
        game: params.game,
        limit: params.limit,
        offset: params.offset,
      },
      signal: opts.signal,
    });
  }
}
