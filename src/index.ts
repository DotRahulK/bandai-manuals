#!/usr/bin/env node
import path from 'node:path';
import { Crawler } from './crawler.js';
import { HttpClient } from './http.js';
import { ensureDir, readJson, writeJson } from './storage.js';
import { sanitizeFilename, urlBasename } from './utils.js';

const BASE_URL = process.env.BASE_URL || 'https://manual.bandai-hobby.net/';
const DATA_DIR = path.resolve('data');
const OUT_DIR = path.resolve('downloads');
const URLS_FILE = path.join(DATA_DIR, 'discovered.json');
const PDFS_FILE = path.join(DATA_DIR, 'pdfs.json');

type Command = 'crawl' | 'download' | 'help';

async function main() {
  const cmd: Command = (process.argv[2] as Command) || 'help';
  switch (cmd) {
    case 'crawl':
      await runCrawl();
      break;
    case 'download':
      await runDownload();
      break;
    case 'help':
    default:
      printHelp();
  }
}

async function runCrawl() {
  console.log(`[crawl] base: ${BASE_URL}`);
  const crawler = new Crawler({
    baseUrl: BASE_URL,
    includePathPatterns: [/manual/i, /item/i, /catalog/i, /pdf$/i],
    excludePathPatterns: [/\.(jpg|jpeg|png|gif|svg|webp)$/i, /#/, /\bfacebook\b|\btwitter\b/i],
    maxPages: parseInt(process.env.MAX_PAGES || '250', 10),
    concurrency: parseInt(process.env.CONCURRENCY || '4', 10),
    delayMs: parseInt(process.env.DELAY_MS || '300', 10),
    timeoutMs: parseInt(process.env.TIMEOUT_MS || '30000', 10),
    userAgent: process.env.USER_AGENT
  });

  const res = await crawler.crawl();
  ensureDir(DATA_DIR);
  writeJson(URLS_FILE, res.discovered);
  writeJson(PDFS_FILE, res.pdfs);
  console.log(`[crawl] visited: ${res.visitedCount}`);
  console.log(`[crawl] discovered: ${res.discovered.length}`);
  console.log(`[crawl] manual pages: ${res.manualPages.length}`);
  console.log(`[crawl] pdfs: ${res.pdfs.length}`);
  console.log(`[crawl] saved: ${URLS_FILE}, ${PDFS_FILE}`);
}

async function runDownload() {
  const pdfs: string[] = readJson(PDFS_FILE, [] as string[]);
  if (!Array.isArray(pdfs) || pdfs.length === 0) {
    console.log('[download] No PDFs listed. Run `npm run crawl` first.');
    return;
  }

  const http = new HttpClient({
    concurrency: parseInt(process.env.CONCURRENCY || '4', 10),
    delayMs: parseInt(process.env.DELAY_MS || '300', 10),
    userAgent: process.env.USER_AGENT
  });

  console.log(`[download] files: ${pdfs.length}`);
  let ok = 0;
  for (const url of pdfs) {
    const base = sanitizeFilename(urlBasename(url));
    const outDir = OUT_DIR;
    try {
      const outPath = await http.download(url, outDir, base);
      console.log(`[download] ok: ${outPath}`);
      ok++;
    } catch (err) {
      console.warn(`[download] fail: ${url}`);
    }
  }

  console.log(`[download] completed: ${ok}/${pdfs.length}`);
}

function printHelp() {
  console.log('Usage:');
  console.log('  npm run crawl     # Crawl bandai manuals site and list PDFs');
  console.log('  npm run download  # Download PDFs discovered by crawl');
  console.log('Env:');
  console.log('  BASE_URL=https://manual.bandai-hobby.net/');
  console.log('  MAX_PAGES=250 CONCURRENCY=4 DELAY_MS=300 USER_AGENT=...');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

