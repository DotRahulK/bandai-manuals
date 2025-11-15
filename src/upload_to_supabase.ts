#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { withClient } from './db.js';
import { absFromRel, filesRoot } from './paths.js';
import pLimit from 'p-limit';
import { sanitizeStorageKeyPart } from './utils.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = process.env.SUPABASE_BUCKET || 'manuals';
const PREFIX = process.env.SUPABASE_PREFIX || '';
const CONCURRENCY = parseInt(process.env.UPLOAD_CONCURRENCY || '2', 10);
const OVERWRITE = (process.env.OVERWRITE || '0') === '1';
const DRY_RUN = (process.env.DRY_RUN || '0') === '1';

function validateSupabaseEnv() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[supabase:upload] Missing SUPABASE_URL or SUPABASE_KEY in env');
    process.exit(1);
  }
  try {
    const u = new URL(SUPABASE_URL);
    if (!/^https?:$/.test(u.protocol)) throw new Error('URL must start with http(s)://');
  } catch (e) {
    console.error(`[supabase:upload] Invalid SUPABASE_URL: ${SUPABASE_URL}`);
    console.error('Hint: use the Project URL from Supabase Settings → API, e.g. https://<ref>.supabase.co');
    process.exit(1);
  }
}

validateSupabaseEnv();

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function ensureBucketPublic(name: string) {
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) {
    if ((listErr as any)?.message?.includes('searchParams')) {
      console.error('[supabase:upload] Supabase client error while listing buckets (check SUPABASE_URL).');
    }
    throw listErr;
  }
  const existing = (buckets || []).find((b) => b.name === name);
  if (!existing) {
    const { error } = await supabase.storage.createBucket(name, { public: true });
    if (error) throw error;
    console.log(`[supabase:upload] created bucket ${name} (public)`);
  } else if (!existing.public) {
    // No direct API to flip to public in v2; inform user if not public
    console.warn(`[supabase:upload] Bucket ${name} exists but is not public. Public URLs may not work.`);
  }
}

type Row = {
  manual_id: number;
  name_en: string | null;
  name_jp: string | null;
  pdf_local_path: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  storage_public_url: string | null;
};

async function selectRows(limit?: number): Promise<Row[]> {
  const sql = `
    SELECT manual_id, name_en, name_jp, pdf_local_path, storage_bucket, storage_path, storage_public_url
    FROM bandai.manuals
    WHERE pdf_local_path IS NOT NULL
    ORDER BY manual_id ASC
    ${limit ? `LIMIT ${Number(limit)}` : ''}
  `;
  const res = await withClient((c) => c.query(sql));
  return res.rows as Row[];
}

function buildObjectPath(r: Row): string {
  const baseName = `${r.manual_id}-${(r.name_en || r.name_jp || 'manual')
    .replace(/[\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()}.pdf`;
  return (PREFIX ? `${PREFIX.replace(/\/+$/, '')}/` : '') + baseName;
}

async function uploadOne(r: Row) {
  if (!r.pdf_local_path) return { skipped: true };
  const abs = absFromRel(r.pdf_local_path);
  if (!fs.existsSync(abs)) return { skipped: true, reason: 'missing local file' };
  const op = r.storage_path || (() => {
    const safe = sanitizeStorageKeyPart(r.name_en || r.name_jp || 'manual');
    const baseName = `${r.manual_id}-${safe}.pdf`;
    return (PREFIX ? `${PREFIX.replace(/\/+$/, '')}/` : '') + baseName;
  })();
  const objectPath = op.replace(/[\[\]\(\)]/g, '-');
  const bucket = r.storage_bucket || BUCKET;

  if (DRY_RUN) {
    console.log(`[dry] would upload ${abs} -> ${bucket}/${objectPath}`);
    return { skipped: true };
  }

  const fileBuf = fs.readFileSync(abs);
  const exists = !!r.storage_public_url;
  if (exists && !OVERWRITE) {
    return { skipped: true, reason: 'already uploaded' };
  }

  const { error } = await supabase.storage.from(bucket).upload(objectPath, fileBuf, {
    upsert: OVERWRITE,
    contentType: 'application/pdf'
  });
  if (error && error.message && !OVERWRITE && error.message.includes('already exists')) {
    // Treat as ok when not overwriting
  } else if (error) {
    throw error;
  }

  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  const publicUrl = pub?.publicUrl || null;
  const size = fileBuf.byteLength;

  await withClient((c) =>
    c.query(
      `UPDATE bandai.manuals SET storage_bucket=$2, storage_path=$3, storage_public_url=$4, storage_size_bytes=$5, storage_uploaded_at=now(), updated_at=now() WHERE manual_id=$1`,
      [r.manual_id, bucket, objectPath, publicUrl, size]
    )
  );
  return { uploaded: true, bucket, objectPath };
}

async function main() {
  await ensureBucketPublic(BUCKET);
  const rows = await selectRows(process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : undefined);
  console.log(`[supabase:upload] candidates: ${rows.length} -> bucket ${BUCKET}`);
  const limit = pLimit(CONCURRENCY);
  let done = 0;
  let uploaded = 0;
  await Promise.all(
    rows.map((r) =>
      limit(async () => {
        try {
          const res = await uploadOne(r);
          if ((res as any).uploaded) uploaded++;
        } catch (e) {
          console.warn(`[supabase:upload] fail ${r.manual_id}`, e);
        } finally {
          done++;
          if (done % 10 === 0) console.log(`[supabase:upload] ${done}/${rows.length}`);
        }
      })
    )
  );
  console.log(`[supabase:upload] uploaded: ${uploaded}/${rows.length}`);
}

main().catch((e) => {
  console.error('[supabase:upload] failed:', e);
  process.exit(1);
});
