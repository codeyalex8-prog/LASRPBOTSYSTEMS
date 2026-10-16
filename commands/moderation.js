
const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const LOG_CHANNEL_ID = '1555603979432624188';

const ROLE_ACCESS = {
  mute: ['1555283780447641620'],
  warn: ['1555283780447641620'],
  kick: ['1555283780447641620'],
  ban: ['1555279476949258320'],
  gban: ['1555279476949258320'],
  ipban: ['1555279476949258320'],
  softban: ['1555279476949258320'],
};

const COOLDOWN_MS = 60_000;
const cooldowns = new Map();

function parseDuration(input) {
  const match = /^(\d+)(s|m|h|d)$/i.exec(input || '');
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  }[unit];

  const result = amount * multiplier;
  return result > 0 && result <= 28 * 86_400_000 ? result : null;
}

function formatDuration(ms) {
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000} day(s)`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000} hour(s)`;
  if (ms % 60_000 === 0) return `${ms / 60_000} minute(s)`;
  return `${ms / 1000} second(s)`;
}

function getCooldown(userId, commandName) {
  const key = `${userId}:${commandName}`;
  const expires = cooldowns.get(key) || 0;
  const now = Date.now();

  if (expires > now) return Math.ceil((expires - now) / 1000);

  cooldowns.set(key, now + COOLDOWN_MS);
  return 0;
}

function hasAccess(member, commandName) {
  return ROLE_ACCESS[commandName]?.some((roleId) =>
    member.roles.cache.has(roleId)
  );
}

async function resolveUser(guild, input) {
  if (!input) return null;

  const id = input.match(/^<@!?(\d+)>$/)?.[1] ||
    (/^\d{17,20}$/.test(input) ? input : null);

  if (id) {
    try {
      return await guild.client.users.fetch(id);
    } catch {
      return null;
    }
  }

  const query = input.toLowerCase().replace(/^@/, '');
  const members = await guild.members.fetch().catch(() => null);
  if (!members) return null;

  const member = members.find((m) =>
    m.user.username.toLowerCase() === query ||
    m.user.tag.toLowerCase() === query ||
    m.displayName.toLowerCase() === query
  );

  return member?.user || null;
}

async function getTargetMember(guild, user) {
  if (!user) return null;
  return guild.members.fetch(user.id).catch(() => null);
}

function getReason(reason) {
  return (reason || 'No reason provided').slice(0, 450);
}

async function sendLog(client, embed) {
  const channel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);

  if (!channel || !channel.isTextBased() || !channel.send) {
    console.error(`Moderation log channel ${LOG_CHANNEL_ID} is unavailable.`);
    return;
  }

  await channel.send({ embeds: [embed] }).catch((error) => {
    console.error('Could not send moderation log:', error);
  });
}

function createLogEmbed(action, moderator, target, reason, extra = '') {
  return new EmbedBuilder()
    .setTitle(`Moderation | ${action}`)
    .setDescription(
      `**Moderator:** ${moderator}\n` +
      `**Target:** ${target.tag || target.username} (\`${target.id}\`)\n` +
      `**Reason:** ${reason}` +
      (extra ? `\n${extra}` : '')
    )
    .setTimestamp()
    .setFooter({ text: 'Los Angeles State Roleplay' });
}

async function publicConfirmation(context, action, target, reason, extra = '') {
  const embed = new EmbedBuilder()
    .setTitle(`Moderation Action | ${action}`)
    .setDescription(
      `**Moderator:** ${context.moderator}\n` +
      `**Target:** ${target.tag || target.username} (\`${target.id}\`)\n` +
      `**Reason:** ${reason}` +
      (extra ? `\n${extra}` : '')
    )
    .setTimestamp()
    .setFooter({ text: 'Los Angeles State Roleplay' });

  if (context.interaction) {
    await context.interaction.reply({ embeds: [embed] });
  } else {
    await context.message.channel.send({ embeds: [embed] });
  }
}

