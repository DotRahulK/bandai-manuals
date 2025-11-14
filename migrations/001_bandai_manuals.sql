-- Create a dedicated schema to avoid conflicts
CREATE SCHEMA IF NOT EXISTS bandai;

-- Track applied migrations for this schema
CREATE TABLE IF NOT EXISTS bandai.migrations (
  id SERIAL PRIMARY KEY,
  filename TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Manuals table
CREATE TABLE IF NOT EXISTS bandai.manuals (
  manual_id INTEGER PRIMARY KEY,
  detail_path TEXT,
  detail_url TEXT,
  pdf_url TEXT UNIQUE,
  pdf_local_path TEXT,
  name_jp TEXT,
  name_en TEXT,
  grade TEXT,
  release_date DATE,
  release_date_text TEXT,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_manuals_release_date ON bandai.manuals (release_date);
CREATE INDEX IF NOT EXISTS idx_manuals_grade ON bandai.manuals (grade);

