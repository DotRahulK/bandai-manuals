Deploying the Discord Bot on Oracle Cloud (Ubuntu)

Overview

- This deploy runs only the Discord bot (no scraper) and uses Supabase for data + Storage.
- You’ll run the compiled bot as a systemd service on a small VM (1GB is fine).

Prereqs

- Ubuntu 22.04+ VM (OCI Ampere A1 micro works). Allow outbound 443. No inbound except SSH (22/tcp).
- Supabase project with:
  - bandai schema + manuals table (use our migrations if needed)
  - Exposed Schemas includes bandai; Extra Search Path includes bandai
  - Privileges: GRANT USAGE ON SCHEMA bandai; GRANT SELECT ON ALL TABLES IN SCHEMA bandai (service_role at minimum)
  - Optional: run migrations/004_search_functions.sql for better search
  - Storage bucket (manuals) populated with PDFs and public access (or plan to use signed URLs)

1) Install basics and Node

- sudo apt update && sudo apt install -y git curl
- curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
- source ~/.bashrc && nvm install 20 && nvm alias default 20
- Optional (1GB RAM): add swap
  - sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  - echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

2) Clone and build the bot only

- git clone <your repo ssh url>
- cd bandai-manuals/bot
- npm ci
- npm run build

3) Configure env (bot/.env)

- cp ../.env.bot.example .env and fill:
  - DISCORD_APP_ID, DISCORD_TOKEN
  - SUPABASE_URL, SUPABASE_KEY (service role key; server-side only)
  - USE_SUPABASE_JS=1
  - ATTACH_MAX_MB=8 (or your server limit)
  - If you keep some PDFs on disk (optional): FILES_ROOT=/srv/manuals, SUBDIR=manuals

4) Register slash commands

- npm run register
- Use DISCORD_GUILD_ID for faster testing in one server (optional). Global commands can take up to ~1 hour to propagate.

5) Run the bot (systemd)

- Create a service file (adjust paths):

  [Unit]
  Description=Bandai Manuals Discord Bot
  After=network-online.target
  Wants=network-online.target

  [Service]
  Type=simple
  WorkingDirectory=/home/ubuntu/bandai-manuals/bot
  EnvironmentFile=/home/ubuntu/bandai-manuals/bot/.env
  ExecStart=/home/ubuntu/.nvm/versions/node/v20/bin/node dist/bot.js
  Restart=always
  RestartSec=5

  [Install]
  WantedBy=multi-user.target

- Save to /etc/systemd/system/bandai-bot.service
- sudo systemctl daemon-reload && sudo systemctl enable --now bandai-bot
- Logs: journalctl -u bandai-bot -f

6) Verify

- The bot should come online in Discord: look for its presence.
- Test /manual and type e.g. "wing mgsd" — suggestions should prioritize items matching all tokens.
- Selecting an item uploads the PDF (from local or Supabase Storage) in the same message (size-capped by ATTACH_MAX_MB).

Troubleshooting

- Permissions error (PGRST106, 42501): ensure bandai is in Exposed Schemas and USAGE/SELECT grants applied; use service_role key.
- No suggestions: confirm bandai.search_manuals/suggest_manuals exist if you deployed migration 004; otherwise basic OR search runs.
- Large PDFs: increase ATTACH_MAX_MB only if your Discord server allows larger uploads; otherwise the bot skips attachment.
- Storage private: we can switch to signed URLs at runtime (ask to add). Public buckets are simplest.
