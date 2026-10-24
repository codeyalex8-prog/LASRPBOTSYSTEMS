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

// Role IDs allowed to run /challenge.
// Leave [] to allow anyone with the "Manage Server" permission instead.
const ALLOWED_ROLE_IDS = ['1555283780447641620'];

const ENTER_BUTTON_ID = 'challenge_enter';
const ACCENT_COLOUR = 0x2563eb; // the blue stripe on the panel
const LOGO_EMOJI = '<:lasrp:1559999109669191811>';

const MIN_DURATION_MS = 60 * 1000; // 1 minute
const MAX_DURATION_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

const DATA_FILE = path.join(__dirname, '..', 'data', 'challenges.json');

/* ------------------------------------------------------------------ */
/*  Saved challenges                                                   */
/* ------------------------------------------------------------------ */
function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/* ------------------------------------------------------------------ */
/*  Turns "2w", "3d", "1w3d", "12h", "30m" into milliseconds           */
/* ------------------------------------------------------------------ */
function parseDuration(input) {
  const clean = String(input || '').toLowerCase().replace(/\s+/g, '');
  const parts = [...clean.matchAll(/(\d+)([mhdw])/g)];

  // the whole text has to be made of valid chunks
  if (!parts.length || parts.map((p) => p[0]).join('') !== clean) return null;

  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  const total = parts.reduce((sum, p) => sum + Number(p[1]) * unit[p[2]], 0);

  return total >= MIN_DURATION_MS && total <= MAX_DURATION_MS ? total : null;
}

/* ------------------------------------------------------------------ */
/*  The challenge panel                                                */
/* ------------------------------------------------------------------ */
function buildPanel(challenge) {
  const endSeconds = Math.floor(challenge.endsAt / 1000);

  const text =
    `## ${LOGO_EMOJI}┃${challenge.title}\n\n` +
    `${challenge.description}\n\n` +
    `**Participants:** ${challenge.participants.length}\n` +
    (challenge.ended
      ? `**Status:** 🏁 Ended <t:${endSeconds}:R>\n`
      : `**Ends:** <t:${endSeconds}:R> (<t:${endSeconds}:f>)\n`) +
    `**Hosted by:** <@${challenge.hostId}>`;

  return {
    type: 17,
    accent_color: ACCENT_COLOUR,
    components: [
      { type: 10, content: text },
      { type: 14, spacing: 1, divider: true },
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: challenge.ended ? 'Challenge Ended' : 'Enter Challenge',
            custom_id: ENTER_BUTTON_ID,
            disabled: Boolean(challenge.ended),
          },
        ],
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  Someone pressed Enter (called from index.js)                       */
/* ------------------------------------------------------------------ */
async function handleEnter(interaction) {
  const all = load();
  const challenge = all[interaction.message.id];

  if (!challenge) {
    return interaction.reply({
      content: '❌ This challenge isn\'t active any more.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (challenge.ended || Date.now() >= challenge.endsAt) {
    return interaction.reply({
      content: '🏁 This challenge has ended.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (challenge.participants.includes(interaction.user.id)) {
    return interaction.reply({
      content: '✅ You\'ve already entered this challenge!',
      flags: MessageFlags.Ephemeral,
    });
  }

  challenge.participants.push(interaction.user.id);
  save(all);

  // update the panel with the new count (no pings)
  await interaction.update({
    components: [buildPanel(challenge)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
}

/* ------------------------------------------------------------------ */
/*  Ends challenges when their time is up                              */
/* ------------------------------------------------------------------ */
async function checkChallenges(client) {
  const dueIds = Object.entries(load())
    .filter(([, c]) => !c.ended && Date.now() >= c.endsAt)
    .map(([id]) => id);

  for (const messageId of dueIds) {
    // mark it ended straight away so nobody can enter after this point
    const all = load();
    const challenge = all[messageId];
    if (!challenge || challenge.ended) continue;
    challenge.ended = true;
    save(all);

    try {
      const channel = await client.channels.fetch(challenge.channelId);
      const message = await channel.messages.fetch(messageId);

      await message.edit({
        components: [buildPanel(challenge)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });

      await message.reply({
        content: `🏁 The challenge **${challenge.title}** has ended with **${challenge.participants.length}** participant${challenge.participants.length === 1 ? '' : 's'}!`,
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch (err) {
      console.error(`[CHALLENGE] Couldn't finish challenge ${messageId}:`, err.message);
    }
  }
}

function startChallengeTimer(client) {
  setTimeout(() => checkChallenges(client), 5000); // catches any that ended while the bot was off
  setInterval(() => checkChallenges(client), 30 * 1000);
}

/* ------------------------------------------------------------------ */
/*  The /challenge command                                             */
/* ------------------------------------------------------------------ */
module.exports = {
  handleEnter,
  startChallengeTimer,

  data: new SlashCommandBuilder()
    .setName('challenge')
    .setDescription('Start a challenge members can enter')
    .setDMPermission(false)
    .addStringOption((o) =>
      o
        .setName('title')
        .setDescription('The name of the challenge')
        .setRequired(true)
        .setMaxLength(100)
    )
    .addStringOption((o) =>
      o
        .setName('description')
        .setDescription('What the challenge is (type \\n for a new line)')
        .setRequired(true)
        .setMaxLength(1500)
    )
    .addStringOption((o) =>
      o
        .setName('duration')
        .setDescription('How long it runs, e.g. 2w, 3d, 12h, 1w3d')
        .setRequired(true)
    ),

  async execute(interaction) {
    const member = interaction.member;
    const isOwner = interaction.user.id === interaction.guild.ownerId;

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

    const duration = parseDuration(interaction.options.getString('duration'));
    if (!duration) {
      return interaction.reply({
        content:
          '❌ I couldn\'t read that duration. Use something like `30m`, `12h`, `3d`, `2w` or `1w3d` (between 1 minute and 60 days).',
        flags: MessageFlags.Ephemeral,
      });
    }

    const challenge = {
      title: interaction.options.getString('title'),
      description: interaction.options.getString('description').replace(/\\n/g, '\n'),
      hostId: interaction.user.id,
      channelId: interaction.channelId,
      endsAt: Date.now() + duration,
      participants: [],
      ended: false,
    };

    // ---- post it in the channel the command was used in ----
    let message;
    try {
      message = await interaction.channel.send({
        components: [buildPanel(challenge)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      console.error(err);
      return interaction.reply({
        content: `❌ I couldn't post the challenge: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const all = load();
    all[message.id] = challenge;
    save(all);

    return interaction.reply({
      content: '✅ Challenge started.',
      flags: MessageFlags.Ephemeral,
    });
  },
};