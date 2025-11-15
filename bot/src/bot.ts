#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Client, GatewayIntentBits, ChatInputCommandInteraction, AttachmentBuilder, EmbedBuilder, Partials } from 'discord.js';
import { commands } from './commands.js';
import * as SbQ from './query_supabase.js';
import { HttpClient } from './http.js';

const token = process.env.DISCORD_TOKEN || process.env.BOT_TOKEN;
if (!token) {
  console.error('Missing DISCORD_TOKEN');
  process.exit(1);
}

const ATTACH_IF_LOCAL = (process.env.ATTACH_IF_LOCAL || '0') === '1';
const ATTACH_MAX_MB = parseFloat(process.env.ATTACH_MAX_MB || '8');
const ATTACH_MAX_BYTES = Math.max(1, Math.floor(ATTACH_MAX_MB * 1024 * 1024));
const FILES_ROOT = process.env.FILES_ROOT || 'downloads';
const SUBDIR = process.env.SUBDIR || 'manuals';

const http = new HttpClient({ concurrency: 2 });

const client = new Client({ intents: [GatewayIntentBits.Guilds], partials: [Partials.Channel] });
client.once('ready', () => console.log(`[bot] logged in as ${client.user?.tag}`));

client.on('interactionCreate', async (interaction) => {
  if (interaction.isAutocomplete()) {
    try {
      const focused = interaction.options.getFocused(true);
      if (interaction.commandName === 'manual' && focused.name === 'q') {
        const list = await SbQ.suggestManuals(focused.value);
        await interaction.respond(list);
      }
    } catch {}
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  try {
    if (interaction.commandName === 'manual') await handleManual(interaction);
  } catch (e) {
    console.error('[bot] handler error', e);
    if (interaction.isRepliable()) await interaction.reply({ content: 'Sorry, something went wrong.', ephemeral: true }).catch(() => {});
  }
});

function formatRelease(dateVal: unknown, text: string | null | undefined): string {
  if (dateVal instanceof Date) {
    const y = dateVal.getFullYear();
    const m = String(dateVal.getMonth() + 1).padStart(2, '0');
    const d = String(dateVal.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof dateVal === 'string' && dateVal.trim().length > 0) return dateVal;
  if (typeof text === 'string' && text.trim().length > 0) return text;
  return '—';
}

function formatEmbed(m: SbQ.ManualRow) {
  const title = m.name_en || m.name_jp || `Manual ${m.manual_id}`;
  const eb = new EmbedBuilder()
    .setTitle(title)
    .addFields(
      { name: 'ID', value: String(m.manual_id), inline: true },
      { name: 'Grade', value: m.grade ? String(m.grade) : '—', inline: true },
      { name: 'Release', value: formatRelease((m as any).release_date, m.release_date_text), inline: true }
    )
    .setFooter({ text: 'Bandai Manuals' });
  if (m.detail_url) eb.setURL(m.detail_url);
  if (m.image_url) eb.setThumbnail(m.image_url);
  return eb;
}

function sanitizeName(input: string): string {
  return input
    .replace(/[\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeFileBase(row: SbQ.ManualRow): string {
  const name = sanitizeName(row.name_en || row.name_jp || 'manual');
  return `${row.manual_id}-${name}`;
}

async function handleManual(interaction: ChatInputCommandInteraction) {
  const qVal = interaction.options.getString('q', true);
  const attachOpt = interaction.options.getBoolean('attach') ?? false;
  await interaction.deferReply();

  let id: number | null = null;
  if (/^\d+$/.test(qVal)) id = parseInt(qVal, 10);
  let row = id ? await SbQ.getManualById(id) : null;
  if (!row) {
    const sug = await SbQ.suggestManuals(qVal, 1);
    if (sug.length) row = await SbQ.getManualById(parseInt(sug[0].value, 10));
  }
  if (!row) {
    await interaction.editReply({ content: `No manual found for “${qVal}”.` });
    return;
  }

  const eb = formatEmbed(row);
  let abs: string | null = null;
  const attachBase = makeFileBase(row);

  // Local optional
  if (ATTACH_IF_LOCAL && row.pdf_local_path) {
    const local = path.resolve(FILES_ROOT, row.pdf_local_path);
    if (fs.existsSync(local)) abs = local;
  }

  // Supabase Storage URL
  const tryUrl = async (url: string) => {
    const h = await http.head(url);
    const cl = h.headers['content-length'];
    const size = Array.isArray(cl) ? parseInt(cl[0] || '0', 10) : parseInt((cl as string) || '0', 10);
    if (!Number.isNaN(size) && size > 0 && size <= ATTACH_MAX_BYTES) {
      const tmp = path.join(process.cwd(), '.tmp');
      await fs.promises.mkdir(tmp, { recursive: true });
      const out = path.join(tmp, `${attachBase}.pdf`);
      await http.download(url, tmp, `${attachBase}.pdf`);
      return out;
    }
    return null;
  };

  if (!abs && row.storage_public_url) {
    try { abs = await tryUrl(row.storage_public_url); } catch {}
  }

  if (!abs && row.storage_bucket && row.storage_path) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const sb = createClient(process.env.SUPABASE_URL!, (process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!);
      const { data } = sb.storage.from(row.storage_bucket).getPublicUrl(row.storage_path);
      const url = data?.publicUrl;
      if (url) abs = await tryUrl(url);
    } catch {}
  }

  let files: AttachmentBuilder[] | undefined;
  if (abs) {
    try {
      const stat = fs.statSync(abs);
      if (stat.size <= ATTACH_MAX_BYTES) {
        const name = `${attachBase}.pdf`;
        files = [new AttachmentBuilder(abs, { name })];
      }
    } catch {}
  }

  await interaction.editReply({ embeds: eb ? [eb] : [], files });
}

// find command removed

client.login(token);
