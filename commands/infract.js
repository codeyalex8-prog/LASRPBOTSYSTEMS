const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');

/* ------------------------------------------------------------------ */
/*  SETTINGS                                                           */
/* ------------------------------------------------------------------ */

// Channel where infraction records get posted
const INFRACTION_CHANNEL_ID = '1555602530799456316';

// Only members with one of these roles can use /infract
const ALLOWED_ROLE_IDS = ['1555283780447641620'];

// Your punishments - each one must match a role name in your server
const PUNISHMENTS = [
  'Warning 1',
  'Warning 2',
  'Strike 1',
  'Strike 2',
  'Staff Blacklist',
  'Ticket Blacklist',
  'Demotion',
  'Suspended',
  'Under Investigation',
  'Zero Tolerance Policy',
  'Terminated',
];

// These punishments remove ALL of the person's other roles...
const STRIP_ROLES_FOR = ['Suspended', 'Terminated', 'Staff Blacklist', 'Under Investigation'];

// ...except roles whose name contains any of these (not case sensitive)
const KEEP_ROLE_NAME_CONTAINS = ['community member', 'ping'];

/* ------------------------------------------------------------------ */
/*  Your panel (placeholders get filled in automatically)              */
/* ------------------------------------------------------------------ */
const PANEL = {
  type: 17,
  components: [
    {
      type: 12,
      items: [
        {
          media: {
            url: 'https://discord-webhook.com/uploads/2f3dde6442f85ee621e687505222e298.webp',
          },
        },
      ],
    },
    { type: 14, spacing: 1, divider: true },
    {
      type: 10,
      content:
        '## <:lasrp:1559999109669191811>┃Infraction Record\n**Member:** {user}\n**Issued By:** {staff}\n**Infraction Type:** {infraction_type}\n**Reason:** {reason}\n**Appealable:** {appealable}',
    },
    { type: 14, spacing: 1, divider: true },
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
    { type: 14, spacing: 1, divider: true },
  ],
};

// replaces {placeholders} in every piece of text (never touches URLs)
function fill(node, values) {
  if (typeof node === 'string') {
    let out = node;
    for (const [key, val] of Object.entries(values)) out = out.split(key).join(val);
    return out;
  }
  if (Array.isArray(node)) return node.map((n) => fill(n, values));
  if (node && typeof node === 'object') {
    const copy = {};
    for (const [k, v] of Object.entries(node)) {
      copy[k] = k === 'url' ? v : fill(v, values);
    }
    return copy;
  }
  return node;
}

