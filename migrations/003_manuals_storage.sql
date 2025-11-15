-- Add optional storage columns for Supabase Storage (or any object store)
ALTER TABLE bandai.manuals
ADD COLUMN IF NOT EXISTS storage_bucket TEXT,
ADD COLUMN IF NOT EXISTS storage_path TEXT,
ADD COLUMN IF NOT EXISTS storage_public_url TEXT,
ADD COLUMN IF NOT EXISTS storage_size_bytes BIGINT,
ADD COLUMN IF NOT EXISTS storage_uploaded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_manuals_storage_path ON bandai.manuals (storage_path);