async function performCommand({
  client,
  guild,
  moderator,
  moderatorMember,
  commandName,
  targetInput,
  durationInput,
  reasonInput,
  interaction,
  message,
}) {
  if (!guild || !moderatorMember) {
    const text = 'This command can only be used inside a server.';
    if (interaction) return interaction.reply({ content: text, ephemeral: true });
    return message.reply(text);
  }

  if (!hasAccess(moderatorMember, commandName)) {
    const text = 'You do not have the required role to use this command.';
    if (interaction) return interaction.reply({ content: text, ephemeral: true });
    return message.reply(text);
  }

  const remaining = getCooldown(moderator.id, commandName);
  if (remaining > 0) {
    const text = `Please wait **${remaining} seconds** before using \`${commandName}\` again.`;
    if (interaction) return interaction.reply({ content: text, ephemeral: true });
    return message.reply(text);
  }

  // IP banning is not supported by Discord's bot API.
  if (commandName === 'ipban') {
    const text =
      'Discord does not provide bots with IP addresses or an IP-ban feature. Use `ban` or `gban` to ban the Discord account instead.';
    if (interaction) return interaction.reply({ content: text });
    return message.channel.send(text);
  }

  const user = await resolveUser(guild, targetInput);
  if (!user) {
    const text = 'I could not find that user. Try a mention, username, or Discord ID.';
    if (interaction) return interaction.reply({ content: text, ephemeral: true });
    return message.reply(text);
  }

  if (user.id === moderator.id) {
    const text = 'You cannot moderate yourself.';
    if (interaction) return interaction.reply({ content: text, ephemeral: true });
    return message.reply(text);
  }

  if (user.id === client.user.id) {
    const text = 'You cannot moderate the bot.';
    if (interaction) return interaction.reply({ content: text, ephemeral: true });
    return message.reply(text);
  }

  const targetMember = await getTargetMember(guild, user);
  const reason = getReason(reasonInput);
  let actionLabel = commandName;
  let extra = '';

  try {
    if (['mute', 'kick', 'softban'].includes(commandName) && !targetMember) {
      const text = 'That user must be a member of this server for this action.';
      if (interaction) return interaction.reply({ content: text, ephemeral: true });
      return message.reply(text);
    }

    if (targetMember && moderatorMember.roles.highest.comparePositionTo(targetMember.roles.highest) <= 0 &&
        guild.ownerId !== moderator.id) {
      const text = 'You cannot moderate a member with an equal or higher role than yours.';
      if (interaction) return interaction.reply({ content: text, ephemeral: true });
      return message.reply(text);
    }

    if (commandName === 'mute') {
      const duration = parseDuration(durationInput || '10m');
      if (!duration) {
        const text = 'Invalid duration. Use formats like `30s`, `10m`, `2h`, or `1d` (maximum 28 days).';
        if (interaction) return interaction.reply({ content: text, ephemeral: true });
        return message.reply(text);
      }

      await targetMember.timeout(duration, reason);
      extra = `**Duration:** ${formatDuration(duration)}`;
      actionLabel = 'Mute';
    } else if (commandName === 'warn') {
      await user.send(
        `You have received a warning in **${guild.name}**.\nReason: ${reason}`
      ).catch(() => {});
      actionLabel = 'Warn';
    } else if (commandName === 'kick') {
      await targetMember.kick(reason);
      actionLabel = 'Kick';
    } else if (commandName === 'ban') {
      await guild.members.ban(user.id, { reason });
      actionLabel = 'Ban';
    } else if (commandName === 'softban') {
      await guild.members.ban(user.id, {
        reason: `Softban: ${reason}`,
        deleteMessageSeconds: 7 * 24 * 60 * 60,
      });
      await guild.members.unban(user.id, `Softban completed: ${reason}`);
      actionLabel = 'Softban';
      extra = 'Recent messages were deleted where Discord permits.';
    } else if (commandName === 'gban') {
      await (interaction || message).deferReply?.({ ephemeral: true }).catch(() => {});

      let succeeded = 0;
      let failed = 0;

      for (const server of client.guilds.cache.values()) {
        try {
          if (server.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) {
            await server.members.ban(user.id, { reason: `Global ban by ${moderator.tag}: ${reason}` });
            succeeded++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }

      extra = `**Servers banned:** ${succeeded}\n**Servers failed/skipped:** ${failed}`;
      actionLabel = 'Global Ban';
    }

    const embed = createLogEmbed(actionLabel, moderator, user, reason, extra);
    await sendLog(client, embed);

    const context = {
      moderator: `<@${moderator.id}>`,
      interaction: interaction && commandName !== 'gban' ? interaction : null,
      message,
    };

    // gban already deferred its interaction above; edit that response, then also post publicly.
    if (commandName === 'gban' && interaction) {
      const publicEmbed = new EmbedBuilder()
        .setTitle('Moderation Action | Global Ban')
        .setDescription(
          `**Moderator:** <@${moderator.id}>\n` +
          `**Target:** ${user.tag} (\`${user.id}\`)\n` +
          `**Reason:** ${reason}\n${extra}`
        )
        .setTimestamp();

      await interaction.channel.send({ embeds: [publicEmbed] });
      await interaction.editReply('Global ban completed. Results have been posted publicly.');
    } else {
      await publicConfirmation(context, actionLabel, user, reason, extra);
    }
  } catch (error) {
    console.error(`[MODERATION: ${commandName}]`, error);

    const text =
      'The action failed. Check that the bot has the required permission and that its role is above the target.';
    if (interaction && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: text, ephemeral: true }).catch(() => {});
    } else if (message) {
      await message.reply(text).catch(() => {});
    } else if (interaction?.deferred) {
      await interaction.editReply(text).catch(() => {});
    }
  }
}

