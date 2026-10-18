const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');

const { isEnabled, setEnabled, OWNER_ID } = require('../src/utils/pingGuard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pingguard')
    .setDescription('Turn the ping guard on or off')
    .setDMPermission(false)
    // hides the command from everyone except admins (the code below also checks it's you)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub.setName('on').setDescription('Turn the ping guard on')
    )
    .addSubcommand((sub) =>
      sub.setName('off').setDescription('Turn the ping guard off')
    )
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('Check if the ping guard is on or off')
    ),

  async execute(interaction) {
    // only the owner can use this
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({
        content: '❌ Only the owner can use this command.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'on') {
      setEnabled(true);
      return interaction.reply({
        content:
          '✅ Ping guard is now **ON**. Anyone who pings you will be asked what they need, and you\'ll get a DM.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'off') {
      setEnabled(false);
      return interaction.reply({
        content:
          '⏸️ Ping guard is now **OFF**. Pings go through normally. Turn it back on with `/pingguard on`.',
        flags: MessageFlags.Ephemeral,
      });
    }

    return interaction.reply({
      content: isEnabled()
        ? '✅ Ping guard is currently **ON**.'
        : '⏸️ Ping guard is currently **OFF**.',
      flags: MessageFlags.Ephemeral,
    });
  },
};