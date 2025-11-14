import { withClient } from '../db.js';

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
};

export async function getManualById(id: number): Promise<ManualRow | null> {
  const res = await withClient((c) =>
    c.query(
      `SELECT manual_id, detail_url, pdf_url, pdf_local_path, name_jp, name_en, grade, release_date, release_date_text, image_url
       FROM bandai.manuals WHERE manual_id = $1`,
      [id]
    )
  );
  return res.rowCount ? (res.rows[0] as ManualRow) : null;
}

export async function searchManuals(q: string, grade?: string, limit = 5): Promise<ManualRow[]> {
  const params: any[] = [];
  const where: string[] = [];
  if (q) {
    // Tokenize query and require every token to appear in any order
    const tokens = q
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
    for (const tok of tokens) {
      const p1 = `%${tok}%`;
      params.push(p1, p1, p1);
      const idx1 = params.length - 2; // name_en
      const idx2 = params.length - 1; // name_jp
      const idx3 = params.length; // grade+name_en concat below
      where.push(`(name_en ILIKE $${idx1} OR name_jp ILIKE $${idx2} OR (grade || ' ' || name_en) ILIKE $${idx3})`);
    }
  }
  if (grade) {
    params.push(grade);
    where.push(`grade = $${params.length}`);
  }
  const sql = `
    SELECT manual_id, detail_url, pdf_url, pdf_local_path, name_jp, name_en, grade, release_date, release_date_text, image_url
    FROM bandai.manuals
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY COALESCE(release_date, '1900-01-01') DESC, manual_id DESC
    LIMIT ${Math.max(1, Math.min(25, limit))}
  `;
  const res = await withClient((c) => c.query(sql, params));
  return res.rows as ManualRow[];
}

export type Suggestion = { name: string; value: string };

export async function suggestManuals(q: string, limit = 20): Promise<Suggestion[]> {
  const tokens = q
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (tokens.length === 0) return [];

  const params: any[] = [];
  const where: string[] = [];
  for (const tok of tokens) {
    const p1 = `%${tok}%`;
    params.push(p1, p1, p1);
    const idx1 = params.length - 2; // name_en
    const idx2 = params.length - 1; // name_jp
    const idx3 = params.length; // grade + name_en
    where.push(`(name_en ILIKE $${idx1} OR name_jp ILIKE $${idx2} OR (grade || ' ' || name_en) ILIKE $${idx3})`);
  }
  const sql = `
    SELECT manual_id, name_en, name_jp, grade
    FROM bandai.manuals
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY COALESCE(release_date, '1900-01-01') DESC, manual_id DESC
    LIMIT ${Math.max(1, Math.min(20, limit))}
  `;
  const res = await withClient((c) => c.query(sql, params));
  return res.rows.map((r) => {
    const label = `${r.grade ? r.grade + ' ' : ''}${r.name_en || r.name_jp || 'Manual'} [${r.manual_id}]`;
    return { name: label, value: String(r.manual_id) } as Suggestion;
  });
}
