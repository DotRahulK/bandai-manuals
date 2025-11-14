import got, { Response } from 'got';
import pLimit from 'p-limit';
import fs from 'node:fs';
import path from 'node:path';
import { sleep } from './utils.js';

type HttpOptions = {
  userAgent?: string;
  timeoutMs?: number;
  delayMs?: number;
  concurrency?: number;
};

export class HttpClient {
  private client = got.extend({
    headers: {},
    followRedirect: true,
    retry: { limit: 2 },
    timeout: { request: 30000 }
  });

  private limit: ReturnType<typeof pLimit>;
  private delayMs: number;

  constructor(opts: HttpOptions = {}) {
    const { userAgent, timeoutMs, delayMs, concurrency } = opts;
    this.client = this.client.extend({
      headers: userAgent ? { 'user-agent': userAgent } : undefined,
      timeout: timeoutMs ? { request: timeoutMs } : undefined
    });
    this.limit = pLimit(Math.max(1, concurrency ?? 4));
    this.delayMs = Math.max(0, delayMs ?? 0);
  }

  async html(url: string): Promise<string> {
    return this.limit(async () => {
      if (this.delayMs) await sleep(this.delayMs);
      const res: Response<string> = await this.client.get(url, { responseType: 'text' });
      return res.body;
    });
  }

  async htmlDetailed(url: string): Promise<{ body: string; url: string; statusCode: number }> {
    return this.limit(async () => {
      if (this.delayMs) await sleep(this.delayMs);
      const res: Response<string> = await this.client.get(url, { responseType: 'text' });
      return { body: res.body, url: res.url, statusCode: res.statusCode };
    });
  }

  async head(url: string): Promise<{ url: string; statusCode: number; headers: Record<string, string | string[] | undefined> }> {
    return this.limit(async () => {
      if (this.delayMs) await sleep(this.delayMs);
      const res = await this.client.head(url);
      return { url: res.url, statusCode: res.statusCode, headers: res.headers };
    });
  }

  async download(url: string, outDir: string, filename?: string): Promise<string> {
    return this.limit(async () => {
      if (this.delayMs) await sleep(this.delayMs);
      const stream = this.client.stream(url);
      await fs.promises.mkdir(outDir, { recursive: true });
      const outPath = path.join(outDir, filename ?? basenameFromUrl(url));
      const fileStream = fs.createWriteStream(outPath);
      await new Promise<void>((resolve, reject) => {
        stream.on('error', reject);
        fileStream.on('error', reject);
        fileStream.on('finish', () => resolve());
        stream.pipe(fileStream);
      });
      return outPath;
    });
  }
}

function basenameFromUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const last = u.pathname.split('/').filter(Boolean).pop() || 'file';
    return last;
  } catch {
    return 'file';
  }
}
