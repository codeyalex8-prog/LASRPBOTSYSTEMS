const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('claim')
    .setDescription('Claim this ticket')
    .setDMPermission(false),

  async execute(interaction) {
    return interaction.client.ticketActions.claim(interaction);
  },
};