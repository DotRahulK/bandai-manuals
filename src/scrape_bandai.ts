#!/usr/bin/env node
import 'dotenv/config';
import * as cheerio from 'cheerio';
import path from 'node:path';
import fs from 'node:fs';
import pLimit from 'p-limit';
import { HttpClient } from './http.js';
import { sanitizeFilename } from './utils.js';
import { withClient, endPool } from './db.js';
import { filesRoot, joinFiles, relFromAbs } from './paths.js';

const DEFAULT_LIST_URL =
  'https://manual.bandai-hobby.net/?sort=new&categories%5B%5D=1&categories%5B%5D=2&categories%5B%5D=3&categories%5B%5D=4&categories%5B%5D=5&categories%5B%5D=6&categories%5B%5D=7&categories%5B%5D=8&categories%5B%5D=9&categories%5B%5D=10&categories%5B%5D=11&categories%5B%5D=12&categories%5B%5D=14&categories%5B%5D=34&categories%5B%5D=35&categories%5B%5D=67&categories%5B%5D=100&categories%5B%5D=133&categories%5B%5D=166';

// Allow overriding the base list URL via CLI or env
function getCliUrl(): string | undefined {
  const argv = process.argv.slice(2);
  const idxLong = argv.indexOf('--url');
  if (idxLong >= 0 && argv[idxLong + 1]) return argv[idxLong + 1];
  const idxShort = argv.indexOf('-u');
  if (idxShort >= 0 && argv[idxShort + 1]) return argv[idxShort + 1];
  // If first positional arg looks like an URL, accept it
  const first = argv[0];
  if (first && /^(https?:)?\/?\//i.test(first)) return first;
  return undefined;
}

const USER_LIST_URL = getCliUrl() || process.env.BASE_LIST_URL;
const LIST_URL = USER_LIST_URL || DEFAULT_LIST_URL;
const LIST_ORIGIN = new URL(LIST_URL).origin;
const DOWNLOAD_FLAG = process.env.DOWNLOAD === '1' || process.env.DOWNLOAD === 'true';
// Paths: store relative to FILES_ROOT (default ./downloads)
const SUBDIR = process.env.SUBDIR || 'manuals';
const OUT_DIR = joinFiles(SUBDIR);
const DL_CONCURRENCY = parseInt(process.env.DL_CONCURRENCY || '3', 10);

const http = new HttpClient({
  concurrency: parseInt(process.env.CONCURRENCY || '4', 10),
  delayMs: parseInt(process.env.DELAY_MS || '250', 10),
  userAgent: process.env.USER_AGENT || 'bandai-manuals-scraper/0.2',
  timeoutMs: parseInt(process.env.TIMEOUT_MS || '30000', 10)
});

function setPageParam(urlStr: string, page: number): string {
  const u = new URL(urlStr);
  u.searchParams.set('page', String(page));
  return u.toString();
}

function normalizeUrl(input: string): string {
  try {
    return new URL(input).toString();
  } catch {
    return input;
  }
}

function absoluteToManualSite(href: string): string {
  return new URL(href, LIST_ORIGIN).toString();
}

function textClean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function inferGrade(nameEn?: string | null, nameJp?: string | null): string | null {
  const src = (nameEn || nameJp || '').trim();
  if (!src) return null;
  const candidates = [
    'PG',
    'MG',
    'RG',
    'HG',
    'EG',
    'SD',
    'FM',
    'RE/100',
    '30MM',
    '30MS',
    'ENTRY GRADE',
    'HGUC',
    'HGBF',
    'HGCE',
    'HGBC'
  ];
  const upper = src.toUpperCase();
  for (const c of candidates) {
    if (upper.startsWith(c)) return c;
  }
  // fallback: first token before space
  const first = upper.split(' ')[0];
  return first || null;
}

function parseReleaseDate(text: string): { date: string | null; raw: string } {
  const raw = textClean(text);
  // Try Japanese format: 2024年11月8日発売 (day optional)
  let m = raw.match(/(\d{4})年\s*(\d{1,2})月(?:\s*(\d{1,2})日)?/);
  if (!m) {
    // Try ISO-like formats
    m = raw.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  }
  if (!m) return { date: null, raw };

  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = m[3] ? parseInt(m[3], 10) : NaN;

  if (!(mo >= 1 && mo <= 12)) return { date: null, raw };
  if (!Number.isNaN(d)) {
    // Validate actual calendar date
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) {
      const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      return { date: iso, raw };
    }
  }
  // No valid or specific day, store null (raw text is preserved separately)
  return { date: null, raw };
}

type Item = {
  manualId: number;
  detailPath: string;
  detailUrl: string;
  pdfUrl: string;
  nameJp: string | null;
  nameEn: string | null;
  grade: string | null;
  releaseDate: string | null; // YYYY-MM-DD or null
  releaseDateText: string | null;
  imageUrl: string | null;
};

