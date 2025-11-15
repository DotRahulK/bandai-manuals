Bandai Manuals Scraper (TypeScript)

This repo scaffolds a Node.js + TypeScript project to crawl https://manual.bandai-hobby.net/ and download discovered manual PDFs.

Quick start

- Node 18+ recommended (uses ESM + fetch-compatible HTTP via got).
- Install dependencies:
  - npm install
- Crawl site (collect links + pdfs):
  - npm run crawl
- Download discovered PDFs:
  - npm run download

Postgres schema + populate

- Ensure Postgres is running (example docker-compose shown below). Configure env via either `DATABASE_URL` or `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`.
- Create schema/tables:
  - npm run migrate
- Populate database from the Bandai listing (and optionally download PDFs):
  - npm run populate
  - npm run populate:download  # also save PDFs into `downloads/manuals/`
  - Override base list URL via env or CLI:
    - BASE_LIST_URL="https://manual.bandai-hobby.net/?sort=new&..." npm run populate
    - npm run populate -- --url "https://manual.bandai-hobby.net/?sort=new&..."
  - After populate, download any missing PDFs directly from DB rows:
    - npm run download:db
    - npm run download:db:all  # re-download regardless of existing db paths

Scripts

- npm run dev — run the CLI in dev mode (tsx)
- npm run crawl — crawl base site, save to data/discovered.json and data/pdfs.json
- npm run download — download all PDFs listed in data/pdfs.json into downloads/
- npm run migrate — apply SQL migrations to Postgres (creates `bandai` schema and `bandai.manuals`)
- npm run populate — scrape listing pages into Postgres
- npm run populate:download — same as populate + downloads PDFs to `downloads/manuals/`
- npm run download:db — download PDFs for rows missing `pdf_local_path`
- npm run download:db:all — download PDFs for all rows (ignore `pdf_local_path`)
- npm run supabase:sync — apply migrations to a Supabase Postgres and copy data from your source DB
- npm run supabase:upload — upload local PDFs to Supabase Storage and save public URL in DB

Configuration

Use env vars to tune behavior:

- BASE_URL — default: https://manual.bandai-hobby.net/
- MAX_PAGES — max pages to visit (default 250)
- CONCURRENCY — parallel requests (default 4)
- DELAY_MS — delay between requests per worker (default 300)
- TIMEOUT_MS — request timeout (default 30000)
- USER_AGENT — override UA string
- Postgres envs (either provide `DATABASE_URL` or separate vars):
  - PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
  - Optional: PGPOOL_MAX (default 10)
  - Example docker-compose service name/port: `localhost:5432`
  - The migration creates a dedicated schema `bandai` with `bandai.manuals`
- Supabase sync envs:
  - Target (Supabase) via `SUPABASE_DATABASE_URL` (recommended; include `?sslmode=require`) or `SUPABASE_PG*`
  - Optional separate source via `SOURCE_DATABASE_URL` or `SOURCE_PG*` (defaults to `DATABASE_URL`/`PG*`)

Download from DB options (env)

- FILES_ROOT — base directory for all stored files (default `downloads`)
- SUBDIR — subfolder within FILES_ROOT for manuals (default `manuals`)
- ONLY_MISSING — `1` (default) downloads only where `pdf_local_path` is null/empty; set `0` to re-download
- LIMIT — limit number of rows to process (e.g., `LIMIT=50`)
- GRADE — comma-separated filter, e.g., `GRADE=HG,MG`
- IDS — comma-separated manual IDs, e.g., `IDS=3962,4010`
- DL_CONCURRENCY — parallel downloads (default 3)

Path storage behavior

- The column `bandai.manuals.pdf_local_path` stores a relative path from `FILES_ROOT`.
- To relocate deployments, set `FILES_ROOT` to the correct base path; scripts will resolve absolute paths accordingly.
- Existing rows with older absolute or CWD-relative paths are auto-normalized to relative when detected within `FILES_ROOT` during `download:db` runs.

Bandai listing scraper

- Default list URL is the one you provided with all categories and `sort=new`.
- Pagination is handled via `&page=N`.
- The scraper stops when a page returns no results or when a redirect changes the `page` number (interpreted as exceeding the last page).
- You can override the base list URL with `BASE_LIST_URL` env or `--url` CLI flag; the scraper resolves relative links against that URL’s origin.
- Extracted per item:
  - manual_id (from `/menus/detail/<id>`)
  - pdf_url (`/pdf/<id>.pdf`)
  - name_jp, name_en
  - grade (heuristic from name prefix, e.g., HG/MG/RG/PG/etc.)
  - release_date (parsed when day is present), release_date_text
  - image_url

Project structure

- src/index.ts — CLI entry (crawl, download)
- src/crawler.ts — generic in-domain crawler that looks for PDF links
- src/http.ts — HTTP client with retry + rate limiting + download
- src/utils.ts — helpers (sanitize, URL ops)
- src/storage.ts — save/read JSON, ensure dirs
- src/db.ts — Postgres connection pool helper
- src/migrate.ts — migration runner
- migrations/001_bandai_manuals.sql — schema for `bandai.manuals`
- src/scrape_bandai.ts — listing scraper -> DB (+optional downloads)
- src/discord/bot.ts — Discord gateway bot with slash commands
- src/discord/register.ts — register slash commands (guild/global)
- src/discord/query.ts — DB queries for bot handlers
- data/ — discovered URLs + PDFs
- downloads/ — downloaded PDF files

