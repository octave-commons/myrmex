export interface ShuvCrawlScrapeOptions {
  wait?: "load" | "networkidle" | "selector" | "sleep";
  waitFor?: string;
  waitTimeout?: number;
  sleep?: number;
  headers?: Record<string, string>;
  mobile?: boolean;
  rawHtml?: boolean;
  onlyMainContent?: boolean;
}

export interface ShuvCrawlScrapeResult {
  url: string;
  content: string;
  html?: string;
  metadata: {
    requestId: string;
    title?: string;
    bypassMethod?: string;
    status: "success" | "partial" | "failed";
    elapsed: number;
    author?: string;
    publishedAt?: string;
  };
  links?: string[];
}

export interface ShuvCrawlMapResult {
  url: string;
  links: string[];
  sitemaps?: string[];
}

export interface ShuvCrawlClientConfig {
  baseUrl: string;
  token?: string;
  timeout?: number;
}

export class ShuvCrawlClient {
  private readonly config: Required<ShuvCrawlClientConfig>;

  constructor(config: ShuvCrawlClientConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/+$/, ""),
      token: config.token ?? "",
      timeout: config.timeout ?? 60_000,
    };
  }

  async scrape(url: string, options?: ShuvCrawlScrapeOptions): Promise<ShuvCrawlScrapeResult> {
    const res = await this.fetch("/scrape", {
      method: "POST",
      body: JSON.stringify({ url, options: options ?? {} }),
    });
    const json = await res.json() as { success: boolean; data: ShuvCrawlScrapeResult; error?: string };
    if (!json.success) {
      throw new Error(json.error ?? "scrape failed");
    }
    return json.data;
  }

  async map(url: string): Promise<ShuvCrawlMapResult> {
    const res = await this.fetch("/map", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
    const json = await res.json() as { success: boolean; data: ShuvCrawlMapResult; error?: string };
    if (!json.success) {
      throw new Error(json.error ?? "map failed");
    }
    return json.data;
  }

  async health(): Promise<{ ok: boolean; [key: string]: unknown }> {
    const res = await this.fetch("/health");
    return res.json() as Promise<{ ok: boolean; [key: string]: unknown }>;
  }

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(init?.headers as Record<string, string> ?? {}),
    };
    if (this.config.token) {
      headers["authorization"] = `Bearer ${this.config.token}`;
    }
    try {
      return await fetch(this.config.baseUrl + path, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
