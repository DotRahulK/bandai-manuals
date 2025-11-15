import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type ManualRow = {
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

function getClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_KEY for supabase-js queries');
  }
  return createClient(url, key, { db: { schema: 'bandai' } });
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

function matchesGrade(row: ManualRow, code: string): boolean {
  const syns = gradeSynonyms(code);
  const g = (row.grade || '').toUpperCase();
  if (syns.includes(g)) return true;
  const ne = (row.name_en || '').toUpperCase();
  const nj = (row.name_jp || '').toUpperCase();
  const containsToken = (text: string, token: string): boolean => {
    const T = text.toUpperCase();
    const tok = token.toUpperCase();
    // Short codes like EG/HG/MG/RG/PG/SD: require non-alnum boundaries to avoid LEGEND, etc.
    if (/^[A-Z]{1,3}$/.test(tok)) {
      const re = new RegExp(`(^|[^A-Z0-9])${tok}([^A-Z0-9]|$)`);
      return re.test(T);
    }
    // Multi-word tokens: accept with/without spaces
    const noSpaceT = T.replace(/\s+/g, '');
    const noSpaceTok = tok.replace(/\s+/g, '');
    return T.includes(tok) || noSpaceT.includes(noSpaceTok);
  };
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

function isGradeOnlyQuery(q: string): boolean {
  const gradeWords = new Set([
    'eg', 'entry', 'grade',
    'hg', 'high',
    'mg', 'master',
    'rg', 'real',
    'pg', 'perfect',
    'fm', 'full', 'mechanics', 'fullmechanics',
    're', 're/100', 're-100', 're:100', '100',
    'sd', 'sdcs', 'cs',
    'mgex', 'mg', 'ex', 'mgsd', 'sd'
  ]);
  const tokens = (q.toLowerCase().match(/\b[\p{L}0-9]+\b/gu) || []).filter((t) => !gradeWords.has(t));
  return tokens.length === 0;
}

async function fetchByGrade(code: string, limit = 20): Promise<ManualRow[]> {
  const supabase = getClient();
  const syns = gradeSynonyms(code);
  const ors: string[] = [];
  for (const s of syns) {
    const esc = s.replace(/,/g, '');
    ors.push(`grade.ilike.${esc}`);
    ors.push(`name_en.ilike.%${esc}%`);
    ors.push(`name_jp.ilike.%${esc}%`);
  }
  const { data, error } = await supabase
    .from('manuals')
    .select(
      'manual_id, detail_url, pdf_url, pdf_local_path, name_jp, name_en, grade, release_date, release_date_text, image_url, storage_bucket, storage_path, storage_public_url'
    )
    .or(ors.join(','))
    .order('release_date', { ascending: false, nullsFirst: true })
    .order('manual_id', { ascending: false })
    .limit(Math.max(1, Math.min(200, limit)));
  if (error) throw error;
  const rows = (data as ManualRow[]) || [];
  return rows.filter((r) => matchesGrade(r, code));
}

export async function getManualById(id: number): Promise<ManualRow | null> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('manuals')
    .select(
      'manual_id, detail_url, pdf_url, pdf_local_path, name_jp, name_en, grade, release_date, release_date_text, image_url, storage_bucket, storage_path, storage_public_url'
    )
    .eq('manual_id', id)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as ManualRow) || null;
}

export async function searchManuals(q: string, grade?: string, limit = 5): Promise<ManualRow[]> {
  const supabase = getClient();
  const detected = grade || parseGradeFromQuery(q);
  const qCore = detected ? stripGradeTokens(q) : q;
  const { data, error } = await supabase.rpc('search_manuals', { q: qCore, p_limit: Math.max(1, Math.min(25, limit)) });
  if (error) throw error;
  let rows = (data as ManualRow[]) || [];
  if (detected) rows = rows.filter((r) => matchesGrade(r, detected));
  if ((!rows || rows.length === 0) && detected) {
    const pool = await fetchByGrade(detected, 200);
    const tokens = stripGradeTokens(q)
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length === 0) {
      rows = pool.slice(0, limit);
    } else {
      let filtered = pool.filter((r) => {
        const hay = `${r.grade || ''} ${r.name_en || ''} ${r.name_jp || ''}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      });
      if (filtered.length === 0) {
        // fallback to any-token match to still suggest something relevant
        filtered = pool.filter((r) => {
          const hay = `${r.grade || ''} ${r.name_en || ''} ${r.name_jp || ''}`.toLowerCase();
          return tokens.some((t) => hay.includes(t));
        });
      }
      rows = filtered.slice(0, limit);
    }
  }
  return rows;
}

export type Suggestion = { name: string; value: string };

export async function suggestManuals(q: string, limit = 20): Promise<Suggestion[]> {
  const supabase = getClient();
  const detected = parseGradeFromQuery(q);
  const qCore = detected ? stripGradeTokens(q) : q;
  // If a grade is detected, fetch a larger pool by grade first to avoid losing older kits
  if (detected) {
    const pool = await fetchByGrade(detected, 200);
    const tokens = qCore
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
    let filtered = pool;
    if (tokens.length) {
      filtered = pool.filter((r) => {
        const name = `${r.name_en || ''} ${r.name_jp || ''}`.toLowerCase();
        return tokens.every((t) => name.includes(t));
      });
      if (filtered.length === 0) {
        filtered = pool.filter((r) => {
          const name = `${r.name_en || ''} ${r.name_jp || ''}`.toLowerCase();
          return tokens.some((t) => name.includes(t));
        });
      }
    }
    const rows = filtered.slice(0, Math.max(1, Math.min(20, limit)));
    return rows.map((r) => {
      const label = r.name_en || r.name_jp || `Manual ${r.manual_id}`;
      return { name: label, value: String(r.manual_id) };
    });
  }

  const { data, error } = await supabase.rpc('suggest_manuals', { q: qCore, p_limit: Math.max(1, Math.min(20, limit)) });
  if (error) throw error;
  const rows = (data as any[]) || [];
  return rows.map((r) => {
    const label = r.name_en || r.name_jp || `Manual ${r.manual_id}`;
    return { name: label, value: String(r.manual_id) };
  });
}
