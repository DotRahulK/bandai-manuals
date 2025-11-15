#!/usr/bin/env node
import 'dotenv/config';
import { withClient } from '../db.js';
import { createClient } from '@supabase/supabase-js';

async function checkSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, reason: 'missing SUPABASE_URL/KEY' };
  try {
    const sb = createClient(url, key, { db: { schema: 'bandai' } });
    const { data, error, count } = await sb.from('manuals').select('manual_id', { count: 'exact', head: true });
    if (error) return { ok: false, reason: error.message };
    return { ok: true, backend: 'supabase', count: count ?? null };
  } catch (e: any) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

async function checkPg() {
  try {
    const res = await withClient((c) => c.query('SELECT COUNT(*)::int AS n FROM bandai.manuals'));
    const n = res.rows?.[0]?.n ?? null;
    return { ok: true, backend: 'pg', count: n };
  } catch (e: any) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

async function main() {
  const forceSb = process.env.USE_SUPABASE_JS === '1' || process.env.FORCE_SUPABASE === '1';
  const haveSbCreds = Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY));
  const trySbFirst = forceSb || haveSbCreds;

  const sb = await checkSupabase();
  const pg = await checkPg();

  const chosen = trySbFirst && sb.ok ? sb : pg.ok ? pg : sb.ok ? sb : pg;
  console.log('[bot:health]', JSON.stringify({ chosen, supabase: sb, pg }, null, 2));
}

main().catch((e) => {
  console.error('[bot:health] failed', e);
  process.exit(1);
});

