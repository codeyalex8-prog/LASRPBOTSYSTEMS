const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hold')
    .setDescription('Put this ticket on hold')
    .setDMPermission(false),

  async execute(interaction) {
    return interaction.client.ticketActions.hold(interaction);
  },
};