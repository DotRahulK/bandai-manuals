#!/usr/bin/env node
import 'dotenv/config';
import pLimit from 'p-limit';
import { createClient } from '@supabase/supabase-js';

type Row = {
  manual_id: number;
  name_en: string | null;
  name_jp: string | null;
  grade: string | null;
};

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('[fix-grades] Missing SUPABASE_URL or SUPABASE_KEY (use service role key).');
    process.exit(1);
  }
  return createClient(url, key, { db: { schema: 'bandai' } });
}

const gradeMap: Array<{ test: (r: Row) => boolean; to: string }> = [
  // Explicit string grades → codes
  { test: (r) => /(\b|^)ENTRY\s*GRADE(\b|$)/i.test(r.grade || ''), to: 'EG' },
  { test: (r) => /(\b|^)MASTER\s+GRADE(\b|$)/i.test(r.grade || ''), to: 'MG' },
  { test: (r) => /(\b|^)HIGH\s+GRADE(\b|$)/i.test(r.grade || ''), to: 'HG' },
  { test: (r) => /(\b|^)REAL\s+GRADE(\b|$)/i.test(r.grade || ''), to: 'RG' },
  { test: (r) => /(\b|^)PERFECT\s+GRADE(\b|$)/i.test(r.grade || ''), to: 'PG' },
  { test: (r) => /(\b|^)FULL\s*MECHANICS(\b|$)/i.test(r.grade || ''), to: 'FM' },
  { test: (r) => /(RE\s*\/?\s*100|RE-100|RE:100)/i.test(r.grade || ''), to: 'RE/100' },
  { test: (r) => /(\b|^)SD\s*CS(\b|$)/i.test(r.grade || ''), to: 'SDCS' },
  // Names imply codes when grade is wrong or missing
  { test: (r) => /(\b|^)ENTRY\s*GRADE(\b|$)/i.test((r.name_en || r.name_jp || '')), to: 'EG' },
  { test: (r) => /(\b|^)MGEX(\b|$)/i.test((r.name_en || r.name_jp || '')), to: 'MGEX' },
  { test: (r) => /(\b|^)MG\s*SD(\b|$)|\bMGSD\b/i.test((r.name_en || r.name_jp || '')), to: 'MGSD' },
  { test: (r) => /(^|[^A-Z0-9])HG([^A-Z0-9]|$)/i.test((r.name_en || r.name_jp || '')), to: 'HG' },
  { test: (r) => /(^|[^A-Z0-9])MG([^A-Z0-9]|$)/i.test((r.name_en || r.name_jp || '')), to: 'MG' },
  { test: (r) => /(^|[^A-Z0-9])RG([^A-Z0-9]|$)/i.test((r.name_en || r.name_jp || '')), to: 'RG' },
  { test: (r) => /(^|[^A-Z0-9])PG([^A-Z0-9]|$)/i.test((r.name_en || r.name_jp || '')), to: 'PG' },
  { test: (r) => /(^|[^A-Z0-9])EG([^A-Z0-9]|$)/i.test((r.name_en || r.name_jp || '')), to: 'EG' }
];

function normalizeGrade(r: Row): string | null {
  const g = (r.grade || '').trim();
  // Priority fixes: MGSD named kits incorrectly marked as MG
  if (/\bMGSD\b|\bMG\s*SD\b/i.test(r.name_en || '') || /\bMGSD\b|\bMG\s*SD\b/i.test(r.name_jp || '')) return 'MGSD';
  for (const m of gradeMap) if (m.test(r)) return m.to;
  // Already a known code
  const code = g.toUpperCase();
  if (['EG', 'HG', 'MG', 'RG', 'PG', 'FM', 'RE/100', 'SD', 'SDCS', 'MGEX', 'MGSD'].includes(code)) return code;
  return g ? code : null;
}

async function main() {
  const APPLY = (process.env.APPLY === '1' || process.env.APPLY === 'true');
  const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : undefined;
  const sb = getClient();
  const { data, error } = await sb
    .from('manuals')
    .select('manual_id, name_en, name_jp, grade')
    .order('manual_id', { ascending: true })
    .limit(LIMIT ?? 10000);
  if (error) throw error;
  const rows = (data as Row[]) || [];

  const updates: Array<{ id: number; from: string | null; to: string }> = [];
  for (const r of rows) {
    const to = normalizeGrade(r);
    if (!to) continue;
    const from = (r.grade || null);
    if ((from || '').toUpperCase() !== to) updates.push({ id: r.manual_id, from, to });
  }

  console.log(`[fix-grades] candidates: ${updates.length}`);
  if (!APPLY) {
    console.log('[fix-grades] dry-run (set APPLY=1 to write). Examples:');
    console.log(updates.slice(0, 20));
    return;
  }

  const limit = pLimit(parseInt(process.env.CONCURRENCY || '4', 10));
  let ok = 0;
  await Promise.all(
    updates.map((u) =>
      limit(async () => {
        const { error: upErr } = await sb.from('manuals').update({ grade: u.to }).eq('manual_id', u.id);
        if (upErr) {
          console.warn('[fix-grades] fail', u, upErr.message);
        } else {
          ok++;
        }
      })
    )
  );
  console.log(`[fix-grades] updated: ${ok}/${updates.length}`);
}

main().catch((e) => {
  console.error('[fix-grades] failed:', e);
  process.exit(1);
});
