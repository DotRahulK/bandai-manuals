-- Optional: speed up ILIKE suggestions and search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_manuals_name_en_trgm ON bandai.manuals USING gin (lower(name_en) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_manuals_name_jp_trgm ON bandai.manuals USING gin (lower(name_jp) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_manuals_grade_en_trgm ON bandai.manuals USING gin (lower(grade || ' ' || name_en) gin_trgm_ops);

