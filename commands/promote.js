
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');

const PROMOTION_CHANNEL_ID = '1555602508213129337';

// Same authorised staff role as your /infract command
const ALLOWED_ROLE_IDS = ['1555283780447641620'];

const PANEL = {
  type: 17,
  components: [
    {
      type: 12,
      items: [
        {
          media: {
            url: 'https://discord-webhook.com/uploads/7677c0036c1e939d6902b42f9d81f3a7.webp',
          },
        },
      ],
    },
    {
      type: 14,
      spacing: 1,
      divider: true,
    },
    {
      type: 10,
      content:
        '## <:lasrp:1559999109669191811>┃Staff Promotion Record\n' +
        '**Member:** {user}\n' +
        '**Promoted By:** {staff}\n' +
        '**Previous Rank:** {previous_rank}\n' +
        '**New Rank:** {new_rank}\n' +
        '**Reason:** {reason}',
    },
    {
      type: 14,
      spacing: 1,
      divider: true,
    },
    {
      type: 12,
      items: [
        {
          media: {
            url: 'https://discord-webhook.com/uploads/e51d8ccdc4c282b0d3503b88e6c11c1a.webp',
          },
        },
      ],
    },
    {
      type: 14,
      spacing: 1,
      divider: true,
    },
  ],
};

function fill(node, values) {
  if (typeof node === 'string') {
    let output = node;

    for (const [key, value] of Object.entries(values)) {
      output = output.split(key).join(value);
    }

    return output;
  }

  if (Array.isArray(node)) {
    return node.map((item) => fill(item, values));
  }

  if (node && typeof node === 'object') {
    const copy = {};

    for (const [key, value] of Object.entries(node)) {
      copy[key] =
        key === 'url' ? value : fill(value, values);
    }

    return copy;
  }

  return node;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Promote a member to a new rank')
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The member being promoted')
        .setRequired(true)
    )
    .addRoleOption((option) =>
      option
        .setName('rank')
        .setDescription('The rank to assign')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('The reason for the promotion')
        .setRequired(true)
        .setMaxLength(1000)
    ),

  async execute(interaction) {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    const guild = interaction.guild;
    const executor = await guild.members.fetch(interaction.user.id);
    const isOwner = interaction.user.id === guild.ownerId;

    // Permission check
    const canUse =
      isOwner ||
      ALLOWED_ROLE_IDS.some((id) =>
        executor.roles.cache.has(id)
      ) ||
      executor.permissions.has(
        PermissionFlagsBits.Administrator
      );

    if (!canUse) {
      return interaction.editReply(
        '❌ You do not have permission to use this command.'
      );
    }

    const targetUser = interaction.options.getUser('user');
    const rank = interaction.options.getRole('rank');
    const reason = interaction.options.getString('reason');

    // Basic validation
    if (targetUser.bot) {
      return interaction.editReply(
        '❌ You cannot promote a bot.'
      );
    }

    if (targetUser.id === interaction.user.id) {
      return interaction.editReply(
        '❌ You cannot promote yourself.'
      );
    }

    let target;

    try {
      target = await guild.members.fetch(targetUser.id);
    } catch {
      return interaction.editReply(
        '❌ That member is not in this server.'
      );
    }

    if (target.id === guild.ownerId) {
      return interaction.editReply(
        '❌ You cannot promote the server owner.'
      );
    }

    if (rank.id === guild.id || rank.managed) {
      return interaction.editReply(
        '❌ That role cannot be assigned as a promotion rank.'
      );
    }

    // The bot cannot assign roles above or equal to its highest role
    const botMember = guild.members.me;

    if (
      !botMember ||
      !rank.editable
    ) {
      return interaction.editReply(
        '❌ I cannot assign that rank. Move my bot role above the requested rank in Server Settings → Roles.'
      );
    }

    // Staff cannot promote members who are equal or higher in hierarchy
    if (
      !isOwner &&
      executor.roles.highest.position <= target.roles.highest.position
    ) {
      return interaction.editReply(
        '❌ You can only promote members ranked below you.'
      );
    }

    // Staff cannot assign a rank equal to or above their own highest role
    if (
      !isOwner &&
      executor.roles.highest.position <= rank.position
    ) {
      return interaction.editReply(
        '❌ You cannot assign a rank equal to or higher than your own highest role.'
      );
    }

    // Prevent duplicate promotions
    if (target.roles.cache.has(rank.id)) {
      return interaction.editReply(
        '❌ That member already has this rank.'
      );
    }

    // Capture the previous highest role before promotion
    const previousRank = target.roles.highest.name;

    // Add the new role WITHOUT removing any existing roles
    try {
      await target.roles.add(
        rank,
        `Promoted by ${interaction.user.tag}: ${reason}`
      );
    } catch (error) {
      console.error('Promotion role assignment failed:', error);

      return interaction.editReply(
        '❌ I could not assign that rank. Check my Manage Roles permission and role hierarchy.'
      );
    }

    // Send promotion record to the designated channel
    let logChannel;

    try {
      logChannel = await guild.channels.fetch(
        PROMOTION_CHANNEL_ID
      );
    } catch {
      logChannel = null;
    }

    if (!logChannel || !logChannel.isTextBased()) {
      return interaction.editReply(
        `⚠️ ${target} has been promoted to **${rank.name}**, but I could not find the promotion log channel. Check channel ID ${PROMOTION_CHANNEL_ID}.`
      );
    }

    const panel = fill(PANEL, {
      '{user}': `<@${target.id}>`,
      '{staff}': `<@${interaction.user.id}>`,
      '{previous_rank}': previousRank,
      '{new_rank}': rank.name,
      '{reason}': reason,
    });

    try {
      await logChannel.send({
        components: [panel],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: {
          users: [target.id, interaction.user.id],
        },
      });
    } catch (error) {
      console.error('Promotion logging failed:', error);

      return interaction.editReply(
        `⚠️ ${target} has been promoted to **${rank.name}**, but I could not post the promotion record. Check the bot's channel permissions.`
      );
    }

    return interaction.editReply({
      content:
        `✅ Successfully promoted ${target} to **${rank.name}**.\n` +
        `**Previous Rank:** ${previousRank}\n` +
        `**New Rank:** ${rank.name}\n` +
        `**Promotion Log:** <#${PROMOTION_CHANNEL_ID}>`,
      allowedMentions: { parse: [] },
    });
  },
};
