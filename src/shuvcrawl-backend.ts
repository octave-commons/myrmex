import type { FetchBackend, FetchResult } from "./fetch-backend.js";
import { ShuvCrawlClient } from "./shuvcrawl-client.js";

export class ShuvCrawlFetchBackend implements FetchBackend {
  private readonly client: ShuvCrawlClient;

  constructor(client: ShuvCrawlClient) {
    this.client = client;
  }

  async fetch(url: string): Promise<FetchResult> {
    try {
      const result = await this.client.scrape(url, {
        onlyMainContent: true,
        wait: "networkidle",
      });

      return {
        url: result.url,
        status: 200,
        contentType: "text/html",
        html: result.html,
        content: result.content,
        title: result.metadata.title,
        metadata: {
          author: result.metadata.author,
          publishedAt: result.metadata.publishedAt,
          bypassMethod: result.metadata.bypassMethod,
          elapsed: result.metadata.elapsed,
        },
        outgoing: result.links ?? [],
      };
    } catch (err) {
      return {
        url,
        status: 0,
        contentType: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async discoverLinks(url: string): Promise<string[]> {
    try {
      const result = await this.client.map(url);
      return result.links ?? [];
    } catch {
      return [];
    }
  }
}
