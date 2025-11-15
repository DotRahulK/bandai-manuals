#!/usr/bin/env tsx
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { suggestManuals, searchManuals } from './query_supabase.js';

function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (typeof v === 'undefined') {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          flags[k] = next;
          i++;
        } else {
          flags[k] = true;
        }
      } else {
        flags[k] = v;
      }
    } else {
      rest.push(a);
    }
  }
  return { flags, rest };
}

async function main() {
  const { flags, rest } = parseArgs(process.argv.slice(2));
  const q = rest.join(' ').trim();
  if (!q) {
    console.log('Usage: npm run debug-suggest -- "<query>" [--limit 20] [--debug 1] [--env /path/to/.env]');
    process.exit(1);
  }
  const limit = parseInt(String(flags.limit ?? '20'), 10) || 20;
  if (flags.debug) process.env.DEBUG_SUGGEST = '1';

  // Load explicit env path if provided
  const envPath = typeof flags.env === 'string' ? String(flags.env) : '';
  if (envPath) dotenv.config({ path: envPath });
  // Fallback: if running from bot/ and no SUPABASE env, try parent .env
  if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    const parentEnv = path.resolve(process.cwd(), '..', '.env');
    if (fs.existsSync(parentEnv)) dotenv.config({ path: parentEnv });
  }

  console.log('— bot 1:1 suggest —');
  console.log('q:', q, 'limit:', limit, 'DEBUG_SUGGEST:', process.env.DEBUG_SUGGEST === '1');

  const suggestions = await suggestManuals(q, limit);
  console.log('suggestions count:', suggestions.length);
  for (const s of suggestions) console.log('  ', s.value, '|', s.name);

  // Optional: show search results (same module), helpful for comparison
  const searchRows = await searchManuals(q, undefined, Math.min(limit, 25));
  console.log('search rows count:', searchRows.length);
  for (const r of searchRows) {
    const label = r.name_en || r.name_jp || `Manual ${r.manual_id}`;
    console.log('  ', r.manual_id, '|', r.grade ?? '—', '|', label);
  }
}

main().catch((e) => {
  console.error('debug error:', e?.message || e);
  process.exit(1);
});
