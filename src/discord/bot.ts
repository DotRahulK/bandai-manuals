#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Client, GatewayIntentBits, ChatInputCommandInteraction, AttachmentBuilder, EmbedBuilder, Partials } from 'discord.js';
import { commands } from './commands.js';
import { getManualById, searchManuals, suggestManuals } from './query.js';
import { absFromRel } from '../paths.js';
import { withClient } from '../db.js';
import { HttpClient } from '../http.js';

const token = process.env.DISCORD_TOKEN || process.env.BOT_TOKEN;
if (!token) {
  console.error('Missing DISCORD_TOKEN');
  process.exit(1);
}

const ATTACH_IF_LOCAL = (process.env.ATTACH_IF_LOCAL || '0') === '1';
const ATTACH_MAX_MB = parseFloat(process.env.ATTACH_MAX_MB || '8');
const ATTACH_MAX_BYTES = Math.max(1, Math.floor(ATTACH_MAX_MB * 1024 * 1024));
const ALWAYS_UPLOAD = (process.env.ALWAYS_UPLOAD || '0') === '1';
const DOWNLOAD_ON_DEMAND = (process.env.DOWNLOAD_ON_DEMAND || '0') === '1';

const http = new HttpClient({ concurrency: 2, delayMs: 0 });

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel]
});

client.once('ready', () => {
  console.log(`[bot] logged in as ${client.user?.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isAutocomplete()) {
    try {
      const focused = interaction.options.getFocused(true);
      if (interaction.commandName === 'manual' && focused.name === 'q') {
        const list = await suggestManuals(focused.value);
        await interaction.respond(list);
        return;
      }
      if (interaction.commandName === 'find' && focused.name === 'q') {
        const list = await suggestManuals(focused.value);
        await interaction.respond(list);
        return;
      }
    } catch (e) {
      // ignore
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  try {
    if (interaction.commandName === 'manual') {
      await handleManual(interaction);
    } else if (interaction.commandName === 'find') {
      await handleFind(interaction);
    }
  } catch (e) {
    console.error('[bot] handler error', e);
    if (interaction.isRepliable()) {
      await interaction.reply({ content: 'Sorry, something went wrong.', ephemeral: true }).catch(() => {});
    }
  }
});

function formatRelease(dateVal: unknown, text: string | null | undefined): string {
  if (dateVal instanceof Date) {
    // Format to YYYY-MM-DD
    const y = dateVal.getFullYear();
    const m = String(dateVal.getMonth() + 1).padStart(2, '0');
    const d = String(dateVal.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof dateVal === 'string' && dateVal.trim().length > 0) return dateVal;
  if (typeof text === 'string' && text.trim().length > 0) return text;
  return '—';
}

function formatEmbed(m: Awaited<ReturnType<typeof getManualById>>) {
  if (!m) return null;
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

async function handleManual(interaction: ChatInputCommandInteraction) {
  const qVal = interaction.options.getString('q', true);
  const attachOpt = interaction.options.getBoolean('attach') ?? false;
  // Single visible message containing embed + attachment (if any)
  await interaction.deferReply();
  let id: number | null = null;
  if (/^\d+$/.test(qVal)) id = parseInt(qVal, 10);
  let row = id ? await getManualById(id) : null;
  if (!row) {
    // If user typed arbitrary text instead of picking suggestion, pick best suggestion
    const sug = await suggestManuals(qVal, 1);
    if (sug.length) {
      id = parseInt(sug[0].value, 10);
      row = await getManualById(id);
    }
  }
  if (!row) {
    await interaction.editReply({ content: `No manual found for “${qVal}”.` });
    return;
  }
  const eb = formatEmbed(row);

  // Decide attachment before replying so we can send one combined message
  let abs: string | null = null;
  if (row.pdf_local_path) {
    const relAbs = absFromRel(row.pdf_local_path);
    if (fs.existsSync(relAbs)) {
      abs = relAbs;
    } else {
      // Fallback for legacy absolute/CWD-stored paths
      const legacyAbs = path.isAbsolute(row.pdf_local_path)
        ? row.pdf_local_path
        : path.resolve(row.pdf_local_path);
      if (fs.existsSync(legacyAbs)) abs = legacyAbs;
    }
  }

  if (!abs && (ALWAYS_UPLOAD || attachOpt) && DOWNLOAD_ON_DEMAND && row.pdf_url) {
    try {
      const h = await http.head(row.pdf_url);
      const cl = h.headers['content-length'];
      const size = Array.isArray(cl) ? parseInt(cl[0] || '0', 10) : parseInt((cl as string) || '0', 10);
      if (!Number.isNaN(size) && size > 0 && size <= ATTACH_MAX_BYTES) {
        const tmp = path.join(process.cwd(), '.tmp');
        await fs.promises.mkdir(tmp, { recursive: true });
        const name = `${row.manual_id}.pdf`;
        const out = path.join(tmp, name);
        await http.download(row.pdf_url, tmp, name);
        abs = out;
      }
    } catch {}
  }

  let files: AttachmentBuilder[] | undefined;
  if (abs) {
    const stat = fs.statSync(abs);
    if (stat.size <= ATTACH_MAX_BYTES) {
      const name = path.basename(abs) || `${row.manual_id}.pdf`;
      files = [new AttachmentBuilder(abs, { name })];
    }
  }

  await interaction.editReply({ embeds: eb ? [eb] : [], files });
}

async function handleFind(interaction: ChatInputCommandInteraction) {
  const q = interaction.options.getString('q', true);
  const grade = interaction.options.getString('grade') || undefined;
  const limit = interaction.options.getInteger('limit') || 5;
  await interaction.deferReply({ ephemeral: true });
  const rows = await searchManuals(q, grade, limit);
  if (!rows.length) {
    await interaction.editReply({ content: `No results for “${q}”.` });
    return;
  }
  const lines = rows.map((r) => {
    const name = r.name_en || r.name_jp || `Manual ${r.manual_id}`;
    const pdf = r.pdf_url || `https://manual.bandai-hobby.net/pdf/${r.manual_id}.pdf`;
    const parts = [
      `• ${name} (ID ${r.manual_id}${r.grade ? ` · ${r.grade}` : ''}${r.release_date ? ` · ${r.release_date}` : ''})`,
      `[PDF](${pdf})${r.detail_url ? ` · [Detail](${r.detail_url})` : ''}`
    ];
    return parts.join('\n');
  });
  await interaction.editReply({ content: lines.join('\n\n') });
}

client.login(token);
