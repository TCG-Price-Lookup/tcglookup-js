#!/usr/bin/env node
/**
 * Smoke test against the live TCG Price Lookup API.
 *
 * Usage:
 *   TCG_API_KEY=tcg_xxx node scripts/smoke.mjs
 *
 * Optional:
 *   TCG_BASE_URL=http://localhost:8787/v1   # point at a local backend
 *
 * The API key is read from the environment ONLY. Never commit it.
 */
import { TcgLookupClient, TcgLookupError } from "../dist/index.js";

const apiKey = process.env.TCG_API_KEY;
if (!apiKey) {
  console.error("✖ TCG_API_KEY env var is required");
  process.exit(1);
}

// Enable retry-on-429 so the smoke test survives the burst limiter while
// also verifying that the SDK's retry policy works end-to-end against the
// real API.
const client = new TcgLookupClient({
  apiKey,
  baseUrl: process.env.TCG_BASE_URL,
  retry: { attempts: 4, baseDelayMs: 600 },
});

const results = [];
let failed = 0;

async function step(name, fn) {
  const start = Date.now();
  try {
    const value = await fn();
    const ms = Date.now() - start;
    results.push({ name, ok: true, ms, value });
    console.log(`✓ ${name} (${ms}ms)`);
    return value;
  } catch (err) {
    failed++;
    const ms = Date.now() - start;
    if (err instanceof TcgLookupError) {
      results.push({ name, ok: false, ms, error: `${err.name} ${err.status}: ${err.message}` });
      console.log(`✖ ${name} (${ms}ms) — ${err.name} ${err.status}: ${err.message}`);
    } else {
      results.push({ name, ok: false, ms, error: String(err) });
      console.log(`✖ ${name} (${ms}ms) — ${err}`);
    }
    return null;
  }
}

console.log("Smoke test against", process.env.TCG_BASE_URL ?? "production API");
console.log("Key suffix:", apiKey.slice(-6));
console.log();

// 1. List games — should return 8 TCGs
const games = await step("games.list()", () => client.games.list());
if (games) {
  if (games.data.length === 0) throw new Error("games.list returned 0 games");
  console.log(`   ${games.data.length} games · slugs: ${games.data.map((g) => g.slug).join(", ")}`);
}

// 2. List sets for Pokemon
const sets = await step("sets.list({ game: 'pokemon', limit: 3 })", () =>
  client.sets.list({ game: "pokemon", limit: 3 })
);
if (sets) {
  console.log(
    `   total=${sets.total} returned=${sets.data.length}`,
    sets.data[0] ? `· first: ${sets.data[0].name} (${sets.data[0].slug})` : ""
  );
}

// 3. Search for charizard
const search = await step("cards.search({ q: 'charizard', game: 'pokemon', limit: 3 })", () =>
  client.cards.search({ q: "charizard", game: "pokemon", limit: 3 })
);
if (search) {
  console.log(`   total=${search.total} returned=${search.data.length}`);
  for (const c of search.data) {
    const px = c.prices.raw.near_mint?.tcgplayer?.market;
    console.log(`   · ${c.name} [${c.set?.name ?? "?"}] $${px ?? "n/a"}`);
  }
}

// 4. Get card details for the first search hit
let firstCardId = null;
if (search && search.data.length > 0) {
  firstCardId = search.data[0].id;
  const detail = await step(`cards.get('${firstCardId.slice(0, 8)}…')`, () =>
    client.cards.get(firstCardId)
  );
  if (detail) {
    console.log(
      `   ${detail.name} · set=${detail.set.slug} game=${detail.game.slug} image=${detail.image_url ? "yes" : "no"}`
    );
    const conds = Object.keys(detail.prices.raw);
    console.log(`   raw conditions: ${conds.join(", ") || "(none)"}`);
    if (detail.prices.graded) {
      const graders = Object.keys(detail.prices.graded);
      console.log(`   graded: ${graders.join(", ") || "(none)"}`);
    }
  }
}

// 5. Price history for the same card (Trader+ — Free will 403)
if (firstCardId) {
  const history = await step(
    `cards.history('${firstCardId.slice(0, 8)}…', { period: '7d' })`,
    () => client.cards.history(firstCardId, { period: "7d" })
  );
  if (history) {
    console.log(`   ${history.data.length} days · period=${history.period}`);
    if (history.data.length > 0) {
      const day = history.data[0];
      console.log(`   first day=${day.date} price rows=${day.prices.length}`);
    }
  }
}

// 6. Batch lookup auto-chunking (>20 ids forces 2+ requests)
if (search && search.data.length > 0) {
  const ids = Array(25).fill(search.data[0].id); // duplicates are fine for the smoke
  await step(`cards.search({ ids: [25 ids → 2 chunks] })`, async () => {
    const r = await client.cards.search({ ids });
    if (r.data.length === 0) throw new Error("expected at least 1 card from batch lookup");
    return r;
  });
}

console.log();
console.log("Rate limit:", client.rateLimit);
console.log();
console.log(`${results.length - failed}/${results.length} steps passed`);
process.exit(failed > 0 ? 1 : 0);
