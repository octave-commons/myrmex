import type { MyrmexPageEvent } from "./types.js";
import { createHash } from "node:crypto";

export interface GraphStoreConfig {
  openPlannerBaseUrl?: string;
  openPlannerApiKey?: string;
  proxxBaseUrl: string;
  authToken: string;
  project?: string;
  source?: string;
}

export class GraphStore {
  private readonly config: GraphStoreConfig;

  constructor(config: GraphStoreConfig) {
    this.config = config;
  }

  async storeNode(event: MyrmexPageEvent): Promise<void> {
    const ts = new Date(event.fetchedAt).toISOString();
    const body = {
      events: [
        {
          schema: "openplanner.event.v1" as const,
          id: `graph.node:${stableHash(event.url)}`,
          ts,
          source: this.config.source ?? "myrmex",
          kind: "graph.node",
          source_ref: {
            project: this.config.project ?? "knoxx-graph",
            session: safeHost(event.url),
            message: event.graphNodeId,
          },
          text: event.content,
          meta: {
            author: "myrmex",
            tags: ["graph", "myrmex", "web"],
          },
          extra: {
            url: event.url,
            title: event.title,
            contentHash: event.contentHash,
            metadata: event.metadata,
            discoveredAt: ts,
            lastVisitedAt: ts,
            visitCount: 1,
            pheromone: 0.5,
            outgoingCount: event.outgoing.length,
          },
        },
      ],
    };
    await this.post(this.eventsPath(), body);
  }

  async storeEdge(source: string, target: string): Promise<void> {
    const ts = new Date().toISOString();
    const body = {
      events: [
        {
          schema: "openplanner.event.v1" as const,
          id: `graph.edge:${stableHash(`${source}\n${target}`)}`,
          ts,
          source: this.config.source ?? "myrmex",
          kind: "graph.edge",
          source_ref: {
            project: this.config.project ?? "knoxx-graph",
            session: safeHost(source),
            message: `edge:${stableHash(`${source}\n${target}`)}`,
          },
          text: `${source} -> ${target}`,
          meta: {
            author: "myrmex",
            tags: ["graph", "myrmex", "edge"],
          },
          extra: {
            source,
            target,
            discoveredAt: ts,
          },
        },
      ],
    };
    await this.post(this.eventsPath(), body);
  }

  private async post(path: string, body: unknown): Promise<void> {
    const baseUrl = this.baseUrl();
    const authToken = this.authToken();
    if (!baseUrl) {
      throw new Error("GraphStore requires OPENPLANNER_BASE_URL or PROXX_BASE_URL");
    }
    await fetch(baseUrl + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(body),
    });
  }

  private baseUrl(): string {
    const openPlannerBaseUrl = (this.config.openPlannerBaseUrl ?? "").replace(/\/+$/, "");
    if (openPlannerBaseUrl) return openPlannerBaseUrl;
    return this.config.proxxBaseUrl.replace(/\/+$/, "");
  }

  private authToken(): string {
    const openPlannerApiKey = (this.config.openPlannerApiKey ?? "").trim();
    if (openPlannerApiKey) return openPlannerApiKey;
    return this.config.authToken;
  }

  private eventsPath(): string {
    return (this.config.openPlannerBaseUrl ?? "").trim() ? "/v1/events" : "/api/v1/lake/events";
  }
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeHost(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "graph";
  }
}