function findRole(guild, name) {
  const wanted = name.toLowerCase().trim();
  return (
    guild.roles.cache.find((r) => r.name.toLowerCase().trim() === wanted) ||
    guild.roles.cache.find((r) => r.name.toLowerCase().includes(wanted))
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('infract')
    .setDescription('Issue an infraction to a member')
    .setDMPermission(false)
    .addUserOption((o) =>
      o.setName('user').setDescription('Who is being infracted').setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName('punishment')
        .setDescription('The infraction type')
        .setRequired(true)
        .addChoices(...PUNISHMENTS.map((p) => ({ name: p, value: p })))
    )
    .addStringOption((o) =>
      o
        .setName('reason')
        .setDescription('Why they are being infracted')
        .setRequired(true)
        .setMaxLength(1000)
    )
    .addStringOption((o) =>
      o
        .setName('appealable')
        .setDescription('Can this infraction be appealed?')
        .setRequired(true)
        .addChoices({ name: 'Yes', value: 'Yes' }, { name: 'No', value: 'No' })
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    const executor = interaction.member;
    const isOwner = interaction.user.id === guild.ownerId;

    // ---- who may use this command ----
    const canUse =
      isOwner ||
      (ALLOWED_ROLE_IDS.length
        ? ALLOWED_ROLE_IDS.some((id) => executor.roles.cache.has(id))
        : executor.permissions.has(PermissionFlagsBits.ManageRoles));
    if (!canUse) {
      return interaction.editReply('❌ You don\'t have permission to use this command.');
    }

    const targetUser = interaction.options.getUser('user');
    const punishment = interaction.options.getString('punishment');
    const reason = interaction.options.getString('reason');
    const appealable = interaction.options.getString('appealable');

    // ---- basic checks ----
    if (targetUser.bot) return interaction.editReply('❌ You can\'t infract a bot.');
    if (targetUser.id === interaction.user.id) {
      return interaction.editReply('❌ You can\'t infract yourself.');
    }

    let target;
    try {
      target = await guild.members.fetch(targetUser.id);
    } catch {
      return interaction.editReply('❌ That user isn\'t in this server.');
    }
    if (target.id === guild.ownerId) {
      return interaction.editReply('❌ You can\'t infract the server owner.');
    }

    // ---- hierarchy: you can only infract people ranked BELOW you ----
    if (!isOwner && executor.roles.highest.position <= target.roles.highest.position) {
      return interaction.editReply(
        '❌ You can only infract members ranked below you. They are the same rank as you or higher.'
      );
    }

    // ---- the bot must be able to manage them too ----
    const me = guild.members.me;
    if (me.roles.highest.position <= target.roles.highest.position) {
      return interaction.editReply(
        '❌ I can\'t manage that member because their highest role is above (or the same as) mine. Move my bot role higher in Server Settings → Roles.'
      );
    }

    // ---- roles ----
    await guild.roles.fetch();
    const punishRole = findRole(guild, punishment);
    const notes = [];
    let removedCount = 0;

    // strip roles for the serious punishments
    if (STRIP_ROLES_FOR.includes(punishment)) {
      const candidates = target.roles.cache.filter(
        (r) =>
          r.id !== guild.id && // @everyone
          !r.managed && // bot / booster roles can't be removed
          (!punishRole || r.id !== punishRole.id) &&
          !KEEP_ROLE_NAME_CONTAINS.some((k) => r.name.toLowerCase().includes(k))
      );

      const removable = candidates.filter((r) => r.editable);
      const skipped = candidates.filter((r) => !r.editable);

      if (removable.size) {
        try {
          await target.roles.remove(
            [...removable.keys()],
            `${punishment} issued by ${interaction.user.tag}`
          );
          removedCount = removable.size;
        } catch (err) {
          console.error(err);
          notes.push('⚠️ I couldn\'t remove their roles. Check that I have **Manage Roles**.');
        }
      }
      if (skipped.size) {
        notes.push(
          `⚠️ I couldn't remove these roles (they're above my role): ${skipped
            .map((r) => r.name)
            .join(', ')}`
        );
      }
    }

    // add the punishment role
    let roleAdded = false;
    if (!punishRole) {
      notes.push(`⚠️ There's no role named **${punishment}**, so no role was added.`);
    } else if (!punishRole.editable) {
      notes.push(
        `⚠️ I couldn't add **${punishRole.name}** because it's above my role. Move my bot role higher.`
      );
    } else {
      try {
        await target.roles.add(punishRole, `${punishment} issued by ${interaction.user.tag}`);
        roleAdded = true;
      } catch (err) {
        console.error(err);
        notes.push(`⚠️ I couldn't add **${punishRole.name}**.`);
      }
    }

    // ---- post the record ----
    let channel = interaction.channel;
    if (INFRACTION_CHANNEL_ID) {
      try {
        channel = await guild.channels.fetch(INFRACTION_CHANNEL_ID);
      } catch {
        notes.push('⚠️ I couldn\'t find the infraction channel, so I posted it here instead.');
      }
    }

    const panel = fill(PANEL, {
      '{user}': `<@${target.id}>`,
      '{staff}': `<@${interaction.user.id}>`,
      '{infraction_type}': punishment,
      '{reason}': reason,
      '{appealable}': appealable,
    });

    try {
      await channel.send({
        components: [panel],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { users: [target.id] },
      });
    } catch (err) {
      console.error(err);
      notes.push('⚠️ I couldn\'t post the infraction record. Check that I can send messages there.');
    }

    // ---- private summary for the staff member ----
    const lines = [`✅ **${punishment}** issued to ${target}.`];
    if (roleAdded) lines.push(`• Added the **${punishRole.name}** role.`);
    if (removedCount) lines.push(`• Removed **${removedCount}** role(s).`);
    lines.push(...notes);

    return interaction.editReply({
      content: lines.join('\n'),
      allowedMentions: { parse: [] },
    });
  },
};