import type { MyrmexPageEvent } from "./types.js";

export interface GraphStoreConfig {
  proxxBaseUrl: string;
  authToken: string;
}

export class GraphStore {
  private readonly config: GraphStoreConfig;

  constructor(config: GraphStoreConfig) {
    this.config = config;
  }

  async storeNode(event: MyrmexPageEvent): Promise<void> {
    const body = {
      kind: "graph.node",
      timestamp: new Date(event.fetchedAt).toISOString(),
      data: {
        url: event.url,
        title: event.title,
        contentHash: event.contentHash,
        discoveredAt: new Date(event.fetchedAt).toISOString(),
        lastVisitedAt: new Date(event.fetchedAt).toISOString(),
        visitCount: 1,
        pheromone: 0.5,
      },
    };
    await this.post("/api/v1/lake/events", body);
  }

  async storeEdge(source: string, target: string): Promise<void> {
    const body = {
      kind: "graph.edge",
      timestamp: new Date().toISOString(),
      data: {
        source,
        target,
        discoveredAt: new Date().toISOString(),
      },
    };
    await this.post("/api/v1/lake/events", body);
  }

  private async post(path: string, body: unknown): Promise<void> {
    const baseUrl = this.config.proxxBaseUrl.replace(/\/+$/, "");
    await fetch(baseUrl + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.authToken}`,
      },
      body: JSON.stringify(body),
    });
  }
}