Notes

- The crawler is conservative: it stays within the domain, follows likely manual/catalog paths, and records .pdf links it encounters. You can refine include/exclude patterns in src/crawler.ts if the site structure changes.
- Be respectful: keep concurrency low, add delay, and avoid hammering the site.

Supabase sync

- Goal: create the same schema in Supabase and copy your local data.
- Set target connection (Supabase):
  - `SUPABASE_DATABASE_URL=postgresql://postgres:<PW>@db.<REF>.supabase.co:5432/postgres?sslmode=require`
  - Or set `SUPABASE_PGHOST/PORT/USER/PASSWORD/DATABASE` and `SUPABASE_PGSSL=1`.
- Set source connection (defaults to `DATABASE_URL`):
  - Optionally set `SOURCE_DATABASE_URL` if your source DB differs.
- Run:
  - `npm run supabase:sync` — applies migrations (schema) on Supabase and copies rows in batches.
  - `npm run supabase:sync -- --data-only` — copy data only (skip migrations).

Supabase Storage (PDFs)

- Goal: host PDFs in Supabase Storage and fetch from there.
- Set env:
  - `SUPABASE_URL` and `SUPABASE_KEY` (service role, server-side only)
  - `SUPABASE_BUCKET` (default `manuals`) — will be created if missing (public)
  - Optional `SUPABASE_PREFIX` to namespace keys (e.g., `bandai`)
- Upload:
  - Ensure local files exist under `FILES_ROOT/SUBDIR` and `bandai.manuals.pdf_local_path` is populated.
  - Run: `npm run supabase:upload`
  - It uploads PDFs and updates `bandai.manuals` with `storage_bucket`, `storage_path`, `storage_public_url`, size, and timestamp.
- Bot behavior:
  - If local file is missing, the bot will try `storage_public_url` and upload the PDF (within `ATTACH_MAX_MB`).
  - Prefer keeping the bucket public for simple access; otherwise you’ll need to generate signed URLs server-side.

Discord bot

- Commands
  - /manual q:<text|id> attach:<bool?> — pick from suggestions or enter an ID; uploads the PDF when available
- Setup
  - Create a Discord application + bot, invite with `applications.commands` and `bot` permissions.
  - Choose data source:
    - Supabase (recommended): set `SUPABASE_URL` and `SUPABASE_KEY` (service role) — the bot queries `bandai.manuals` via supabase-js.
    - Postgres (fallback): set `DATABASE_URL` (or PG* envs) — the bot queries via pg.
  - Set bot env: `DISCORD_TOKEN`, `DISCORD_APP_ID`, optionally `DISCORD_GUILD_ID` for faster command registration.
  - Register slash commands: `npm run bot:register`
- Run bot: `npm run bot`
- Env for attachments
  - `ATTACH_IF_LOCAL=1` to attach local PDFs when `pdf_local_path` exists.
  - `ATTACH_MAX_MB` to cap attachment size (default 8MB). Larger files are linked instead.
  - Uses `FILES_ROOT` + `SUBDIR` to find files (see earlier section).
  - If a local file is missing, and Supabase Storage columns are set, the bot downloads from `storage_public_url` (or computes it from `storage_bucket` + `storage_path`) and uploads the PDF in the same message (subject to size cap).

Free hosting ideas

- Interactions-only (serverless, free):
  - Cloudflare Workers or Pages Functions to handle slash-command HTTP interactions (no gateway). You’ll implement Discord signature verification and query your hosted Postgres (e.g., Neon/Supabase). Pros: free, no long-lived process. Cons: only slash commands, respond in ~3s.
  - Vercel serverless functions can also serve the Interaction endpoint (free tier), similar tradeoffs.
- Gateway bot (needs a long-lived process):
  - Fly.io: small app VMs can be very low-cost; sometimes free credits. Good for a simple Node bot.
  - Railway: often gives free starter credits; can run a background Node process.
  - Replit: can run a bot, but always-on may require paid plan.
  - Self-host: small VPS or a home server.
- Postgres (free):
  - Neon (free tier), Supabase (free tier), ElephantSQL (tiny free). Point `DATABASE_URL` to these.
- Files:
  - Avoid hosting PDFs by linking the official `pdf_url`. If you need hosting, use object storage with free tier: Cloudflare R2 or Backblaze B2. Store only the relative key in DB and construct public URLs at runtime.


Example docker-compose (Postgres 16)

version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    container_name: sfda-postgres
    restart: unless-stopped
    environment:
      - POSTGRES_USER=${POSTGRES_USER:-postgres}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-postgres}
      - POSTGRES_DB=${POSTGRES_DB:-postgres}
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-postgres} || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
