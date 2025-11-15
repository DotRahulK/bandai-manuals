#!/usr/bin/env tsx
import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { withClient } from '../db.js';

type ManualRow = {
  manual_id: number;
  detail_url: string | null;
  pdf_url: string | null;
  pdf_local_path: string | null;
  name_jp: string | null;
  name_en: string | null;
  grade: string | null;
  release_date: string | null;
  release_date_text: string | null;
  image_url: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  storage_public_url: string | null;
};

function getSbClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_KEY');
  return createClient(url, key, { db: { schema: 'bandai' } });
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.replace(/^--/, '').split('=');
      if (typeof v === 'undefined') {
        // flags like --supabase or --pg
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          out[k] = next;
          i++;
        } else {
          out[k] = true;
        }
      } else {
        out[k] = v;
      }
    } else {
      rest.push(a);
    }
  }
  return { flags: out, rest };
}

function parseGradeFromQuery(q: string): string | null {
  const s = q.toLowerCase();
  const checks: Array<{ re: RegExp; code: string }> = [
    { re: /\bmg\s*ex\b/, code: 'MGEX' },
    { re: /\bmgex\b/, code: 'MGEX' },
    { re: /\bmg\s*sd\b/, code: 'MGSD' },
    { re: /\bmgsd\b/, code: 'MGSD' },
    { re: /\bmaster\s+grade\b/, code: 'MG' },
    { re: /\breal\s+grade\b/, code: 'RG' },
    { re: /\bhigh\s+grade\b/, code: 'HG' },
    { re: /\bentry\s+grade\b/, code: 'EG' },
    { re: /\bre\s*\/?\s*100\b/, code: 'RE/100' },
    { re: /\bfull\s+mechanics\b/, code: 'FM' },
    { re: /\bperfect\s+grade\b/, code: 'PG' },
    { re: /\bsd\s*cs\b/, code: 'SDCS' },
    { re: /\beg\b/, code: 'EG' },
    { re: /\bhg\b/, code: 'HG' },
    { re: /\brg\b/, code: 'RG' },
    { re: /\bmg\b/, code: 'MG' },
    { re: /\bpg\b/, code: 'PG' },
    { re: /\bsdcs\b/, code: 'SDCS' },
    { re: /\bsd\b/, code: 'SD' }
  ];
  for (const c of checks) if (c.re.test(s)) return c.code;
  return null;
}

function gradeSynonyms(code: string): string[] {
  const c = code.toUpperCase();
  switch (c) {
    case 'EG':
      return ['EG', 'ENTRY GRADE', 'ENTRYGRADE'];
    case 'HG':
      return ['HG', 'HIGH GRADE'];
    case 'MG':
      return ['MG', 'MASTER GRADE'];
    case 'RG':
      return ['RG', 'REAL GRADE'];
    case 'PG':
      return ['PG', 'PERFECT GRADE'];
    case 'FM':
      return ['FM', 'FULL MECHANICS', 'FULLMECHANICS'];
    case 'RE/100':
      return ['RE/100', 'RE 100', 'RE-100', 'RE:100'];
    case 'SDCS':
      return ['SDCS', 'SD CS'];
    case 'MGEX':
      return ['MGEX', 'MG EX'];
    case 'MGSD':
      return ['MGSD', 'MG SD'];
    case 'SD':
      return ['SD'];
    default:
      return [c];
  }
}

function containsToken(text: string, token: string): boolean {
  const T = (text || '').toUpperCase();
  const tok = (token || '').toUpperCase();
  if (/^[A-Z]{1,3}$/.test(tok)) {
    const re = new RegExp(`(^|[^A-Z0-9])${tok}([^A-Z0-9]|$)`);
    return re.test(T);
  }
  const noSpaceT = T.replace(/\s+/g, '');
  const noSpaceTok = tok.replace(/\s+/g, '');
  return T.includes(tok) || noSpaceT.includes(noSpaceTok);
}

function matchesGrade(row: ManualRow, code: string): boolean {
  const syns = gradeSynonyms(code);
  const g = (row.grade || '').toUpperCase();
  if (syns.includes(g)) return true;
  const ne = (row.name_en || '');
  const nj = (row.name_jp || '');
  return syns.some((s) => containsToken(ne, s) || containsToken(nj, s));
}

