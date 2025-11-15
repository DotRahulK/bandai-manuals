#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Pool, PoolClient } from 'pg';

type ConnEnv = {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
};

function buildPoolFromEnv(prefix = ''): Pool {
  const env = (name: string) => process.env[(prefix + name).toUpperCase()];
  const connectionString = env('DATABASE_URL');
  if (connectionString) {
    const lower = connectionString.toLowerCase();
    const needsSsl = /sslmode=require/.test(lower) || /@(.*\.)?(supabase\.co|neon\.tech|render\.com)/.test(lower);
    return new Pool({ connectionString, ssl: needsSsl ? { rejectUnauthorized: false } : undefined });
  }
  const host = env('PGHOST') || '127.0.0.1';
  const port = parseInt(env('PGPORT') || '5432', 10);
  const user = env('PGUSER') || 'postgres';
  const password = env('PGPASSWORD') || 'postgres';
  const database = env('PGDATABASE') || 'postgres';
  return new Pool({ host, port, user, password, database, ssl: env('PGSSL') ? { rejectUnauthorized: false } : undefined });
}

async function applyMigrations(target: Pool) {
  const migrationsDir = path.resolve('migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    const c = await target.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('COMMIT');
      console.log(`[supabase:sync] applied migration ${file}`);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
}

type Manual = {
  manual_id: number;
  detail_path: string | null;
  detail_url: string | null;
  pdf_url: string | null;
  pdf_local_path: string | null;
  name_jp: string | null;
  name_en: string | null;
  grade: string | null;
  release_date: Date | string | null;
  release_date_text: string | null;
  image_url: string | null;
  created_at: Date | null;
  updated_at: Date | null;
};

async function fetchBatch(source: Pool, offset: number, limit: number): Promise<Manual[]> {
  const res = await source.query(
    `SELECT manual_id, detail_path, detail_url, pdf_url, pdf_local_path, name_jp, name_en, grade,
            release_date, release_date_text, image_url, created_at, updated_at
     FROM bandai.manuals
     ORDER BY manual_id ASC
     OFFSET $1 LIMIT $2`,
    [offset, limit]
  );
  return res.rows as Manual[];
}

async function upsertBatch(target: Pool, rows: Manual[]) {
  if (rows.length === 0) return;
  const cols = [
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
    'created_at',
    'updated_at'
  ];
  const per = cols.length;
  const values: any[] = [];
  const tuples: string[] = [];
  rows.forEach((r, i) => {
    const base = i * per;
    tuples.push(`(${Array.from({ length: per }, (_, k) => `$${base + k + 1}`).join(',')})`);
    values.push(
      r.manual_id,
      r.detail_path,
      r.detail_url,
      r.pdf_url,
      r.pdf_local_path,
      r.name_jp,
      r.name_en,
      r.grade,
      r.release_date,
      r.release_date_text,
      r.image_url,
      r.created_at,
      r.updated_at
    );
  });
  const sql = `
    INSERT INTO bandai.manuals (${cols.join(',')})
    VALUES ${tuples.join(',')}
    ON CONFLICT (manual_id) DO UPDATE SET
      detail_path = EXCLUDED.detail_path,
      detail_url = EXCLUDED.detail_url,
      pdf_url = EXCLUDED.pdf_url,
      pdf_local_path = EXCLUDED.pdf_local_path,
      name_jp = EXCLUDED.name_jp,
      name_en = EXCLUDED.name_en,
      grade = EXCLUDED.grade,
      release_date = EXCLUDED.release_date,
      release_date_text = EXCLUDED.release_date_text,
      image_url = EXCLUDED.image_url,
      updated_at = now();
  `;
  await target.query(sql, values);
}

async function main() {
  const args = process.argv.slice(2);
  const dataOnly = args.includes('--data-only');
  const batchSize = parseInt(process.env.BATCH_SIZE || '200', 10);

  // Source DB (your current/local DB)
  const source = buildPoolFromEnv('SOURCE_');

  // Target DB (Supabase Postgres)
  const target = buildPoolFromEnv('SUPABASE_');

  if (!dataOnly) {
    console.log('[supabase:sync] applying migrations on target (Supabase)');
    await applyMigrations(target);
  }

  console.log('[supabase:sync] copying data in batches');
  let offset = 0;
  let total = 0;
  while (true) {
    const rows = await fetchBatch(source, offset, batchSize);
    if (rows.length === 0) break;
    await upsertBatch(target, rows);
    total += rows.length;
    offset += rows.length;
    if (total % 500 === 0) console.log(`[supabase:sync] copied ${total} rows`);
  }

  console.log(`[supabase:sync] done. total rows: ${total}`);

  await source.end();
  await target.end();
}

main().catch((e) => {
  console.error('[supabase:sync] failed:', e);
  process.exit(1);
});
