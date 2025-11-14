export type CrawlConfig = {
  baseUrl: string;
  hostAllowlist?: string[]; // Hosts allowed to crawl
  includePathPatterns?: (string | RegExp)[]; // Only follow links that match any
  excludePathPatterns?: (string | RegExp)[]; // Skip links that match any
  maxPages?: number; // Hard cap on pages to visit
  concurrency?: number; // parallel fetches
  delayMs?: number; // optional delay between requests
  userAgent?: string;
  timeoutMs?: number;
};

export type CrawlResult = {
  visitedCount: number;
  discovered: string[]; // all discovered URLs (unique)
  manualPages: string[]; // pages that contain PDF links
  pdfs: string[]; // direct PDF URLs discovered
};

export type DownloadJob = {
  url: string;
  outDir: string;
  filename?: string; // optional override, default from URL basename
};

