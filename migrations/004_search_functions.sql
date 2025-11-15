-- Search helpers with AND-of-OR token matching and scoring
CREATE OR REPLACE FUNCTION bandai.search_manuals(q text, p_limit integer DEFAULT 20)
RETURNS TABLE (
  manual_id integer,
  detail_url text,
  pdf_url text,
  pdf_local_path text,
  name_jp text,
  name_en text,
  grade text,
  release_date date,
  release_date_text text,
  image_url text,
  storage_bucket text,
  storage_path text,
  storage_public_url text,
  score integer
) LANGUAGE sql STABLE AS $$
WITH toks AS (
  SELECT DISTINCT lower(trim(tok)) AS tok
  FROM regexp_split_to_table(q, '\s+') AS tok
  WHERE trim(tok) <> ''
),
tok_count AS (
  SELECT count(*) AS n FROM toks
),
scored AS (
  SELECT m.*, 
         COALESCE((
           SELECT COUNT(*) FROM toks t
           WHERE (
             (m.name_en IS NOT NULL AND lower(m.name_en) LIKE '%'||t.tok||'%') OR
             (m.name_jp IS NOT NULL AND lower(m.name_jp) LIKE '%'||t.tok||'%') OR
             ((m.grade IS NOT NULL AND m.name_en IS NOT NULL) AND lower(m.grade || ' ' || m.name_en) LIKE '%'||t.tok||'%')
           )
         ), 0) AS score,
         (SELECT n FROM tok_count) AS n_tokens
  FROM bandai.manuals m
)
SELECT manual_id, detail_url, pdf_url, pdf_local_path, name_jp, name_en, grade, release_date, release_date_text, image_url,
       storage_bucket, storage_path, storage_public_url, score
FROM scored
WHERE (SELECT n FROM tok_count) = 0 OR score > 0
ORDER BY (score = n_tokens) DESC, score DESC, COALESCE(release_date, DATE '1900-01-01') DESC, manual_id DESC
LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION bandai.suggest_manuals(q text, p_limit integer DEFAULT 20)
RETURNS TABLE (
  manual_id integer,
  name_en text,
  name_jp text,
  grade text,
  score integer
) LANGUAGE sql STABLE AS $$
WITH toks AS (
  SELECT DISTINCT lower(trim(tok)) AS tok
  FROM regexp_split_to_table(q, '\s+') AS tok
  WHERE trim(tok) <> ''
),
tok_count AS (
  SELECT count(*) AS n FROM toks
),
scored AS (
  SELECT m.manual_id, m.name_en, m.name_jp, m.grade,
         COALESCE((
           SELECT COUNT(*) FROM toks t
           WHERE (
             (m.name_en IS NOT NULL AND lower(m.name_en) LIKE '%'||t.tok||'%') OR
             (m.name_jp IS NOT NULL AND lower(m.name_jp) LIKE '%'||t.tok||'%') OR
             ((m.grade IS NOT NULL AND m.name_en IS NOT NULL) AND lower(m.grade || ' ' || m.name_en) LIKE '%'||t.tok||'%')
           )
         ), 0) AS score,
         (SELECT n FROM tok_count) AS n_tokens
  FROM bandai.manuals m
)
SELECT manual_id, name_en, name_jp, grade, score
FROM scored
WHERE (SELECT n FROM tok_count) = 0 OR score > 0
ORDER BY (score = n_tokens) DESC, score DESC, manual_id DESC
LIMIT p_limit;
$$;

