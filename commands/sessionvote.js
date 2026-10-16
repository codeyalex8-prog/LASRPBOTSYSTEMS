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
// (the session start then posts in that same channel)
const SESSION_CHANNEL_ID = '';

// Role IDs allowed to use /sessionvote.
// Leave [] to allow anyone with the "Manage Server" permission instead.
const ALLOWED_ROLE_IDS = ['1555283780447641620'];

// The panel posted automatically when the vote passes
const SESSION_START_FILE = path.join(__dirname, '..', 'panels', 'session-start.json');

// Votes are saved here so they survive a bot restart
const DATA_FILE = path.join(__dirname, '..', 'data', 'sessionvotes.json');

const VOTE_BUTTON_ID = 'sessionvote_vote';

const PINGS = '<@&1555281818935103568> <@&1555281551028125836>';
const TOP_IMAGE = 'https://discord-webhook.com/uploads/715e0ce9565184db6e8ffd73c32e42b4.png';
const BOTTOM_IMAGE = 'https://discord-webhook.com/uploads/e51d8ccdc4c282b0d3503b88e6c11c1a.webp';

/* ------------------------------------------------------------------ */
/*  Saved votes                                                        */
/* ------------------------------------------------------------------ */
function loadVotes() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveVotes(votes) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(votes, null, 2));
}

/* ------------------------------------------------------------------ */
/*  The vote panel                                                     */
/* ------------------------------------------------------------------ */
function buildPanel({ votes, target, done }) {
  const text =
    `## Session Vote\n\n${PINGS}\n\n` +
    `It's time to vote for the next **Los Angeles State Roleplay session!**\n\n` +
    `Cast your vote below and let us know whether you'd like a session to be hosted. Your votes help us decide when to get everyone together for some quality roleplay.\n\n` +
    `Please vote honestly, and if you vote yes, try your best to attend!\n\n` +
    `**Let's see how many of you want a session!**\n\n` +
    `**Votes:** ${votes}/${target}` +
    (done ? '\n\n✅ **The vote has passed — the session is starting!**' : '');

  return {
    type: 17,
    components: [
      { type: 12, items: [{ media: { url: TOP_IMAGE } }] },
      { type: 14, spacing: 1, divider: true },
      { type: 10, content: text },
      { type: 14, spacing: 1, divider: true },
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: done ? 'Vote Complete' : 'Vote',
            custom_id: VOTE_BUTTON_ID,
            disabled: done,
          },
        ],
      },
      { type: 14, spacing: 1, divider: true },
      { type: 12, items: [{ media: { url: BOTTOM_IMAGE } }] },
      { type: 14, spacing: 1, divider: true },
    ],
  };
}

// posts your Session Starting panel (with the pings)
async function postSessionStart(channel) {
  let json;
  try {
    json = JSON.parse(fs.readFileSync(SESSION_START_FILE, 'utf8'));
  } catch (err) {
    console.error('[SESSION VOTE] Couldn\'t load panels/session-start.json:', err.message);
    return channel
      .send({
        content: `${PINGS}\n✅ The vote passed — a session is now starting!`,
        allowedMentions: { parse: ['roles'] },
      })
      .catch(console.error);
  }

  const components = Array.isArray(json)
    ? json
    : json.components
    ? json.components
    : [json];

  return channel
    .send({
      components,
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: ['roles'] },
    })
    .catch(console.error);
}

/* ------------------------------------------------------------------ */
/*  Someone clicked the Vote button (called from index.js)             */
/* ------------------------------------------------------------------ */
async function handleVote(interaction) {
  const votes = loadVotes();
  const state = votes[interaction.message.id];

  if (!state) {
    return interaction.reply({
      content: '❌ This vote isn\'t active any more.',
      flags: MessageFlags.Ephemeral,
    });
  }
  if (state.done) {
    return interaction.reply({
      content: '✅ This vote has already passed.',
      flags: MessageFlags.Ephemeral,
    });
  }
  if (state.voters.includes(interaction.user.id)) {
    return interaction.reply({
      content: '✅ You\'ve already voted!',
      flags: MessageFlags.Ephemeral,
    });
  }

  // count the vote
  state.voters.push(interaction.user.id);
  const count = state.voters.length;
  const reached = count >= state.target;
  if (reached) state.done = true;
  saveVotes(votes);

  // update the panel (no new pings on an update)
  await interaction.update({
    components: [buildPanel({ votes: count, target: state.target, done: reached })],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });

  // vote passed -> start the session automatically (in the same channel as the vote)
  if (reached) {
    await postSessionStart(interaction.channel);
  }
}

/* ------------------------------------------------------------------ */
/*  The /sessionvote command                                           */
/* ------------------------------------------------------------------ */
module.exports = {
  VOTE_BUTTON_ID,
  handleVote,

  data: new SlashCommandBuilder()
    .setName('sessionvote')
    .setDescription('Start a vote for a session')
    .setDMPermission(false)
    .addIntegerOption((o) =>
      o
        .setName('votes')
        .setDescription('How many votes are needed to start the session')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(500)
    ),

  async execute(interaction) {
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

    const target = interaction.options.getInteger('votes');

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

    // ---- post the vote ----
    let message;
    try {
      message = await channel.send({
        components: [buildPanel({ votes: 0, target, done: false })],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: ['roles'] },
      });
    } catch (err) {
      console.error(err);
      return interaction.reply({
        content: `❌ I couldn't post the vote: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // remember this vote
    const votes = loadVotes();
    votes[message.id] = { target, voters: [], done: false };
    saveVotes(votes);

    return interaction.reply({
      content: `✅ Vote started in ${channel} — the session starts at **${target}** votes.${note}`,
      flags: MessageFlags.Ephemeral,
    });
  },
};