async function scrapePage(pageNum: number): Promise<{ items: Item[]; finalPageParam: number | null; zeroItems: boolean }> {
  const url = setPageParam(LIST_URL, pageNum);
  const { body, url: finalUrl } = await http.htmlDetailed(url);
  const finalU = new URL(finalUrl);
  const finalPageParam = finalU.searchParams.get('page');
  const finalPage = finalPageParam ? parseInt(finalPageParam, 10) : null;

  const $ = cheerio.load(body);
  const items: Item[] = [];
  $('div.bl_result_item').each((_, el) => {
    const a = $(el).find('a[href*="/menus/detail/"]').first();
    const href = a.attr('href') || '';
    const detailPath = href;
    const detailUrl = absoluteToManualSite(href);
    const idMatch = href.match(/(\d+)(?:[^\d]|$)/);
    if (!idMatch) return;
    const manualId = parseInt(idMatch[1], 10);
    const pdfUrl = absoluteToManualSite(`/pdf/${manualId}.pdf`);

    const nameNode = $(el).find('.bl_result_name').first().clone();
    const nameEn = textClean($(nameNode).find('.bl_result_name_en').text() || '');
    $(nameNode).find('.bl_result_name_en').remove();
    const nameJp = textClean($(nameNode).text() || '');

    let releaseDateText: string | null = null;
    $(el)
      .find('.bl_result_caption dt')
      .each((__, dt) => {
        const t = textClean($(dt).text());
        if (t.includes('発売日')) {
          releaseDateText = textClean($(dt).next('dd').text() || '');
        }
      });
    const { date: releaseDate } = parseReleaseDate(releaseDateText || '');

    const imageUrl = $(el).find('.bl_result_img img').attr('src');
    const absImageUrl = imageUrl ? absoluteToManualSite(imageUrl) : null;
    const grade = inferGrade(nameEn, nameJp);

    items.push({
      manualId,
      detailPath,
      detailUrl,
      pdfUrl,
      nameJp: nameJp || null,
      nameEn: nameEn || null,
      grade,
      releaseDate,
      releaseDateText: releaseDateText || null,
      imageUrl: absImageUrl
    });
  });

  return { items, finalPageParam: finalPage, zeroItems: items.length === 0 };
}

async function upsertItem(it: Item) {
  await withClient(async (c) => {
    await c.query(
      `INSERT INTO bandai.manuals (
        manual_id, detail_path, detail_url, pdf_url, name_jp, name_en, grade, release_date, release_date_text, image_url
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (manual_id) DO UPDATE SET
        detail_path = EXCLUDED.detail_path,
        detail_url = EXCLUDED.detail_url,
        pdf_url = EXCLUDED.pdf_url,
        name_jp = EXCLUDED.name_jp,
        name_en = EXCLUDED.name_en,
        grade = EXCLUDED.grade,
        release_date = EXCLUDED.release_date,
        release_date_text = EXCLUDED.release_date_text,
        image_url = EXCLUDED.image_url,
        updated_at = now();`,
      [
        it.manualId,
        it.detailPath,
        it.detailUrl,
        it.pdfUrl,
        it.nameJp,
        it.nameEn,
        it.grade,
        it.releaseDate,
        it.releaseDateText,
        it.imageUrl
      ]
    );
  });
}

async function setLocalPath(manualId: number, localPath: string) {
  await withClient((c) =>
    c.query('UPDATE bandai.manuals SET pdf_local_path = $2, updated_at = now() WHERE manual_id = $1', [manualId, localPath])
  );
}

async function downloadIfNeeded(manualId: number, pdfUrl: string, baseName: string): Promise<string | null> {
  const fname = `${sanitizeFilename(baseName)}.pdf`;
  const outPath = path.join(OUT_DIR, fname);
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  if (fs.existsSync(outPath)) return outPath; // skip
  try {
    const saved = await http.download(pdfUrl, path.dirname(outPath), path.basename(outPath));
    return saved;
  } catch (e) {
    console.warn(`[download] failed ${manualId}: ${pdfUrl}`);
    return null;
  }
}

async function main() {
  console.log(`[populate] list: ${normalizeUrl(LIST_URL)}`);
  let page = 1;
  let total = 0;
  const dlLimit = pLimit(DL_CONCURRENCY);

  while (true) {
    const { items, finalPageParam, zeroItems } = await scrapePage(page);
    console.log(`[populate] page ${page} -> items: ${items.length}`);

    if (zeroItems) {
      console.log('[populate] no items found; stopping');
      break;
    }

    // Stop when redirect changes page param unexpectedly (exceeded pagination)
    if (finalPageParam !== null && finalPageParam !== page) {
      console.log(`[populate] redirected to page=${finalPageParam}; stopping at page ${page}`);
      break;
    }

    // DB upserts
    for (const it of items) {
      await upsertItem(it);
    }

    // Optional downloads (in limited parallel)
    if (DOWNLOAD_FLAG) {
      const tasks = items.map((it) =>
        dlLimit(async () => {
      const base = `${it.manualId}-${sanitizeFilename(it.nameEn || it.nameJp || 'manual')}`;
      const saved = await downloadIfNeeded(it.manualId, it.pdfUrl, base);
      if (saved) await setLocalPath(it.manualId, relFromAbs(saved));
        })
      );
      await Promise.all(tasks);
    }

    total += items.length;
    page += 1;
  }

  console.log(`[populate] total items processed: ${total}`);
}

main()
  .catch((e) => {
    console.error('[populate] failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await endPool();
  });
