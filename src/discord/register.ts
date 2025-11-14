#!/usr/bin/env node
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commandsJson } from './commands.js';

const token = process.env.DISCORD_TOKEN || process.env.BOT_TOKEN;
const appId = process.env.DISCORD_APP_ID || process.env.APP_ID;
const guildId = process.env.DISCORD_GUILD_ID || process.env.GUILD_ID;

if (!token || !appId) {
  console.error('Missing DISCORD_TOKEN or DISCORD_APP_ID');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function main() {
  if (guildId) {
    const data = (await rest.put(Routes.applicationGuildCommands(appId, guildId), {
      body: commandsJson
    })) as unknown[];
    console.log(`[register] registered ${data.length} guild commands to ${guildId}`);
  } else {
    const data = (await rest.put(Routes.applicationCommands(appId), { body: commandsJson })) as unknown[];
    console.log(`[register] registered ${data.length} global commands (may take up to 1 hour to propagate)`);
  }
}

main().catch((e) => {
  console.error('[register] failed', e);
  process.exit(1);
});

