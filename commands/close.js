const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('close')
    .setDescription('Close this ticket')
    .setDMPermission(false),

  async execute(interaction) {
    return interaction.client.ticketActions.close(interaction);
  },
};