export type MyrmexPageEvent = {
  type: "page";
  url: string;
  title: string;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  outgoing: string[];
  graphNodeId: string;
  fetchedAt: number;
};

export type MyrmexErrorEvent = {
  type: "error";
  url: string;
  message: string;
  fetchedAt: number;
};

export type MyrmexCheckpointEvent = {
  type: "checkpoint";
  frontierSize: number;
  nodeCount: number;
  edgeCount: number;
  savedAt: number;
};

export type MyrmexEvent = MyrmexPageEvent | MyrmexErrorEvent | MyrmexCheckpointEvent;

export interface MyrmexStats {
  running: boolean;
  paused: boolean;
  frontierSize: number;
  inFlight: number;
  pageCount: number;
  errorCount: number;
  lastCheckpointAt: number;
}

export interface MyrmexConfig {
  ants?: number;
  dispatchIntervalMs?: number;
  maxFrontier?: number;
  alpha?: number;
  beta?: number;
  evaporation?: number;

  shuvCrawlBaseUrl: string;
  shuvCrawlToken?: string;

  proxxBaseUrl: string;
  proxxAuthToken: string;

  openPlannerBaseUrl?: string;
  openPlannerApiKey?: string;

  project?: string;
  source?: string;

  includePatterns?: string[];
  excludePatterns?: string[];
  maxContentLength?: number;
  allowedContentTypes?: string[];

  checkpointIntervalMs?: number;
  graphStoreUrl?: string;
}
