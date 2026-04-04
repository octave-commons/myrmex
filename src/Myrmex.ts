import type { MyrmexConfig, MyrmexEvent, MyrmexStats } from "./types.js";
import type { FetchBackend } from "./fetch-backend.js";
import { ShuvCrawlClient } from "./shuvcrawl-client.js";
import { ShuvCrawlFetchBackend } from "./shuvcrawl-backend.js";
import { GraphStore } from "./graph-store.js";
import { CheckpointManager } from "./checkpoint.js";

type WeaverInstance = {
  seed: (urls: string[]) => void;
  start: () => void;
  stop: () => void;
  stats: () => { frontier: number; inFlight: number };
  onEvent: (cb: (ev: WeaverEvent) => void) => () => void;
};

type WeaverEvent = {
  type: string;
  url: string;
  status?: number;
  contentType?: string;
  fetchedAt: number;
  outgoing?: string[];
  content?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  message?: string;
};

export class Myrmex {
  private readonly config: Required<MyrmexConfig>;
  private readonly shuvCrawl: ShuvCrawlClient;
  private weaver: WeaverInstance | null = null;
  private readonly graphStore: GraphStore;
  private readonly checkpoint: CheckpointManager;
  private readonly listeners = new Set<(ev: MyrmexEvent) => void>();
  private readonly pendingSeeds = new Set<string>();
  private running = false;
  private paused = false;
  private pageCount = 0;
  private errorCount = 0;
  private lastCheckpointAt = 0;

  constructor(config: MyrmexConfig) {
    this.config = {
      ants: config.ants ?? 4,
      dispatchIntervalMs: config.dispatchIntervalMs ?? 15_000,
      maxFrontier: config.maxFrontier ?? 20_000,
      alpha: config.alpha ?? 1.2,
      beta: config.beta ?? 3.0,
      evaporation: config.evaporation ?? 0.03,
      shuvCrawlBaseUrl: config.shuvCrawlBaseUrl,
      shuvCrawlToken: config.shuvCrawlToken ?? "",
      proxxBaseUrl: config.proxxBaseUrl,
      proxxAuthToken: config.proxxAuthToken,
      openPlannerBaseUrl: config.openPlannerBaseUrl ?? "",
      openPlannerApiKey: config.openPlannerApiKey ?? "",
      project: config.project ?? "knoxx-graph",
      source: config.source ?? "myrmex",
      includePatterns: config.includePatterns ?? [],
      excludePatterns: config.excludePatterns ?? [],
      maxContentLength: config.maxContentLength ?? 500_000,
      allowedContentTypes: config.allowedContentTypes ?? ["text/html"],
      checkpointIntervalMs: config.checkpointIntervalMs ?? 60_000,
      graphStoreUrl: config.graphStoreUrl ?? "",
    };

    this.shuvCrawl = new ShuvCrawlClient({
      baseUrl: this.config.shuvCrawlBaseUrl,
      token: this.config.shuvCrawlToken || undefined,
    });

    this.graphStore = new GraphStore({
      openPlannerBaseUrl: this.config.openPlannerBaseUrl,
      openPlannerApiKey: this.config.openPlannerApiKey,
      proxxBaseUrl: this.config.proxxBaseUrl,
      authToken: this.config.proxxAuthToken,
      project: this.config.project,
      source: this.config.source,
    });

    this.checkpoint = new CheckpointManager({
      intervalMs: this.config.checkpointIntervalMs,
    });
  }

  seed(urls: string[]): void {
    for (const url of urls) {
      if (url) {
        this.pendingSeeds.add(url);
      }
    }
    if (this.weaver) {
      this.weaver.seed(urls);
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!this.weaver) {
      this.weaver = await this.createWeaver();
    }
    this.running = true;
    this.paused = false;
    this.weaver.start();
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    if (this.weaver) {
      this.weaver.stop();
    }
  }

