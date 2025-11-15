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
  const { data, error } = await supabase.rpc('search_manuals', { q, p_limit: Math.max(1, Math.min(25, limit)) });
  if (error) throw error;
  let rows = (data as any[]) || [];
  if (grade) rows = rows.filter((r) => r.grade === grade);
  return rows as ManualRow[];
}

export type Suggestion = { name: string; value: string };

export async function suggestManuals(q: string, limit = 20): Promise<Suggestion[]> {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('suggest_manuals', { q, p_limit: Math.max(1, Math.min(20, limit)) });
  if (error) throw error;
  const rows = (data as any[]) || [];
  return rows.map((r) => {
    const label = `${r.grade ? r.grade + ' ' : ''}${r.name_en || r.name_jp || 'Manual'} [${r.manual_id}]`;
    return { name: label, value: String(r.manual_id) };
  });
}
