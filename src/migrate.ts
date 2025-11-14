#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { withClient, endPool } from './db.js';

async function ensureMigrationsTable() {
  await withClient(async (c) => {
    await c.query(`CREATE SCHEMA IF NOT EXISTS bandai;`);
    await c.query(`
      CREATE TABLE IF NOT EXISTS bandai.migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  });
}

async function alreadyApplied(filename: string): Promise<boolean> {
  const res = await withClient((c) => c.query('SELECT 1 FROM bandai.migrations WHERE filename = $1', [filename]));
  return res.rowCount > 0;
}

async function applyMigration(filename: string, sql: string) {
  await withClient(async (c) => {
    await c.query('BEGIN');
    try {
      await c.query(sql);
      await c.query('INSERT INTO bandai.migrations (filename) VALUES ($1)', [filename]);
      await c.query('COMMIT');
      console.log(`[migrate] applied ${filename}`);
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    }
  });
}

async function main() {
  const dir = path.resolve('migrations');
  await ensureMigrationsTable();
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const f of files) {
    if (await alreadyApplied(f)) {
      continue;
    }
    const full = path.join(dir, f);
    const sql = fs.readFileSync(full, 'utf-8');
    await applyMigration(f, sql);
  }
}

main()
  .catch((e) => {
    console.error('[migrate] failed:', e);
    process.exit(1);
  })
  .finally(() => endPool());

