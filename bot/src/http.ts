import got, { Response } from 'got';
import fs from 'node:fs';
import path from 'node:path';
import pLimit from 'p-limit';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class HttpClient {
  private client = got.extend({ followRedirect: true, retry: { limit: 2 }, timeout: { request: 30000 } });
  private limit: ReturnType<typeof pLimit>;
  private delayMs: number;
  constructor(opts: { userAgent?: string; timeoutMs?: number; delayMs?: number; concurrency?: number } = {}) {
    const { userAgent, timeoutMs, delayMs, concurrency } = opts;
    this.client = this.client.extend({
      headers: userAgent ? { 'user-agent': userAgent } : undefined,
      timeout: timeoutMs ? { request: timeoutMs } : undefined
    });
    this.limit = pLimit(Math.max(1, concurrency ?? 4));
    this.delayMs = Math.max(0, delayMs ?? 0);
  }
  async head(url: string): Promise<{ url: string; statusCode: number; headers: Record<string, any> }> {
    return this.limit(async () => {
      if (this.delayMs) await sleep(this.delayMs);
      const res = await this.client.head(url);
      return { url: res.url, statusCode: res.statusCode, headers: res.headers };
    });
  }
  async download(url: string, outDir: string, filename: string): Promise<string> {
    return this.limit(async () => {
      if (this.delayMs) await sleep(this.delayMs);
      await fs.promises.mkdir(outDir, { recursive: true });
      const outPath = path.join(outDir, filename);
      const stream = this.client.stream(url);
      const ws = fs.createWriteStream(outPath);
      await new Promise<void>((resolve, reject) => {
        stream.on('error', reject);
        ws.on('error', reject);
        ws.on('finish', () => resolve());
        stream.pipe(ws);
      });
      return outPath;
    });
  }
}

