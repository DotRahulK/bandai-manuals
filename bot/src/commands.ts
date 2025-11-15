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

export const commands = [manualCmd];
export const commandsJson = commands.map((c) => c.toJSON());
