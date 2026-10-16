
const {
  SlashCommandBuilder,
  MessageFlags,
} = require('discord.js');

const API_KEY = process.env.ERLC_API_KEY;
const CHANNEL_ID = process.env.SERVER_INFO_CHANNEL_ID;
const UPDATE_INTERVAL = 30_000;

const STAFF_ROLE_IDS = [
  '1555279470758199377',
  '1555279475585974395',
  '1555283780447641620',
  '1555593610370748469',
];

const HEADER_IMAGE =
  'https://discord-webhook.com/uploads/10b7d090190e33aab5dead1b77a60e23.png';

const FOOTER_IMAGE =
  'https://discord-webhook.com/uploads/e51d8ccdc4c282b0d3503b88e6c11c1a.webp';

const PANEL_TITLE =
  'Los Angeles State Roleplay Server Information';

function safe(value) {
  return String(value ?? 'Unavailable')
    .replace(/[`*_~|]/g, '')
    .replace(/@/g, '@\u200b')
    .slice(0, 200);
}

async function fetchERLCServer() {
  if (!API_KEY) {
    throw new Error('ERLC_API_KEY is missing from .env');
  }

  const response = await fetch('https://api.erlc.gg/v2/server', {
    headers: {
      'Server-Key': API_KEY,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`ER:LC API HTTP ${response.status}: ${body}`);
  }

  return JSON.parse(body);
}

async function getStaffOnline(guild) {
  try {
    await guild.members.fetch({ withPresences: true });

    return guild.members.cache.filter((member) =>
      !member.user.bot &&
      member.presence &&
      member.presence.status !== 'offline' &&
      STAFF_ROLE_IDS.some((id) => member.roles.cache.has(id))
    ).size;
  } catch (error) {
    console.error('[SERVERINFO] Staff count failed:', error.message);
    return 'Unavailable';
  }
}

async function createPanel(guild) {
  const [server, staffOnline] = await Promise.all([
    fetchERLCServer(),
    getStaffOnline(guild),
  ]);

  const serverName = server.Name ?? server.name ?? 'Unavailable';

  const serverCode =
    server.JoinKey ??
    server.JoinCode ??
    server.joinKey ??
    'Unavailable';

  const players =
    server.CurrentPlayers ??
    server.currentPlayers ??
    server.PlayerCount ??
    server.playerCount ??
    'Unavailable';

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [
      {
        type: 17,
        components: [
          {
            type: 12,
            items: [{ media: { url: HEADER_IMAGE } }],
          },
          {
            type: 14,
            spacing: 1,
            divider: true,
          },
          {
            type: 10,
            content:
              `## <:lasrp:1559999109669191811>┃${PANEL_TITLE}\n\n` +
              `**Server Name:** \`${safe(serverName)}\`\n\n` +
              `**Server Code:** \`${safe(serverCode)}\`\n\n` +
              '**Server Owner:** `SaraiDavid13`\n\n' +
              `**Players Online:** \`${safe(players)}\`\n\n` +
              `**Staff Online:** \`${staffOnline}\`\n\n` +
              '> Welcome to **Los Angeles State Roleplay**, a community dedicated to providing a strict, serious, and immersive roleplay experience. This panel displays our server information and current activity.',
          },
          {
            type: 14,
            spacing: 1,
            divider: true,
          },
          {
            type: 12,
            items: [{ media: { url: FOOTER_IMAGE } }],
          },
          {
            type: 14,
            spacing: 1,
            divider: true,
          },
        ],
      },
    ],
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Create the live LASRP server information panel')
    .setDMPermission(false),

  async execute(interaction) {
    // Acknowledge the command privately.
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    try {
      const channelId = CHANNEL_ID || interaction.channelId;
      const channel = await interaction.client.channels.fetch(channelId);

      if (!channel || !channel.isTextBased() || !channel.guild) {
        throw new Error('The configured server information channel is invalid.');
      }

      // Find an existing panel from this bot so we don't duplicate it.
      const messages = await channel.messages.fetch({ limit: 100 });

      let panelMessage = messages.find((message) =>
        message.author.id === interaction.client.user.id &&
        JSON.stringify(message.components).includes(PANEL_TITLE)
      );

      const payload = await createPanel(interaction.guild);

      if (panelMessage) {
        await panelMessage.edit(payload);
      } else {
        // This is a normal public bot message, not the slash-command reply.
        panelMessage = await channel.send(payload);
      }

      // Keep only one updater for this command module.
      if (globalThis.lasrpServerInfoTimer) {
        clearInterval(globalThis.lasrpServerInfoTimer);
      }

      let updating = false;

      globalThis.lasrpServerInfoTimer = setInterval(async () => {
        if (updating) return;
        updating = true;

        try {
          const updatedPayload = await createPanel(channel.guild);
          await panelMessage.edit(updatedPayload);
          console.log('[SERVERINFO] Panel updated.');
        } catch (error) {
          console.error('[SERVERINFO UPDATE ERROR]', error.message);
        } finally {
          updating = false;
        }
      }, UPDATE_INTERVAL);

      globalThis.lasrpServerInfoTimer.unref?.();

      await interaction.editReply({
        content: 'The public server information panel is ready and will update automatically.',
      });

      console.log('[SERVERINFO] Public panel ready.');
    } catch (error) {
      console.error('[SERVERINFO ERROR]', error);

      await interaction.editReply({
        content: 'Could not create the server information panel. Check the VS Code terminal for the error.',
      }).catch(console.error);
    }
  },
};