  pause(): void {
    this.paused = true;
    if (this.weaver) {
      this.weaver.stop();
    }
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.running = true;
    if (this.weaver) {
      this.weaver.start();
    }
  }

  stats(): MyrmexStats {
    const weaverStats = this.weaver?.stats() ?? { frontier: 0, inFlight: 0 };
    return {
      running: this.running,
      paused: this.paused,
      frontierSize: weaverStats.frontier,
      inFlight: weaverStats.inFlight,
      pageCount: this.pageCount,
      errorCount: this.errorCount,
      lastCheckpointAt: this.lastCheckpointAt,
    };
  }

  async restoreCheckpoint(): Promise<void> {
    // Phase 3: load checkpoint from OpenPlanner or local file
  }

  onEvent(cb: (ev: MyrmexEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private async createWeaver(): Promise<WeaverInstance> {
    const backend = new ShuvCrawlFetchBackend(this.shuvCrawl);
    const mod = await import("@workspace/graph-weaver-aco");
    const Ctor = mod.GraphWeaverAco as unknown as new (opts: {
      ants: number;
      dispatchIntervalMs: number;
      maxFrontier: number;
      alpha: number;
      beta: number;
      evaporation: number;
      fetchBackend: FetchBackend;
    }) => WeaverInstance;

    const weaver = new Ctor({
      ants: this.config.ants,
      dispatchIntervalMs: this.config.dispatchIntervalMs,
      maxFrontier: this.config.maxFrontier,
      alpha: this.config.alpha,
      beta: this.config.beta,
      evaporation: this.config.evaporation,
      fetchBackend: backend,
    });

    this.wireEvents(weaver);
    const seeds = [...this.pendingSeeds];
    if (seeds.length > 0) {
      weaver.seed(seeds);
    }
    return weaver;
  }

  private wireEvents(weaver: WeaverInstance): void {
    weaver.onEvent((ev: WeaverEvent) => {
      if (ev.type === "page") {
        this.pageCount += 1;
        const myrmexEvent: MyrmexEvent = {
          type: "page",
          url: ev.url,
          title: ev.title ?? "",
          content: ev.content ?? "",
          contentHash: hashString(ev.content ?? ev.url),
          metadata: {
            ...(ev.metadata ?? {}),
            status: ev.status !== undefined && ev.status >= 200 && ev.status < 400 ? "success" : "partial",
          },
          outgoing: ev.outgoing ?? [],
          graphNodeId: `node:${ev.url}`,
          fetchedAt: ev.fetchedAt,
        };
        this.graphStore.storeNode(myrmexEvent).catch(() => {});
        for (const target of ev.outgoing ?? []) {
          this.graphStore.storeEdge(ev.url, target).catch(() => {});
        }
        this.emit(myrmexEvent);
        this.maybeCheckpoint();
      } else if (ev.type === "error") {
        this.errorCount += 1;
        const myrmexEvent: MyrmexEvent = {
          type: "error",
          url: ev.url,
          message: ev.message ?? "unknown error",
          fetchedAt: ev.fetchedAt,
        };
        this.emit(myrmexEvent);
      }
    });
  }

  private emit(ev: MyrmexEvent): void {
    for (const cb of this.listeners) {
      try {
        cb(ev);
      } catch {
        // ignore listener errors
      }
    }
  }

  private maybeCheckpoint(): void {
    const now = Date.now();
    if (now - this.lastCheckpointAt >= this.config.checkpointIntervalMs) {
      this.lastCheckpointAt = now;
      const checkpointEvent: MyrmexEvent = {
        type: "checkpoint",
        frontierSize: this.weaver?.stats().frontier ?? 0,
        nodeCount: this.pageCount,
        edgeCount: 0,
        savedAt: now,
      };
      this.checkpoint.save(checkpointEvent).catch(() => {});
      this.emit(checkpointEvent);
    }
  }
}

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return `sha256:${Math.abs(h).toString(16)}`;
}
