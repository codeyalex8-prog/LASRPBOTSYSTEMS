const fs = require('fs');
const path = require('path');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');

/* ------------------------------------------------------------------ */
/*  SETTINGS                                                           */
/* ------------------------------------------------------------------ */

// '' = post in whatever channel the command is used in
const SESSION_CHANNEL_ID = '';

// Role IDs allowed to use /session end.
// Leave [] to allow anyone with the "Manage Server" permission instead.
const ALLOWED_ROLE_IDS = ['1555283780447641620'];

// The panel that gets posted
const PANEL_FILE = path.join(__dirname, '..', 'panels', 'session-end.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('session')
    .setDescription('Session commands')
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub.setName('end').setDescription('Announce that the session has ended')
    ),

  async execute(interaction) {
    if (interaction.options.getSubcommand() !== 'end') return;

    const guild = interaction.guild;
    const member = interaction.member;
    const isOwner = interaction.user.id === guild.ownerId;

    // ---- who may use this command ----
    const canUse =
      isOwner ||
      (ALLOWED_ROLE_IDS.length
        ? ALLOWED_ROLE_IDS.some((id) => member.roles.cache.has(id))
        : member.permissions.has(PermissionFlagsBits.ManageGuild));

    if (!canUse) {
      return interaction.reply({
        content: '❌ You don\'t have permission to use this command.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // ---- load the panel ----
    let json;
    try {
      json = JSON.parse(fs.readFileSync(PANEL_FILE, 'utf8'));
    } catch (err) {
      return interaction.reply({
        content: `❌ Couldn't load \`panels/session-end.json\`: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // accepts [ ...components ], { components: [...] }, or a single component
    const components = Array.isArray(json)
      ? json
      : json.components
      ? json.components
      : [json];

    // ---- pick the channel ----
    let channel = interaction.channel;
    let note = '';
    if (SESSION_CHANNEL_ID) {
      try {
        channel = await guild.channels.fetch(SESSION_CHANNEL_ID);
      } catch {
        note = '\n⚠️ I couldn\'t find that channel, so I posted it here instead.';
      }
    }

    // ---- send it (no pings at all) ----
    try {
      await channel.send({
        components,
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      console.error(err);
      return interaction.reply({
        content: `❌ I couldn't post the session ended panel: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // only the person who ran it sees this
    return interaction.reply({
      content: `✅ Session ended posted in ${channel}.${note}`,
      flags: MessageFlags.Ephemeral,
    });
  },
};