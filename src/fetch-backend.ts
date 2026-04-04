export interface FetchResult {
  url: string;
  status: number;
  contentType: string;
  html?: string;
  content?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  outgoing?: string[];
  error?: string;
}

export interface FetchBackend {
  fetch(url: string, options?: {
    signal?: AbortSignal;
    timeout?: number;
    userAgent?: string;
  }): Promise<FetchResult>;

  discoverLinks?(url: string, options?: {
    signal?: AbortSignal;
    timeout?: number;
  }): Promise<string[]>;
}
