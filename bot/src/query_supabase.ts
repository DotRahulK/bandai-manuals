import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

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

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL/KEY');
  return createClient(url, key, { db: { schema: 'bandai' } });
}

function parseGradeFromQuery(q: string): string | null {
  const s = q.toLowerCase();
  const checks: Array<{ re: RegExp; code: string }> = [
    { re: /\bmg\s*ex\b/, code: 'MGEX' },
    { re: /\bmg\s*sd\b/, code: 'MGSD' },
    { re: /\bmaster\s+grade\b/, code: 'MG' },
    { re: /\breal\s+grade\b/, code: 'RG' },
    { re: /\bhigh\s+grade\b/, code: 'HG' },
    { re: /\bentry\s+grade\b/, code: 'EG' },
    { re: /\bre\s*\/?\s*100\b/, code: 'RE/100' },
    { re: /\bfull\s+mechanics\b/, code: 'FM' },
    { re: /\bperfect\s+grade\b/, code: 'PG' },
    { re: /\bsd\s*cs\b/, code: 'SDCS' },
    { re: /\bmgex\b/, code: 'MGEX' },
    { re: /\bmgsd\b/, code: 'MGSD' },
    { re: /\beg\b|\bentry\b/, code: 'EG' },
    { re: /\bhg\b|\bhigh\b/, code: 'HG' },
    { re: /\brg\b|\breal\b/, code: 'RG' },
    { re: /\bmg\b|\bmaster\b/, code: 'MG' },
    { re: /\bpg\b|\bperfect\b/, code: 'PG' },
    { re: /\bsdcs\b/, code: 'SDCS' },
    { re: /\bsd\b/, code: 'SD' }
  ];
  for (const c of checks) if (c.re.test(s)) return c.code;
  return null;
}

function matchesGrade(row: ManualRow, code: string): boolean {
  const target = code.toUpperCase();
  if ((row.grade || '').toUpperCase() === target) return true;
  const ne = (row.name_en || '').toUpperCase();
  const nj = (row.name_jp || '').toUpperCase();
  return ne.includes(target) || nj.includes(target);
}

export async function getManualById(id: number): Promise<ManualRow | null> {
  const sb = getClient();
  const { data, error } = await sb
    .from('manuals')
    .select(
      'manual_id, detail_url, pdf_url, pdf_local_path, name_jp, name_en, grade, release_date, release_date_text, image_url, storage_bucket, storage_path, storage_public_url'
    )
    .eq('manual_id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as ManualRow) || null;
}

export async function searchManuals(q: string, grade?: string, limit = 5): Promise<ManualRow[]> {
  const sb = getClient();
  const { data, error } = await sb.rpc('search_manuals', { q, p_limit: Math.max(1, Math.min(25, limit)) });
  if (error) throw error;
  let rows = (data as ManualRow[]) || [];
  const detected = grade || parseGradeFromQuery(q);
  if (detected) rows = rows.filter((r) => matchesGrade(r, detected));
  return rows;
}

export type Suggestion = { name: string; value: string };
export async function suggestManuals(q: string, limit = 20): Promise<Suggestion[]> {
  const sb = getClient();
  const { data, error } = await sb.rpc('suggest_manuals', { q, p_limit: Math.max(1, Math.min(20, limit)) });
  if (error) throw error;
  let rows = (data as any[]) || [];
  const detected = parseGradeFromQuery(q);
  if (detected) rows = rows.filter((r: any) => matchesGrade(r as ManualRow, detected));
  return rows.map((r) => {
    const label = `${r.grade ? r.grade + ' ' : ''}${r.name_en || r.name_jp || 'Manual'} [${r.manual_id}]`;
    return { name: label, value: String(r.manual_id) };
  });
}
