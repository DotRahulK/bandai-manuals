import 'dotenv/config';
import { Pool, PoolClient } from 'pg';

function buildPool(): Pool {
  // If PG* fields are provided, prefer them over DATABASE_URL. This allows easy override for local exports.
  const hasPgFields = Boolean(
    process.env.PGHOST || process.env.SUPABASE_PGHOST || process.env.PGUSER || process.env.PGPASSWORD || process.env.PGDATABASE
  );

  const direct = !hasPgFields ? process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL : undefined;
  if (direct) {
    const lower = direct.toLowerCase();
    const needsSsl = /sslmode=require/.test(lower) || /@(.*\.)?(supabase\.co|neon\.tech|render\.com)/.test(lower);
    return new Pool({
      connectionString: direct,
      max: parseInt(process.env.PGPOOL_MAX || '10', 10),
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined
    });
  }

  // Otherwise use explicit fields; accept SUPABASE_PG* as well
  const host = process.env.PGHOST || process.env.SUPABASE_PGHOST || '127.0.0.1';
  const port = parseInt(process.env.PGPORT || process.env.SUPABASE_PGPORT || '5432', 10);
  const user = process.env.PGUSER || process.env.SUPABASE_PGUSER || 'postgres';
  const password = process.env.PGPASSWORD || process.env.SUPABASE_PGPASSWORD || 'postgres';
  const database = process.env.PGDATABASE || process.env.SUPABASE_PGDATABASE || 'postgres';
  const sslEnabled = Boolean(process.env.PGSSL || process.env.SUPABASE_PGSSL);
  return new Pool({
    host,
    port,
    user,
    password,
    database,
    max: parseInt(process.env.PGPOOL_MAX || '10', 10),
    ssl: sslEnabled ? { rejectUnauthorized: false } : undefined
  });
}

const pool = buildPool();

export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function endPool() {
  await pool.end();
}
