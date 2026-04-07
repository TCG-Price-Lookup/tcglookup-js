import { describe, expect, it, vi } from "vitest";
import {
  TcgLookupClient,
  AuthenticationError,
  PlanAccessError,
  NotFoundError,
  RateLimitError,
  TcgLookupError,
  type Card,
  type CardSearchResponse,
} from "../src/index.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      "x-ratelimit-limit": "100000",
      "x-ratelimit-remaining": "99999",
      ...(init.headers ?? {}),
    },
  });
}

function fakeCard(id: string): Card {
  return {
    id,
    tcgplayer_id: 1,
    name: "Charizard",
    number: "006/197",
    rarity: "Double Rare",
    variant: "Standard",
    image_url: "https://cdn.example/charizard.jpg",
    updated_at: "2026-02-16T12:00:00Z",
    set: { id: "set-1", slug: "obsidian-flames", name: "Obsidian Flames" },
    game: { id: "game-1", slug: "pokemon", name: "Pokemon" },
    prices: { raw: { near_mint: { tcgplayer: { market: 48.97, low: 42.5, mid: 49.99, high: 64.99 } } } },
  };
}

function emptyResponse(): CardSearchResponse {
  return { data: [], total: 0, limit: 20, offset: 0 };
}

describe("TcgLookupClient", () => {
  it("requires an apiKey", () => {
    // @ts-expect-error testing runtime guard
    expect(() => new TcgLookupClient({})).toThrow(/apiKey/);
  });

  it("sends the X-API-Key header on every request", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(emptyResponse()));
    const client = new TcgLookupClient({ apiKey: "test_key", fetch: fetchMock });
    await client.cards.search({ q: "charizard" });
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("test_key");
  });

  it("captures rate-limit headers from the latest response", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(emptyResponse(), {
        headers: { "x-ratelimit-limit": "10000", "x-ratelimit-remaining": "9876" },
      })
    );
    const client = new TcgLookupClient({ apiKey: "test_key", fetch: fetchMock });
    await client.cards.search({ q: "x" });
    expect(client.rateLimit.limit).toBe(10000);
    expect(client.rateLimit.remaining).toBe(9876);
  });

  it("builds /v1/cards/search with the right query string", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(emptyResponse()));
    const client = new TcgLookupClient({ apiKey: "k", fetch: fetchMock });
    await client.cards.search({ q: "char", game: "pokemon", set: "obsidian-flames", limit: 10 });
    const [url] = fetchMock.mock.calls[0]!;
    const u = new URL(url as string);
    expect(u.pathname).toBe("/v1/cards/search");
    expect(u.searchParams.get("q")).toBe("char");
    expect(u.searchParams.get("game")).toBe("pokemon");
    expect(u.searchParams.get("set")).toBe("obsidian-flames");
    expect(u.searchParams.get("limit")).toBe("10");
  });

  it("auto-chunks ids[] into multiple requests at 20 per chunk and merges results", async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `id-${i}`);
    const calls: URL[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (url: string | URL | Request) => {
      const u = new URL(url as string);
      calls.push(u);
      const requestedIds = u.searchParams.get("ids")!.split(",");
      return jsonResponse({
        data: requestedIds.map(fakeCard),
        total: requestedIds.length,
        limit: requestedIds.length,
        offset: 0,
      });
    });
    const client = new TcgLookupClient({ apiKey: "k", fetch: fetchMock });
    const res = await client.cards.search({ ids });
    // 45 ids -> chunks of 20, 20, 5
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(calls[0]!.searchParams.get("ids")!.split(",")).toHaveLength(20);
    expect(calls[1]!.searchParams.get("ids")!.split(",")).toHaveLength(20);
    expect(calls[2]!.searchParams.get("ids")!.split(",")).toHaveLength(5);
    expect(res.data).toHaveLength(45);
    expect(res.data.map((c) => c.id)).toEqual(ids);
  });

  it("does not chunk when ids fit in one request", async () => {
    const ids = ["a", "b", "c"];
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ data: ids.map(fakeCard), total: 3, limit: 20, offset: 0 })
    );
    const client = new TcgLookupClient({ apiKey: "k", fetch: fetchMock });
    await client.cards.search({ ids });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(new URL(url as string).searchParams.get("ids")).toBe("a,b,c");
  });

  it("encodes the card id when fetching details", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(fakeCard("019535a1-d5d0-7c12-a3e8-b7f4c6d8e9a2")));
    const client = new TcgLookupClient({ apiKey: "k", fetch: fetchMock });
    await client.cards.get("019535a1-d5d0-7c12-a3e8-b7f4c6d8e9a2");
    const [url] = fetchMock.mock.calls[0]!;
    expect((url as string).endsWith("/v1/cards/019535a1-d5d0-7c12-a3e8-b7f4c6d8e9a2")).toBe(true);
  });

  it("sends ?period= on history requests", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ data: [], period: "30d" }));
    const client = new TcgLookupClient({ apiKey: "k", fetch: fetchMock });
    await client.cards.history("abc", { period: "7d" });
    const [url] = fetchMock.mock.calls[0]!;
    expect(new URL(url as string).searchParams.get("period")).toBe("7d");
  });

  it("sends /v1/sets with optional game query", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ data: [], total: 0, limit: 50, offset: 0 })
    );
    const client = new TcgLookupClient({ apiKey: "k", fetch: fetchMock });
    await client.sets.list({ game: "mtg" });
    const [url] = fetchMock.mock.calls[0]!;
    const u = new URL(url as string);
    expect(u.pathname).toBe("/v1/sets");
    expect(u.searchParams.get("game")).toBe("mtg");
  });

  it("sends /v1/games", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ data: [], total: 0, limit: 50, offset: 0 })
    );
    const client = new TcgLookupClient({ apiKey: "k", fetch: fetchMock });
    await client.games.list();
    const [url] = fetchMock.mock.calls[0]!;
    expect(new URL(url as string).pathname).toBe("/v1/games");
  });

  describe("error mapping", () => {
    it("maps 401 -> AuthenticationError", async () => {
      const fetchMock = vi.fn<typeof fetch>(async () =>
        jsonResponse({ error: "Invalid API key" }, { status: 401 })
      );
      const client = new TcgLookupClient({ apiKey: "k", fetch: fetchMock });
      await expect(client.cards.search()).rejects.toBeInstanceOf(AuthenticationError);
    });

    it("maps 403 -> PlanAccessError with the backend's message", async () => {
      const fetchMock = vi.fn<typeof fetch>(async () =>
        jsonResponse(
          { error: "History endpoint requires trader plan or above" },
          { status: 403 }
        )
      );
      const client = new TcgLookupClient({ apiKey: "k", fetch: fetchMock });
      await expect(client.cards.history("abc")).rejects.toMatchObject({
        name: "PlanAccessError",
        status: 403,
        message: "History endpoint requires trader plan or above",
      });
    });

    it("maps 404 -> NotFoundError", async () => {
      const fetchMock = vi.fn<typeof fetch>(async () =>
        jsonResponse({ error: "Card not found" }, { status: 404 })
      );
      const client = new TcgLookupClient({ apiKey: "k", fetch: fetchMock });
      await expect(client.cards.get("00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(
        NotFoundError
      );
    });

    it("maps 429 -> RateLimitError", async () => {
      const fetchMock = vi.fn<typeof fetch>(async () =>
        jsonResponse({ error: "Rate limit exceeded" }, { status: 429 })
      );
      const client = new TcgLookupClient({ apiKey: "k", fetch: fetchMock });
      await expect(client.cards.search()).rejects.toBeInstanceOf(RateLimitError);
    });

    it("falls back to TcgLookupError for 500", async () => {
      const fetchMock = vi.fn<typeof fetch>(async () =>
        jsonResponse({ error: "Internal server error" }, { status: 500 })
      );
      const client = new TcgLookupClient({ apiKey: "k", fetch: fetchMock });
      await expect(client.cards.search()).rejects.toBeInstanceOf(TcgLookupError);
    });
  });

  describe("retry policy", () => {
    it("does not retry by default", async () => {
      const fetchMock = vi.fn<typeof fetch>(async () =>
        jsonResponse({ error: "boom" }, { status: 500 })
      );
      const client = new TcgLookupClient({ apiKey: "k", fetch: fetchMock });
      await expect(client.cards.search()).rejects.toBeInstanceOf(TcgLookupError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("retries 429 and 5xx up to the configured attempts", async () => {
      let calls = 0;
      const fetchMock = vi.fn<typeof fetch>(async () => {
        calls++;
        if (calls < 3) return jsonResponse({ error: "throttled" }, { status: 429 });
        return jsonResponse(emptyResponse());
      });
      const client = new TcgLookupClient({
        apiKey: "k",
        fetch: fetchMock,
        retry: { attempts: 3, baseDelayMs: 1 },
      });
      await client.cards.search({ q: "x" });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("does not retry 4xx other than 429", async () => {
      const fetchMock = vi.fn<typeof fetch>(async () =>
        jsonResponse({ error: "nope" }, { status: 401 })
      );
      const client = new TcgLookupClient({
        apiKey: "k",
        fetch: fetchMock,
        retry: { attempts: 3, baseDelayMs: 1 },
      });
      await expect(client.cards.search()).rejects.toBeInstanceOf(AuthenticationError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
