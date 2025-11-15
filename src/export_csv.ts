#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { withClient } from './db.js';

const OUT_DIR = process.env.CSV_OUT_DIR || 'exports';
const OUT_FILE = process.env.CSV_OUT_FILE || 'manuals.csv';
const BATCH = parseInt(process.env.CSV_BATCH || '1000', 10);

// Column order for CSV
const COLS = [
  'manual_id',
  'detail_path',
  'detail_url',
  'pdf_url',
  'pdf_local_path',
  'name_jp',
  'name_en',
  'grade',
  'release_date',
  'release_date_text',
  'image_url',
  'storage_bucket',
  'storage_path',
  'storage_public_url',
  'storage_size_bytes',
  'storage_uploaded_at',
  'created_at',
  'updated_at'
] as const;

type Row = Record<(typeof COLS)[number], any>;

function csvEscape(value: any): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (value instanceof Date) {
    // ISO 8601 without milliseconds for readability
    s = value.toISOString();
  } else {
    s = String(value);
  }
  const needsQuotes = /[",\n\r]/.test(s);
  if (needsQuotes) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

async function fetchBatch(afterId: number | null, limit: number): Promise<Row[]> {
  const params: any[] = [];
  let where = '';
  if (afterId !== null) {
    params.push(afterId);
    where = 'WHERE manual_id > $1';
  }
  params.push(limit);
  const sql = `
    SELECT ${COLS.join(', ')}
    FROM bandai.manuals
    ${where}
    ORDER BY manual_id ASC
    LIMIT $${params.length}
  `;
  const res = await withClient((c) => c.query(sql, params));
  return res.rows as Row[];
}

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, OUT_FILE);
  const stream = fs.createWriteStream(outPath, { encoding: 'utf8' });
  // Write header
  stream.write(COLS.join(',') + '\n');

  let afterId: number | null = null;
  let total = 0;
  for (;;) {
    const rows = await fetchBatch(afterId, BATCH);
    if (rows.length === 0) break;
    for (const r of rows) {
      const line = COLS.map((k) => csvEscape((r as any)[k])).join(',');
      stream.write(line + '\n');
      afterId = r.manual_id as number;
      total++;
    }
  }

  await new Promise<void>((res) => stream.end(res));
  console.log(`[export:csv] wrote ${total} rows to ${outPath}`);
}

main().catch((e) => {
  console.error('[export:csv] failed:', e);
  process.exit(1);
});

