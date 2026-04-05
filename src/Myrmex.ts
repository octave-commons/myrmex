import type { MyrmexConfig, MyrmexDiscoveredLink, MyrmexEvent, MyrmexPageEvent, MyrmexStats } from "./types.js";
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
  outgoingLinks?: Array<{
    url: string;
    source?: "page" | "sitemap" | "feed";
    text?: string | null;
    rel?: string | null;
    context?: string | null;
    domPath?: string | null;
    blockSignature?: string | null;
    blockRole?: string | null;
  }>;
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
  private readonly visitedUrls = new Set<string>();
  private running = false;
  private paused = false;
  private pauseReason: string | null = null;
  private managedPauseKey: string | null = null;
  private pageCount = 0;
  private errorCount = 0;
  private lastCheckpointAt = 0;
  private graphWriteChain: Promise<void> = Promise.resolve();
  private pendingGraphWrites = 0;
  private flowControlTimer: NodeJS.Timeout | null = null;

  constructor(config: MyrmexConfig) {
    this.config = {
      ants: config.ants ?? 4,
      dispatchIntervalMs: config.dispatchIntervalMs ?? 15_000,
      maxDispatchBurst: config.maxDispatchBurst ?? Math.max(1, config.maxConcurrency ?? 2),
      maxFrontier: config.maxFrontier ?? 20_000,
      maxConcurrency: config.maxConcurrency ?? 2,
      perHostMinIntervalMs: config.perHostMinIntervalMs ?? 4_000,
      requestTimeoutMs: config.requestTimeoutMs ?? 15_000,
      revisitAfterMs: config.revisitAfterMs ?? 1000 * 60 * 60 * 8,
      alpha: config.alpha ?? 1.2,
      beta: config.beta ?? 3.0,
      evaporation: config.evaporation ?? 0.03,
      deposit: config.deposit ?? 0.35,
      hostBalanceExponent: config.hostBalanceExponent ?? 0.7,
      startupJitterMs: config.startupJitterMs ?? 750,
      shuvCrawlBaseUrl: config.shuvCrawlBaseUrl,
      shuvCrawlToken: config.shuvCrawlToken ?? "",
      proxxBaseUrl: config.proxxBaseUrl,
      proxxAuthToken: config.proxxAuthToken,
      openPlannerBaseUrl: config.openPlannerBaseUrl ?? "",
      openPlannerApiKey: config.openPlannerApiKey ?? "",
      project: config.project ?? "web",
      source: config.source ?? "myrmex",
      includePatterns: config.includePatterns ?? [],
      excludePatterns: config.excludePatterns ?? [],
      maxContentLength: config.maxContentLength ?? 500_000,
      allowedContentTypes: config.allowedContentTypes ?? ["text/html"],
      checkpointIntervalMs: config.checkpointIntervalMs ?? 60_000,
      graphStoreUrl: config.graphStoreUrl ?? "",
      openPlannerMaxPendingWrites: config.openPlannerMaxPendingWrites ?? 8,
      openPlannerResumePendingWrites: config.openPlannerResumePendingWrites ?? 2,
      openPlannerMaxEventsPerWrite: config.openPlannerMaxEventsPerWrite ?? 128,
      openPlannerHealthTimeoutMs: config.openPlannerHealthTimeoutMs ?? 5_000,
      openPlannerWriteTimeoutMs: config.openPlannerWriteTimeoutMs ?? 60_000,
      openPlannerHealthPollMs: config.openPlannerHealthPollMs ?? 2_000,
      openPlannerBackoffBaseMs: config.openPlannerBackoffBaseMs ?? 2_000,
      openPlannerBackoffMaxMs: config.openPlannerBackoffMaxMs ?? 60_000,
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
      openPlannerMaxEventsPerWrite: this.config.openPlannerMaxEventsPerWrite,
      openPlannerHealthTimeoutMs: this.config.openPlannerHealthTimeoutMs,
      openPlannerWriteTimeoutMs: this.config.openPlannerWriteTimeoutMs,
      openPlannerHealthPollMs: this.config.openPlannerHealthPollMs,
      openPlannerBackoffBaseMs: this.config.openPlannerBackoffBaseMs,
      openPlannerBackoffMaxMs: this.config.openPlannerBackoffMaxMs,
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
    this.ensureFlowControlLoop();
    if (!this.paused) {
      this.weaver.start();
    }
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    this.pauseReason = null;
    this.managedPauseKey = null;
    if (this.flowControlTimer) {
      clearInterval(this.flowControlTimer);
      this.flowControlTimer = null;
    }
    if (this.weaver) {
      this.weaver.stop();
    }
  }

  pause(reason = "manual pause"): void {
    this.paused = true;
    this.pauseReason = reason;
    this.managedPauseKey = null;
    if (this.weaver) {
      this.weaver.stop();
    }
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.pauseReason = null;
    this.managedPauseKey = null;
    this.running = true;
    this.ensureFlowControlLoop();
    if (this.weaver) {
      this.weaver.start();
    }
  }

  stats(): MyrmexStats {
    const weaverStats = this.weaver?.stats() ?? { frontier: 0, inFlight: 0 };
    return {
      running: this.running,
      paused: this.paused,
      pauseReason: this.pauseReason ?? undefined,
      frontierSize: weaverStats.frontier,
      inFlight: weaverStats.inFlight,
      pageCount: this.pageCount,
      errorCount: this.errorCount,
      lastCheckpointAt: this.lastCheckpointAt,
      pendingGraphWrites: this.pendingGraphWrites,
      graphBackpressure: this.graphStore.status(),
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
    const backend = new ShuvCrawlFetchBackend(this.shuvCrawl, {
      includePatterns: this.config.includePatterns,
      excludePatterns: this.config.excludePatterns,
    });
    const mod = await import("@workspace/graph-weaver-aco");
    const Ctor = mod.GraphWeaverAco as unknown as new (opts: {
      ants: number;
      dispatchIntervalMs: number;
      maxDispatchBurst: number;
      maxFrontier: number;
      maxConcurrency: number;
      perHostMinIntervalMs: number;
      requestTimeoutMs: number;
      revisitAfterMs: number;
      alpha: number;
      beta: number;
      evaporation: number;
      deposit: number;
      hostBalanceExponent: number;
      startupJitterMs: number;
      fetchBackend: FetchBackend;
    }) => WeaverInstance;

    const weaver = new Ctor({
      ants: this.config.ants,
      dispatchIntervalMs: this.config.dispatchIntervalMs,
      maxDispatchBurst: this.config.maxDispatchBurst,
      maxFrontier: this.config.maxFrontier,
      maxConcurrency: this.config.maxConcurrency,
      perHostMinIntervalMs: this.config.perHostMinIntervalMs,
      requestTimeoutMs: this.config.requestTimeoutMs,
      revisitAfterMs: this.config.revisitAfterMs,
      alpha: this.config.alpha,
      beta: this.config.beta,
      evaporation: this.config.evaporation,
      deposit: this.config.deposit,
      hostBalanceExponent: this.config.hostBalanceExponent,
      startupJitterMs: this.config.startupJitterMs,
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
        this.visitedUrls.add(ev.url);
        const discoveredLinks = this.normalizeDiscoveredLinks(ev);
        const myrmexEvent: MyrmexPageEvent = {
          type: "page",
          url: ev.url,
          title: ev.title ?? "",
          content: ev.content ?? "",
          contentHash: hashString(ev.content ?? ev.url),
          metadata: {
            ...(ev.metadata ?? {}),
            status: ev.status !== undefined && ev.status >= 200 && ev.status < 400 ? "success" : "partial",
          },
          outgoing: discoveredLinks.map((link) => link.url),
          outgoingLinks: discoveredLinks,
          graphNodeId: `node:${ev.url}`,
          fetchedAt: ev.fetchedAt,
        };

        this.enqueueGraphWrite(myrmexEvent, discoveredLinks);
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

  private enqueueGraphWrite(event: MyrmexPageEvent, discoveredLinks: MyrmexDiscoveredLink[]): void {
    this.pendingGraphWrites += 1;
    this.updateFlowControl();

    const runWrite = async () => {
      try {
        await this.graphStore.storePage(event, discoveredLinks);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.errorCount += 1;
        console.error(`[myrmex] graph store write failed for ${event.url}: ${message}`);
        this.emit({
          type: "error",
          url: event.url,
          message: `graph store write failed: ${message}`,
          fetchedAt: event.fetchedAt,
        });
      } finally {
        this.pendingGraphWrites = Math.max(0, this.pendingGraphWrites - 1);
        this.updateFlowControl();
      }
    };

    this.graphWriteChain = this.graphWriteChain.catch(() => undefined).then(runWrite);
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

  private ensureFlowControlLoop(): void {
    if (this.flowControlTimer) return;
    this.flowControlTimer = setInterval(() => this.updateFlowControl(), 1_000);
  }

  private updateFlowControl(): void {
    if (!this.running) return;

    const graphBackpressure = this.graphStore.status();
    const weaverStats = this.weaver?.stats() ?? { frontier: 0, inFlight: 0 };
    const effectivePendingWrites = this.pendingGraphWrites + weaverStats.inFlight;
    const queueSaturated = effectivePendingWrites >= this.config.openPlannerMaxPendingWrites;

    if (graphBackpressure.active) {
      this.enterManagedPause(
        "openplanner-backpressure",
        `OpenPlanner backpressure active: wait=${graphBackpressure.waitMs}ms streak=${graphBackpressure.streak}${graphBackpressure.reason ? ` reason=${graphBackpressure.reason}` : ""}`,
      );
      return;
    }

    if (queueSaturated) {
      this.enterManagedPause(
        "graph-write-queue",
        `Graph write queue saturated: pending=${this.pendingGraphWrites} inFlight=${weaverStats.inFlight} effective=${effectivePendingWrites} limit=${this.config.openPlannerMaxPendingWrites}`,
      );
      return;
    }

    if (this.paused && this.managedPauseKey && this.pendingGraphWrites <= this.config.openPlannerResumePendingWrites) {
      this.leaveManagedPause(
        `OpenPlanner recovered and graph queue drained: pending=${this.pendingGraphWrites} resume<=${this.config.openPlannerResumePendingWrites}`,
      );
    }
  }

  private enterManagedPause(key: string, detail: string): void {
    if (this.paused && this.managedPauseKey === null) {
      return;
    }

    if (this.paused && this.managedPauseKey === key) {
      return;
    }

    this.paused = true;
    this.pauseReason = detail;
    this.managedPauseKey = key;
    console.warn(`[myrmex] pausing crawl: ${detail}`);
    if (this.weaver) {
      this.weaver.stop();
    }
  }

  private leaveManagedPause(detail: string): void {
    if (!this.managedPauseKey) return;
    this.paused = false;
    this.pauseReason = null;
    this.managedPauseKey = null;
    console.warn(`[myrmex] resuming crawl: ${detail}`);
    if (this.weaver) {
      this.weaver.start();
    }
  }

  private isKnownVisited(url: string): boolean {
    return this.visitedUrls.has(url);
  }

  private normalizeDiscoveredLinks(ev: WeaverEvent): MyrmexDiscoveredLink[] {
    const byUrl = new Map<string, MyrmexDiscoveredLink>();

    const push = (raw: {
      url: string;
      source?: "page" | "sitemap" | "feed";
      text?: string | null;
      rel?: string | null;
      context?: string | null;
      domPath?: string | null;
      blockSignature?: string | null;
      blockRole?: string | null;
    }) => {
      const url = String(raw.url ?? "").trim();
      if (!url) return;
      const existing = byUrl.get(url);
      const edgeType = this.isKnownVisited(url) ? "visited_to_visited" : "visited_to_unvisited";
      byUrl.set(url, {
        url,
        edgeType,
        discoveryChannel: raw.source ?? existing?.discoveryChannel,
        anchorText: raw.text ?? existing?.anchorText ?? null,
        anchorContext: raw.context ?? existing?.anchorContext ?? null,
        rel: raw.rel ?? existing?.rel ?? null,
        domPath: raw.domPath ?? existing?.domPath ?? null,
        blockSignature: raw.blockSignature ?? existing?.blockSignature ?? null,
        blockRole: raw.blockRole ?? existing?.blockRole ?? null,
      });
    };

    for (const row of ev.outgoingLinks ?? []) push(row);
    for (const url of ev.outgoing ?? []) push({ url });

    return [...byUrl.values()];
  }
}

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return `sha256:${Math.abs(h).toString(16)}`;
}
