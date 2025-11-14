import * as cheerio from 'cheerio';
import { HttpClient } from './http.js';
import { ensureAbsoluteUrl, matchesAny, matchesNone } from './utils.js';
import { CrawlConfig, CrawlResult } from './types.js';

export class Crawler {
  private http: HttpClient;
  private cfg: Required<CrawlConfig>;

  constructor(cfg: CrawlConfig) {
    this.cfg = {
      baseUrl: cfg.baseUrl,
      hostAllowlist: cfg.hostAllowlist ?? [new URL(cfg.baseUrl).host],
      includePathPatterns: cfg.includePathPatterns ?? [/manual/i, /item/i, /catalog/i, /pdf$/i],
      excludePathPatterns: cfg.excludePathPatterns ?? [/\.(jpg|jpeg|png|gif|svg|webp)$/i],
      maxPages: cfg.maxPages ?? 250,
      concurrency: cfg.concurrency ?? 4,
      delayMs: cfg.delayMs ?? 300,
      userAgent: cfg.userAgent ?? 'bandai-manuals-scraper/0.1 (+github.com/openai/codex-cli)',
      timeoutMs: cfg.timeoutMs ?? 30000
    } as Required<CrawlConfig>;

    this.http = new HttpClient({
      userAgent: this.cfg.userAgent,
      timeoutMs: this.cfg.timeoutMs,
      delayMs: this.cfg.delayMs,
      concurrency: this.cfg.concurrency
    });
  }

  async crawl(): Promise<CrawlResult> {
    const q: string[] = [this.cfg.baseUrl];
    const seen = new Set<string>();
    const all = new Set<string>();
    const manualPages = new Set<string>();
    const pdfs = new Set<string>();

    while (q.length && seen.size < this.cfg.maxPages) {
      const url = q.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);

      let html: string;
      try {
        html = await this.http.html(url);
      } catch (err) {
        continue; // skip failures, keep crawling
      }

      const $ = cheerio.load(html);

      // collect pdfs on page
      $('a[href$=".pdf"]').each((_, a) => {
        const abs = ensureAbsoluteUrl(url, $(a).attr('href'));
        if (!abs) return;
        const u = safeUrl(abs);
        if (!u) return;
        if (this.cfg.hostAllowlist.includes(u.host)) {
          pdfs.add(u.toString());
          manualPages.add(url);
        } else if (abs.endsWith('.pdf')) {
          // allow absolute pdfs even on CDN
          pdfs.add(abs);
          manualPages.add(url);
        }
      });

      // discover next links
      const nextLinks: string[] = [];
      $('a[href]').each((_, a) => {
        const abs = ensureAbsoluteUrl(url, $(a).attr('href'));
        if (!abs) return;
        const u = safeUrl(abs);
        if (!u) return;
        if (!this.cfg.hostAllowlist.includes(u.host)) return; // stay in-domain
        const href = u.pathname + (u.search || '');
        if (!matchesAny(href, this.cfg.includePathPatterns)) return;
        if (!matchesNone(href, this.cfg.excludePathPatterns)) return;
        nextLinks.push(u.toString());
      });

      for (const n of nextLinks) {
        if (!seen.has(n)) q.push(n);
      }

      for (const n of nextLinks) all.add(n);
    }

    return {
      visitedCount: seen.size,
      discovered: Array.from(all).sort(),
      manualPages: Array.from(manualPages).sort(),
      pdfs: Array.from(pdfs).sort()
    };
  }
}

function safeUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

