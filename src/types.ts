/**
 * Public types for the TCG Price Lookup API.
 *
 * Shapes mirror the actual JSON returned by the production API.
 * If the backend changes, update both the type and the runtime parsing.
 */

/** Supported trading card games. Use these slugs in `game` filters. */
export type GameSlug =
  | "pokemon"
  | "pokemon-jp"
  | "mtg"
  | "yugioh"
  | "onepiece"
  | "lorcana"
  | "swu"
  | "fab";

/**
 * Raw card condition tiers returned by the API.
 *
 * The known set is enumerated for editor autocomplete; the trailing
 * `(string & {})` keeps the type forward-compatible if the backend
 * starts returning new conditions before this SDK is updated.
 */
export type Condition =
  | "mint"
  | "near_mint"
  | "lightly_played"
  | "moderately_played"
  | "heavily_played"
  | "damaged"
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});

/**
 * Grading services that may appear in graded prices.
 *
 * Same forward-compat pattern as Condition: known graders are listed
 * for autocomplete, but unknown ones are still accepted at the type level.
 */
export type Grader =
  | "psa"
  | "bgs"
  | "cgc"
  | "sgc"
  | "ace"
  | "tag"
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});

export interface TcgPlayerPrices {
  market: number | null;
  low: number | null;
  mid: number | null;
  high: number | null;
}

export interface EbayAverages {
  avg_1d: number | null;
  avg_7d: number | null;
  avg_30d: number | null;
}

export interface RawConditionPrices {
  /** Always present. */
  tcgplayer?: TcgPlayerPrices;
  /** Present on Trader plan and above. */
  ebay?: EbayAverages;
}

/** Per-grade price block keyed by source (typically `ebay`). */
export type GradedGradePrices = Partial<Record<"ebay" | "tcgplayer", EbayAverages>>;

/**
 * Graded prices: grader -> grade -> source -> averages.
 * Only returned on Trader plan and above.
 */
export type GradedPrices = Partial<
  Record<Grader, Record<string, GradedGradePrices>>
>;

export interface CardPrices {
  raw: Partial<Record<Condition, RawConditionPrices>>;
  /** Present on Trader plan and above. */
  graded?: GradedPrices;
}

export interface CardSetRef {
  id: string;
  slug: string;
  name: string;
}

export interface CardGameRef {
  id: string;
  slug: GameSlug;
  name: string;
}

export interface Card {
  id: string;
  tcgplayer_id: number | null;
  name: string;
  number: string | null;
  rarity: string | null;
  variant: string | null;
  image_url: string | null;
  /** Only present on the search endpoint. */
  last_price_update?: string | null;
  updated_at: string;
  set: CardSetRef;
  game: CardGameRef;
  prices: CardPrices;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export type CardSearchResponse = PaginatedResponse<Card>;

export interface CardSearchParams {
  /** Free-text search across card name, set name, and card number. */
  q?: string;
  /**
   * Batch lookup by card IDs. Backend caps each request at 20 IDs;
   * the SDK auto-chunks larger arrays into multiple requests.
   */
  ids?: string[];
  game?: GameSlug;
  set?: string;
  /** 1-100, default 20. */
  limit?: number;
  /** Pagination offset. Default 0. */
  offset?: number;
}

export interface SetSummary {
  id: string;
  slug: string;
  name: string;
  game: GameSlug;
  count: number;
  released_at: string | null;
}

export type SetListResponse = PaginatedResponse<SetSummary>;

export interface SetListParams {
  game?: GameSlug;
  /** 1-200, default 50. */
  limit?: number;
  offset?: number;
}

export interface GameSummary {
  id: string;
  slug: GameSlug;
  name: string;
  count: number;
}

export type GameListResponse = PaginatedResponse<GameSummary>;

export interface GameListParams {
  /** 1-200, default 50. */
  limit?: number;
  offset?: number;
}

export type HistoryPeriod = "7d" | "30d" | "90d" | "1y";

export interface HistoryPriceRow {
  source: "tcgplayer" | "ebay";
  condition: Condition | null;
  grader: Grader | null;
  grade: string | null;
  price_market: number | null;
  price_low: number | null;
  price_mid: number | null;
  price_high: number | null;
  avg_1d: number | null;
  avg_7d: number | null;
  avg_30d: number | null;
}

export interface HistoryDay {
  date: string;
  prices: HistoryPriceRow[];
}

export interface HistoryResponse {
  data: HistoryDay[];
  period: HistoryPeriod;
}

export interface HistoryParams {
  /** 7d / 30d / 90d / 1y. Defaults to 30d on the backend. */
  period?: HistoryPeriod;
}

/** Rate-limit info from the most recent response. */
export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
}