function stripGradeTokens(q: string): string {
  let s = q;
  const reps: Array<RegExp> = [
    /\bentry\s*grade\b/gi,
    /\bhigh\s*grade\b/gi,
    /\bmaster\s*grade\b/gi,
    /\breal\s*grade\b/gi,
    /\bperfect\s*grade\b/gi,
    /\bfull\s*mechanics\b/gi,
    /\bre\s*\/?\s*100\b/gi,
    /\bmg\s*ex\b/gi,
    /\bmg\s*sd\b/gi,
    /\bmgex\b/gi,
    /\bmgsd\b/gi,
    /\beg\b/gi,
    /\bhg\b/gi,
    /\bmg\b/gi,
    /\brg\b/gi,
    /\bpg\b/gi,
    /\bsdcs\b/gi,
    /\bsd\b/gi
  ];
  for (const re of reps) s = s.replace(re, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

async function fetchByGrade(sb: SupabaseClient, code: string, limit = 2000): Promise<ManualRow[]> {
  const syns = gradeSynonyms(code);
  const ors: string[] = [];
  for (const s of syns) {
    const esc = s.replace(/,/g, '');
    ors.push(`grade.ilike.${esc}`);
    ors.push(`name_en.ilike.%${esc}%`);
    ors.push(`name_jp.ilike.%${esc}%`);
  }
  const { data, error } = await sb
    .from('manuals')
    .select(
      'manual_id, detail_url, pdf_url, pdf_local_path, name_jp, name_en, grade, release_date, release_date_text, image_url, storage_bucket, storage_path, storage_public_url'
    )
    .or(ors.join(','))
    .order('release_date', { ascending: false, nullsFirst: true })
    .order('manual_id', { ascending: false })
    .limit(Math.max(1, Math.min(5000, limit)));
  if (error) throw error;
  const rows = (data as ManualRow[]) || [];
  return rows.filter((r) => matchesGrade(r, code));
}

function summarize(r: ManualRow): string {
  const d = r.release_date || '—';
  const nm = r.name_en || r.name_jp || 'Manual';
  return `${r.manual_id} | ${d} | ${r.grade ?? '—'} | ${nm}`;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

async function debugSupabase(q: string, limit = 20) {
  const sb = getSbClient();
  const detected = parseGradeFromQuery(q);
  const qCore = detected ? stripGradeTokens(q) : q;
  const tokens = tokenize(qCore);

  console.log('— supabase debug —');
  console.log('query:', q);
  console.log('detected grade:', detected ?? '(none)');
  console.log('core tokens:', tokens);

  if (detected) {
    const pool = await fetchByGrade(sb, detected, 5000);
    console.log('pool size (grade-filtered):', pool.length);
    console.log('pool sample (top 10):');
    for (const r of pool.slice(0, 10)) console.log('  ', summarize(r));

    let filtered = pool;
    if (tokens.length) {
      const nameOf = (r: ManualRow) => `${r.name_en || ''} ${r.name_jp || ''}`.toLowerCase();
      const scores = pool.map((r) => ({ r, hits: tokens.filter((t) => nameOf(r).includes(t)).length }));
      const allHit = scores.filter((x) => x.hits === tokens.length).map((x) => x.r);
      const anyHit = scores.filter((x) => x.hits > 0).map((x) => x.r);

      console.log('strict(all tokens) count:', allHit.length);
      console.log('any-token count:', anyHit.length);

      filtered = allHit.length ? allHit : anyHit;
    }

    const rows = filtered.slice(0, Math.max(1, Math.min(20, limit)));
    console.log('final suggestions:', rows.length);
    for (const r of rows) console.log('  ', summarize(r));

    // Also show RPC results for comparison
    const { data: rpcRows, error } = await sb.rpc('suggest_manuals', { q: qCore, p_limit: Math.max(1, Math.min(50, limit)) });
    if (!error && Array.isArray(rpcRows)) {
      console.log('rpc suggest_manuals sample (no-grade scorer) — top 10:');
      for (const r of (rpcRows as any[]).slice(0, 10)) {
        const label = r.name_en || r.name_jp || `Manual ${r.manual_id}`;
        console.log(`  ${r.manual_id} | ${r.grade ?? '—'} | score=${r.score} | ${label}`);
      }
    }
    return;
  }

  // No grade detected — use RPC directly
  const { data, error } = await sb.rpc('suggest_manuals', { q: qCore, p_limit: Math.max(1, Math.min(50, limit)) });
  if (error) throw error;
  const rows = (data as any[]) || [];
  console.log('rpc suggestions:', rows.length);
  for (const r of rows) {
    const label = r.name_en || r.name_jp || `Manual ${r.manual_id}`;
    console.log(`  ${r.manual_id} | ${r.grade ?? '—'} | score=${r.score} | ${label}`);
  }
}

async function debugPg(q: string, limit = 20) {
  console.log('— postgres debug —');
  const tokens = tokenize(q);
  if (tokens.length === 0) {
    console.log('no tokens');
    return;
  }
  const params: any[] = [];
  const where: string[] = [];
  for (const tok of tokens) {
    const p = `%${tok}%`;
    params.push(p, p, p);
    const idx1 = params.length - 2; // name_en
    const idx2 = params.length - 1; // name_jp
    const idx3 = params.length; // grade + name_en
    where.push(`(name_en ILIKE $${idx1} OR name_jp ILIKE $${idx2} OR (grade || ' ' || name_en) ILIKE $${idx3})`);
  }
  const sql = `
    SELECT manual_id, name_en, name_jp, grade, release_date
    FROM bandai.manuals
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY COALESCE(release_date, DATE '1900-01-01') DESC, manual_id DESC
    LIMIT ${Math.max(1, Math.min(50, limit))}
  `;
  console.log('sql:\n', sql);
  console.log('params:', params);
  const res = await withClient((c) => c.query(sql, params));
  console.log('rows:', res.rowCount);
  for (const r of res.rows) {
    const label = r.name_en || r.name_jp || `Manual ${r.manual_id}`;
    const d = r.release_date || '—';
    console.log(`  ${r.manual_id} | ${d} | ${r.grade ?? '—'} | ${label}`);
  }
}

async function main() {
  const { flags, rest } = parseArgs(process.argv.slice(2));
  const q = rest.join(' ').trim();
  if (!q) {
    console.log('Usage: npm run bot:debug-suggest -- "<query>" [--limit 20] [--path supabase|pg]');
    process.exit(1);
  }
  const limit = parseInt(String(flags.limit ?? '20'), 10) || 20;
  const pathFlag = String(flags.path || '').toLowerCase();
  const forceSb = pathFlag === 'supabase' || process.env.USE_SUPABASE_JS === '1' || process.env.FORCE_SUPABASE === '1';
  const haveSbCreds = Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY));
  const useSupabase = forceSb || haveSbCreds;

  try {
    if (useSupabase && pathFlag !== 'pg') {
      await debugSupabase(q, limit);
    } else {
      await debugPg(q, limit);
    }
  } catch (e: any) {
    console.error('debug error:', e?.message || e);
    process.exitCode = 1;
  }
}

main();

