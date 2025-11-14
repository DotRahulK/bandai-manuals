#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pLimit from 'p-limit';
import { withClient, endPool } from './db.js';
import { HttpClient } from './http.js';
import { sanitizeFilename } from './utils.js';
import { filesRoot, absFromRel, relFromAbs, joinFiles } from './paths.js';

type Row = {
  manual_id: number;
  name_en: string | null;
  name_jp: string | null;
  pdf_url: string;
  pdf_local_path: string | null;
};

// Paths are stored in DB relative to FILES_ROOT (default ./downloads)
const SUBDIR = process.env.SUBDIR || 'manuals';
const OUT_DIR = joinFiles(SUBDIR);
const ONLY_MISSING = (process.env.ONLY_MISSING ?? '1') !== '0';
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : undefined;
const GRADE = process.env.GRADE; // e.g. "HG,MG"
const IDS = process.env.IDS; // e.g. "123,456"
const DL_CONCURRENCY = parseInt(process.env.DL_CONCURRENCY || '3', 10);

const http = new HttpClient({
  concurrency: DL_CONCURRENCY,
  delayMs: parseInt(process.env.DELAY_MS || '200', 10),
  timeoutMs: parseInt(process.env.TIMEOUT_MS || '30000', 10),
  userAgent: process.env.USER_AGENT || 'bandai-manuals-scraper/0.2'
});

async function selectRows(): Promise<Row[]> {
  const clauses: string[] = ['pdf_url IS NOT NULL'];
  const params: any[] = [];

  if (ONLY_MISSING) {
    // Use a parameter for empty string to avoid SQL quoting issues
    clauses.push(`(pdf_local_path IS NULL OR pdf_local_path = $${params.length + 1})`);
    params.push('');
  }

  if (GRADE) {
    const grades = GRADE.split(',').map((s) => s.trim()).filter(Boolean);
    if (grades.length) {
      clauses.push(`grade = ANY($${params.length + 1})`);
      params.push(grades);
    }
  }

  if (IDS) {
    const ids = IDS.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));
    if (ids.length) {
      clauses.push(`manual_id = ANY($${params.length + 1})`);
      params.push(ids);
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = LIMIT ? `LIMIT ${LIMIT}` : '';
  const sql = `
    SELECT manual_id, name_en, name_jp, pdf_url, pdf_local_path
    FROM bandai.manuals
    ${where}
    ORDER BY manual_id ASC
    ${limit}
  `;
  const res = await withClient((c) => c.query(sql, params));
  return res.rows as Row[];
}

function expectedOutPath(r: Row): string {
  const base = `${r.manual_id}-${sanitizeFilename(r.name_en || r.name_jp || 'manual')}.pdf`;
  return path.join(OUT_DIR, base);
}

async function ensureDir(filePath: string) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
}

async function setLocalPath(manualId: number, localPath: string) {
  await withClient((c) =>
    c.query('UPDATE bandai.manuals SET pdf_local_path = $2, updated_at = now() WHERE manual_id = $1', [manualId, localPath])
  );
}

async function downloadRow(r: Row): Promise<boolean> {
  const outPath = expectedOutPath(r);
  await ensureDir(outPath);

  // If DB has a path and it exists, skip
  if (r.pdf_local_path) {
    const dbPath = r.pdf_local_path;
    // Prefer interpreting as relative to FILES_ROOT
    const abs1 = absFromRel(dbPath);
    if (fs.existsSync(abs1)) return false;
    // Fallback: legacy absolute or CWD-relative
    const abs2 = path.isAbsolute(dbPath) ? dbPath : path.resolve(dbPath);
    if (fs.existsSync(abs2)) {
      // If within FILES_ROOT, normalize DB to relative now
      const inside = !path.relative(filesRoot(), abs2).startsWith('..');
      if (inside) {
        await setLocalPath(r.manual_id, relFromAbs(abs2));
      }
      return false;
    }
  }

  // If expected path already exists, update DB and skip
  if (fs.existsSync(outPath)) {
    await setLocalPath(r.manual_id, relFromAbs(outPath));
    return false;
  }

  try {
    await http.download(r.pdf_url, path.dirname(outPath), path.basename(outPath));
    await setLocalPath(r.manual_id, relFromAbs(outPath));
    return true;
  } catch (e) {
    console.warn(`[download:db] fail ${r.manual_id}: ${r.pdf_url}`);
    return false;
  }
}

async function main() {
  const rows = await selectRows();
  console.log(`[download:db] candidates: ${rows.length}, out: ${OUT_DIR}`);
  const limit = pLimit(DL_CONCURRENCY);
  let done = 0;
  let changed = 0;
  await Promise.all(
    rows.map((r) =>
      limit(async () => {
        const ok = await downloadRow(r);
        if (ok) changed++;
        done++;
        if (done % 10 === 0 || ok) {
          console.log(`[download:db] ${done}/${rows.length} ${ok ? 'downloaded' : 'ok/skip'} ${r.manual_id}`);
        }
      })
    )
  );
  console.log(`[download:db] downloaded: ${changed}/${rows.length}`);
}

main()
  .catch((e) => {
    console.error('[download:db] failed:', e);
    process.exit(1);
  })
  .finally(() => endPool());
