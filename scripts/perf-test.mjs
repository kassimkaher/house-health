#!/usr/bin/env node
/**
 * Performance measurement against a running api (see docs/performance.md
 * for methodology). Assumes:
 *   - api is booted with NODE_ENV=test (relaxes the throttler so sustained
 *     load doesn't hit 429s — matches how the repo's own integration tests
 *     run, not a change to production defaults)
 *   - packages/database/prisma/seed-perf-dataset.ts has been run against
 *     the same database (50k+ foods, active 'perf-test' release)
 *   - a verified test user + access token + a few diary entries for today
 *     exist (see docs/performance.md's "reproduce" section for the curl
 *     sequence, or set PERF_ACCESS_TOKEN to skip re-creating one)
 *
 * Usage: node scripts/perf-test.mjs
 * Env:   API_BASE (default http://127.0.0.1:3100), PERF_ACCESS_TOKEN (required
 *        for diary/summary targets — search/detail run regardless)
 */
import autocannon from "autocannon";

const API_BASE = process.env.API_BASE ?? "http://127.0.0.1:3100";
const TOKEN = process.env.PERF_ACCESS_TOKEN ?? "";
const DURATION_SEC = Number(process.env.PERF_DURATION ?? 15);
const CONNECTIONS = Number(process.env.PERF_CONNECTIONS ?? 20);
const TODAY = new Date().toISOString().slice(0, 10);

const SEARCH_QUERIES = [
  { label: "exact Arabic (رز بسمتي)", q: "رز بسمتي" },
  { label: "Iraqi dialect alias (تمن)", q: "تمن" },
  { label: "English prefix (Bas)", q: "Bas" },
  { label: "fuzzy/typo (باسمتي)", q: "باسمتي" },
  { label: "generic filler term (Food)", q: "Food" },
];

function pct(latency, p) {
  return latency[p];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(name, opts) {
  // A short gap before each target avoids connection-churn artifacts
  // between back-to-back autocannon() calls (observed: a target run
  // immediately after several heavy trigram-search bursts showed a
  // spurious multi-second tail that vanished when the same target was
  // measured in isolation — TIME_WAIT/port-reuse noise between runs, not
  // real endpoint latency).
  await sleep(1500);
  const result = await autocannon({
    connections: CONNECTIONS,
    duration: DURATION_SEC,
    ...opts,
  });
  return {
    name,
    rps: result.requests.average,
    p50: pct(result.latency, "p50"),
    // autocannon doesn't expose a plain p95 bucket — p97_5 is the nearest
    // percentile it reports and is used here as a (slightly stricter)
    // stand-in; see docs/performance.md's methodology note.
    p97_5: pct(result.latency, "p97_5"),
    p99: pct(result.latency, "p99"),
    errors: result.errors,
    non2xx: result.non2xx,
    totalRequests: result.requests.total,
  };
}

async function main() {
  // Brief untimed warm-up so the first measured target isn't skewed by
  // connection-pool/JIT cold-start (observed a 5.8s p99 outlier on the
  // very first run before this was added, vs. a steady ~130ms for the
  // same endpoint measured later in the suite).
  console.warn("Warming up...");
  await autocannon({ url: `${API_BASE}/api/v1/foods/search?q=rice`, connections: CONNECTIONS, duration: 3 });
  await autocannon({ url: `${API_BASE}/api/v1/foods/perf-anchor-0`, connections: CONNECTIONS, duration: 3 });

  const results = [];

  for (const { label, q } of SEARCH_QUERIES) {
    results.push(
      await run(`search: ${label}`, {
        url: `${API_BASE}/api/v1/foods/search?q=${encodeURIComponent(q)}&limit=20`,
      }),
    );
  }

  results.push(
    await run("food detail (by slug)", {
      url: `${API_BASE}/api/v1/foods/perf-anchor-0`,
    }),
  );
  results.push(
    await run("food detail (bulk filler, by slug)", {
      url: `${API_BASE}/api/v1/foods/perf-food-25000`,
    }),
  );

  if (TOKEN) {
    const headers = { authorization: `Bearer ${TOKEN}` };
    results.push(
      await run("diary day summary (/diary/day/:date)", {
        url: `${API_BASE}/api/v1/diary/day/${TODAY}`,
        headers,
      }),
    );
    results.push(
      await run("nutrition summary (/summary/daily/:date)", {
        url: `${API_BASE}/api/v1/summary/daily/${TODAY}`,
        headers,
      }),
    );
  } else {
    console.warn("PERF_ACCESS_TOKEN not set — skipping diary/summary targets");
  }

  console.log("\n" + "=".repeat(100));
  console.log(
    "target".padEnd(45) + "rps".padStart(8) + "p50ms".padStart(9) + "p97.5ms".padStart(9) +
      "p99ms".padStart(9) + "errors".padStart(9) + "non2xx".padStart(9),
  );
  console.log("-".repeat(100));
  for (const r of results) {
    console.log(
      r.name.padEnd(45) +
        r.rps.toFixed(0).padStart(8) +
        String(r.p50).padStart(9) +
        String(r.p97_5).padStart(9) +
        String(r.p99).padStart(9) +
        String(r.errors).padStart(9) +
        String(r.non2xx).padStart(9),
    );
  }
  console.log("=".repeat(100));

  console.log("\nJSON:\n" + JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
