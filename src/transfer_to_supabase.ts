#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pLimit from 'p-limit';
import { createClient } from '@supabase/supabase-js';
import { sanitizeStorageKeyPart } from './utils.js';
import { Pool } from 'pg';

// ---- Helpers to build Postgres pools from env ----
function buildPoolFromEnv(prefix = ''): Pool {
  const env = (n: string) => process.env[(prefix + n).toUpperCase()];
  const direct = env('DATABASE_URL');
  if (direct) {
    const lower = direct.toLowerCase();
    const needsSsl = /sslmode=require/.test(lower) || /@(.*\.)?(supabase\.co|neon\.tech|render\.com)/.test(lower);
    return new Pool({ connectionString: direct, ssl: needsSsl ? { rejectUnauthorized: false } : undefined });
  }
  const host = env('PGHOST') || '127.0.0.1';
  const port = parseInt(env('PGPORT') || '5432', 10);
  const user = env('PGUSER') || 'postgres';
  const password = env('PGPASSWORD') || 'postgres';
  const database = env('PGDATABASE') || 'postgres';
  const sslEnabled = Boolean(env('PGSSL'));
  return new Pool({ host, port, user, password, database, ssl: sslEnabled ? { rejectUnauthorized: false } : undefined });
}

// ---- Apply SQL migrations on the target (Supabase) ----
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
      console.log(`[transfer] applied migration ${file}`);
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

// ---- Storage upload ----
function validateSupabaseEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    new URL(url);
  } catch {
    throw new Error(`Invalid SUPABASE_URL: ${url}`);
  }
  return { url, key };
}

type TargetRow = { manual_id: number; name_en: string | null; name_jp: string | null; pdf_local_path: string | null; storage_public_url: string | null };

async function selectTargetRows(target: Pool, limit?: number): Promise<TargetRow[]> {
  const res = await target.query(
    `SELECT manual_id, name_en, name_jp, pdf_local_path, storage_public_url
     FROM bandai.manuals
     WHERE pdf_local_path IS NOT NULL
     ORDER BY manual_id ASC ${limit ? `LIMIT ${Number(limit)}` : ''}`
  );
  return res.rows as TargetRow[];
}

function buildStorageKey(r: TargetRow, prefix?: string): string {
  const safe = sanitizeStorageKeyPart(r.name_en || r.name_jp || 'manual');
  const base = `${r.manual_id}-${safe}.pdf`;
  return prefix ? `${prefix.replace(/\/+$/, '')}/${base}` : base;
}

function buildObjectPath(r: TargetRow, prefix?: string): string {
  const base = `${r.manual_id}-${(r.name_en || r.name_jp || 'manual')
    .replace(/[\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()}.pdf`;
  return prefix ? `${prefix.replace(/\/+$/, '')}/${base}` : base;
}

async function uploadAllToStorage(target: Pool) {
  const cfg = validateSupabaseEnv();
  if (!cfg) {
    console.log('[transfer] Skipping storage upload (SUPABASE_URL/KEY not set)');
    return;
  }
  const bucket = process.env.SUPABASE_BUCKET || 'manuals';
  const prefix = process.env.SUPABASE_PREFIX || '';
  const concurrency = parseInt(process.env.UPLOAD_CONCURRENCY || '2', 10);
  const overwrite = (process.env.OVERWRITE || '0') === '1';
  const supabase = createClient(cfg.url!, cfg.key!);
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) throw listErr;
  if (!buckets?.find((b) => b.name === bucket)) {
    const { error } = await supabase.storage.createBucket(bucket, { public: true });
    if (error) throw error;
    console.log(`[transfer] created bucket ${bucket} (public)`);
  }

  const rows = await selectTargetRows(target);
  const limit = pLimit(concurrency);
  let done = 0;
  let uploaded = 0;
  await Promise.all(
    rows.map((r) =>
      limit(async () => {
        try {
          if (r.storage_public_url && !overwrite) return;
          const local = path.resolve(process.env.FILES_ROOT || 'downloads', r.pdf_local_path!);
          if (!fs.existsSync(local)) return;
          const buf = fs.readFileSync(local);
          const objectPathBase = buildStorageKey(r, prefix);
          const objectPath = objectPathBase.replace(/[\[\]\(\)]/g, '-');
          const { error } = await supabase.storage.from(bucket).upload(objectPath, buf, { upsert: overwrite, contentType: 'application/pdf' });
          if (error && !overwrite && /already exists/i.test(error.message)) {
            // continue
          } else if (error) {
            throw error;
          }
          const { data: pub } = supabase.storage.from(bucket).getPublicUrl(objectPath);
          const publicUrl = pub?.publicUrl || null;
          await target.query(
            `UPDATE bandai.manuals SET storage_bucket=$2, storage_path=$3, storage_public_url=$4, storage_size_bytes=$5, storage_uploaded_at=now(), updated_at=now() WHERE manual_id=$1`,
            [r.manual_id, bucket, objectPath, publicUrl, buf.byteLength]
          );
          uploaded++;
        } catch (e) {
          // log and continue
          console.warn(`[transfer] upload fail ${r.manual_id}`, e);
        } finally {
          done++;
          if (done % 25 === 0) console.log(`[transfer] uploaded ${uploaded}/${done}/${rows.length}`);
        }
      })
    )
  );
  console.log(`[transfer] storage uploaded: ${uploaded}/${rows.length}`);
}

async function main() {
  const args = process.argv.slice(2);
  const noMigrate = args.includes('--data-only');
  const noUpload = args.includes('--no-upload');
  const batchSize = parseInt(process.env.BATCH_SIZE || '200', 10);

  const source = buildPoolFromEnv('SOURCE_');
  const target = buildPoolFromEnv('SUPABASE_');

  if (!noMigrate) {
    console.log('[transfer] applying migrations on target');
    await applyMigrations(target);
  }

  console.log('[transfer] copying data');
  let offset = 0;
  let total = 0;
  while (true) {
    const rows = await fetchBatch(source, offset, batchSize);
    if (rows.length === 0) break;
    await upsertBatch(target, rows);
    total += rows.length;
    offset += rows.length;
    if (total % 500 === 0) console.log(`[transfer] copied ${total}`);
  }
  console.log(`[transfer] copy complete: ${total} rows`);

  if (!noUpload) {
    await uploadAllToStorage(target);
  }

  await source.end();
  await target.end();
}

main().catch((e) => {
  console.error('[transfer] failed:', e);
  process.exit(1);
});