function makeCommand(name, description, options = []) {
  const data = new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setDMPermission(false);

  for (const option of options) data.addStringOption(option);

  return {
    data,
    async execute(interaction) {
      const commandName = name;
      const targetInput = interaction.options.getString('user');
      const durationInput = interaction.options.getString('duration');
      const reasonInput = interaction.options.getString('reason');

      await performCommand({
        client: interaction.client,
        guild: interaction.guild,
        moderator: interaction.user,
        moderatorMember: interaction.member,
        commandName,
        targetInput,
        durationInput,
        reasonInput,
        interaction,
      });
    },
  };
}

const userOption = (required = true) => (option) =>
  option.setName('user')
    .setDescription('User mention, username, or Discord ID')
    .setRequired(required);

const durationOption = () => (option) =>
  option.setName('duration')
    .setDescription('Duration: 30s, 10m, 2h, or 1d')
    .setRequired(false);

const reasonOption = () => (option) =>
  option.setName('reason')
    .setDescription('Reason for this action')
    .setRequired(false);

const commands = [
  makeCommand('mute', 'Timeout a member', [
    userOption(),
    durationOption(),
    reasonOption(),
  ]),
  makeCommand('warn', 'Warn a user', [
    userOption(),
    reasonOption(),
  ]),
  makeCommand('kick', 'Kick a member', [
    userOption(),
    reasonOption(),
  ]),
  makeCommand('ban', 'Ban a Discord account from this server', [
    userOption(),
    reasonOption(),
  ]),
  makeCommand('gban', 'Ban a Discord account across servers the bot can moderate', [
    userOption(),
    reasonOption(),
  ]),
  makeCommand('ipban', 'Explain Discord IP-ban limitations', [
    userOption(),
    reasonOption(),
  ]),
  makeCommand('softban', 'Ban and unban a member, deleting recent messages', [
    userOption(),
    reasonOption(),
  ]),
];

async function executePrefix(message, commandName, args, client) {
  const targetInput = args[0];
  let durationInput;
  let reasonInput;

  if (commandName === 'mute') {
    if (args[1] && parseDuration(args[1])) {
      durationInput = args[1];
      reasonInput = args.slice(2).join(' ');
    } else {
      durationInput = '10m';
      reasonInput = args.slice(1).join(' ');
    }
  } else {
    reasonInput = args.slice(1).join(' ');
  }

  await performCommand({
    client,
    guild: message.guild,
    moderator: message.author,
    moderatorMember: message.member,
    commandName,
    targetInput,
    durationInput,
    reasonInput,
    message,
  });
}

module.exports = { commands, executePrefix };
