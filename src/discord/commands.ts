import { SlashCommandBuilder } from 'discord.js';

export const manualCmd = new SlashCommandBuilder()
  .setName('manual')
  .setDescription('Get a manual by name or ID with suggestions')
  .addStringOption((opt) =>
    opt
      .setName('q')
      .setDescription('Type to search (grade + name). Choose suggestion.')
      .setAutocomplete(true)
      .setRequired(true)
  )
  .addBooleanOption((opt) => opt.setName('attach').setDescription('Upload PDF if available'));

export const findCmd = new SlashCommandBuilder()
  .setName('find')
  .setDescription('Search manuals by name')
  .addStringOption((opt) => opt.setName('q').setDescription('Search text').setAutocomplete(true).setRequired(true))
  .addStringOption((opt) => opt.setName('grade').setDescription('Filter by grade (e.g., HG, MG)'))
  .addIntegerOption((opt) => opt.setName('limit').setDescription('Max results (default 5)'));

export const commands = [manualCmd, findCmd];
export const commandsJson = commands.map((c) => c.toJSON());
