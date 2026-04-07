# tcglookup

Official JavaScript / TypeScript SDK for the [TCG Price Lookup API](https://tcgpricelookup.com/tcg-api) — live trading card prices for **Pokemon, Magic: The Gathering, Yu-Gi-Oh!, One Piece, Disney Lorcana, Star Wars: Unlimited, Flesh and Blood,** and **Pokemon Japan**, with TCGPlayer market data, real eBay sold-listing averages, and PSA / BGS / CGC graded values.

- Fully typed against the production API response shapes
- Zero runtime dependencies, native `fetch`, ESM + CJS
- Works in Node 18+, browsers, Cloudflare Workers, Bun, Deno
- Auto-chunks batch ID lookups beyond the backend's 20-per-request cap
- Typed errors (`AuthenticationError`, `PlanAccessError`, `RateLimitError`, …)
- Optional retry-with-backoff for `429` and `5xx` responses

> **Get a free API key:** <https://tcgpricelookup.com/tcg-api>

---

## Installation

```bash
npm install tcglookup
# or
pnpm add tcglookup
# or
yarn add tcglookup
```

## Quickstart

```ts
import { TcgLookupClient } from "tcglookup";

const tcg = new TcgLookupClient({ apiKey: process.env.TCG_API_KEY! });

const { data } = await tcg.cards.search({ q: "charizard", game: "pokemon" });
for (const card of data) {
  console.log(card.name, card.set.name, card.prices.raw.near_mint?.tcgplayer?.market);
}
```

The first time you call the API you'll need a key — sign up at <https://tcgpricelookup.com/tcg-api> (no credit card on the Free tier).

## Examples

### Search cards

```ts
const res = await tcg.cards.search({
  q: "charizard",
  game: "pokemon",
  set: "obsidian-flames",
  limit: 20,
});
console.log(res.total, "matches");
```

### Get a single card

```ts
const card = await tcg.cards.get("019535a1-d5d0-7c12-a3e8-b7f4c6d8e9a2");
console.log(card.prices.raw.near_mint?.tcgplayer?.market);
console.log(card.prices.graded?.psa?.["10"]?.ebay?.avg_7d); // Trader plan and above
```

### Batch lookup (auto-chunks at 20)

```ts
// Pass as many IDs as you want — the SDK transparently splits into 20-per-call
// requests and merges the results.
const portfolio = ["id-1", "id-2", /* … 50 ids … */];
const { data } = await tcg.cards.search({ ids: portfolio });
const total = data.reduce(
  (sum, c) => sum + (c.prices.raw.near_mint?.tcgplayer?.market ?? 0),
  0
);
console.log(`Portfolio value: $${total.toFixed(2)}`);
```

### Price history (Trader plan and above)

```ts
import { PlanAccessError } from "tcglookup";

try {
  const history = await tcg.cards.history(card.id, { period: "30d" });
  for (const day of history.data) {
    const tcgRow = day.prices.find((p) => p.source === "tcgplayer" && p.condition === "near_mint");
    console.log(day.date, tcgRow?.price_market);
  }
} catch (err) {
  if (err instanceof PlanAccessError) {
    console.log("Upgrade to Trader to access price history");
  } else {
    throw err;
  }
}
```

### List sets / games

```ts
const sets = await tcg.sets.list({ game: "pokemon", limit: 10 });
const games = await tcg.games.list();
```

### Read rate-limit info

```ts
await tcg.cards.search({ q: "pikachu" });
console.log(tcg.rateLimit); // { limit: 100000, remaining: 99987 }
```

### Retry on 429 / 5xx

Off by default — opt in explicitly:

```ts
const tcg = new TcgLookupClient({
  apiKey: process.env.TCG_API_KEY!,
  retry: { attempts: 3, baseDelayMs: 500 },
});
```

## Error handling

Every non-2xx response is mapped to a typed error you can `instanceof`-check:

| Status | Class                  | Meaning                                                      |
|------- |------------------------|--------------------------------------------------------------|
| 401    | `AuthenticationError`  | Missing or invalid API key                                   |
| 403    | `PlanAccessError`      | Your plan does not include this resource (e.g. history on Free) |
| 404    | `NotFoundError`        | Card / set / game does not exist                             |
| 429    | `RateLimitError`       | Daily quota or burst limit exceeded                          |
| 5xx    | `TcgLookupError`       | Upstream error                                               |

All of them extend `TcgLookupError` and expose `.status`, `.url`, `.body`, and `.message`.

```ts
import { TcgLookupClient, RateLimitError } from "tcglookup";

try {
  await tcg.cards.search({ q: "pikachu" });
} catch (err) {
  if (err instanceof RateLimitError) {
    console.log("Slow down. Backend says:", err.message);
  } else {
    throw err;
  }
}
```

## Supported games

| Slug         | Game                    |
|--------------|-------------------------|
| `pokemon`    | Pokémon (English)       |
| `pokemon-jp` | Pokémon Japan           |
| `mtg`        | Magic: The Gathering    |
| `yugioh`     | Yu-Gi-Oh!               |
| `onepiece`   | One Piece Card Game     |
| `lorcana`    | Disney Lorcana          |
| `swu`        | Star Wars: Unlimited    |
| `fab`        | Flesh and Blood         |

## Plan tiers

The Free tier returns **raw TCGPlayer prices only**. The `ebay` price block, `graded` price block, and the `cards.history()` endpoint require the **Trader** plan or above. The SDK surfaces this as a `PlanAccessError` (HTTP 403) so you can branch in code.

See <https://tcgpricelookup.com/pricing> for current quotas.

## API reference

The full HTTP API reference, parameters, and response shapes live at <https://tcgpricelookup.com/docs/api-reference>.

## License

MIT © TCG Price Lookup
