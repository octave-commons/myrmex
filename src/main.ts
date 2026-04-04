import { Myrmex } from "./Myrmex.js";

function env(key: string, fallback?: string): string {
  const val = process.env[key];
  if (val === undefined && fallback === undefined) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
  return val ?? fallback ?? "";
}

async function main() {
  const seedUrls = (env("SEED_URLS", "") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const openPlannerBaseUrl = env("OPENPLANNER_BASE_URL", "http://localhost:7777");
  const openPlannerApiKey = env("OPENPLANNER_API_KEY", "change-me");
  const proxxBaseUrl = env("PROXX_BASE_URL", "");
  const proxxAuthToken = env("PROXX_AUTH_TOKEN", "");

  const myrmex = new Myrmex({
    shuvCrawlBaseUrl: env("SHUVCRAWL_BASE_URL", "http://localhost:3777"),
    shuvCrawlToken: env("SHUVCRAWL_TOKEN"),
    proxxBaseUrl,
    proxxAuthToken,
    openPlannerBaseUrl,
    openPlannerApiKey,
    project: env("MYRMEX_PROJECT", "knoxx-graph"),
    source: env("MYRMEX_SOURCE", "myrmex"),
    ants: parseInt(env("MYRMEX_ANTS", "4"), 10),
    dispatchIntervalMs: parseInt(env("MYRMEX_DISPATCH_INTERVAL_MS", "15000"), 10),
    maxFrontier: parseInt(env("MYRMEX_MAX_FRONTIER", "20000"), 10),
  });

  myrmex.onEvent((ev) => {
    if (ev.type === "page") {
      console.log(`[myrmex] page: ${ev.url} (${ev.title || "no title"}) [${ev.outgoing.length} links]`);
    } else if (ev.type === "error") {
      console.error(`[myrmex] error: ${ev.url} - ${ev.message}`);
    } else if (ev.type === "checkpoint") {
      console.log(`[myrmex] checkpoint: ${ev.nodeCount} nodes, ${ev.frontierSize} frontier`);
    }
  });

  if (seedUrls.length > 0) {
    console.log(`[myrmex] seeding ${seedUrls.length} URLs`);
    myrmex.seed(seedUrls);
  }

  console.log("[myrmex] starting...");
  await myrmex.start();

  // Log stats every 30s
  setInterval(() => {
    const s = myrmex.stats();
    console.log(`[myrmex] stats: running=${s.running} paused=${s.paused} frontier=${s.frontierSize} inFlight=${s.inFlight} pages=${s.pageCount} errors=${s.errorCount}`);
  }, 30_000);

  // Graceful shutdown
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      console.log(`[myrmex] received ${sig}, stopping...`);
      myrmex.stop();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error("[myrmex] fatal:", err);
  process.exit(1);
});
