const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unclaim')
    .setDescription('Unclaim this ticket so it can be claimed again')
    .setDMPermission(false),

  async execute(interaction) {
    return interaction.client.ticketActions.unclaim(interaction);
  },
};