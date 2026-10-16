
const {
  ChannelType,
  MessageFlags,
} = require('discord.js');

const UPDATE_INTERVAL = 30_000;

// Server configuration
const CHANNEL_ID = process.env.SERVER_INFO_CHANNEL_ID;
const API_KEY = process.env.ERLC_API_KEY;

// LASRP staff roles
const STAFF_ROLE_IDS = [
  '1555279470758199377', // Server Administrator
  '1555279475585974395', // Management / Senior Moderator
  '1555283780447641620', // Moderator
  '1555593610370748469', // Support Supervisor / Ticket Staff
];

const OWNER_NAME = 'SaraiDavid13';

const HEADER_IMAGE =
  'https://discord-webhook.com/uploads/10b7d090190e33aab5dead1b77a60e23.png';

const FOOTER_IMAGE =
  'https://discord-webhook.com/uploads/e51d8ccdc4c282b0d3503b88e6c11c1a.webp';

const PANEL_TITLE =
  'Los Angeles State Roleplay Server Information';

let updateTimer;

async function fetchServerInfo() {
  if (!API_KEY) {
    throw new Error('ERLC_API_KEY is missing from your .env file.');
  }

  const response = await fetch('https://api.erlc.gg/v2/server', {
    headers: {
      'Server-Key': API_KEY,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(
      `ERLC API returned ${response.status}: ${await response.text()}`
    );
  }

  return response.json();
}

async function countStaffOnline(guild) {
  try {
    await guild.members.fetch({ withPresences: true });

    return guild.members.cache.filter((member) => {
      const hasStaffRole = STAFF_ROLE_IDS.some((roleId) =>
        member.roles.cache.has(roleId)
      );

      return (
        hasStaffRole &&
        member.presence &&
        member.presence.status !== 'offline'
      );
    }).size;
  } catch (error) {
    console.error('[LASRP STAFF COUNT ERROR]', error.message);
    return 'Unavailable';
  }
}

function buildPanel(server, staffOnline) {
  const serverName =
    server.Name ??
    server.name ??
    'Unavailable';

  const serverCode =
    server.JoinKey ??
    server.JoinCode ??
    server.joinKey ??
    server.joinCode ??
    'Unavailable';

  const players =
    server.CurrentPlayers ??
    server.currentPlayers ??
    server.PlayerCount ??
    server.playerCount;

  const playerCount = Array.isArray(players)
    ? players.length
    : players ?? 'Unavailable';

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [
      {
        type: 17,
        components: [
          {
            type: 12,
            items: [
              {
                media: {
                  url: HEADER_IMAGE,
                },
              },
            ],
          },
          {
            type: 14,
            divider: true,
            spacing: 1,
          },
          {
            type: 10,
            content: [
              `## <:lasrp:1559999109669191811>┃${PANEL_TITLE}`,
              '',
              `**Server Name:** \`${serverName}\``,
              '',
              `**Server Code:** \`${serverCode}\``,
              '',
              `**Server Owner:** \`${OWNER_NAME}\``,
              '',
              `**Players Online:** \`${playerCount}\``,
              '',
              `**Staff Online:** \`${staffOnline}\``,
              '',
              '> Welcome to **Los Angeles State Roleplay**, a community dedicated to providing a strict, serious, and immersive roleplay experience. This panel displays our server information and current activity.',
            ].join('\n'),
          },
          {
            type: 14,
            divider: true,
            spacing: 1,
          },
          {
            type: 12,
            items: [
              {
                media: {
                  url: FOOTER_IMAGE,
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

async function startServerInfoPanel(client) {
  if (!CHANNEL_ID) {
    throw new Error(
      'SERVER_INFO_CHANNEL_ID is missing from your .env file.'
    );
  }

  const channel = await client.channels.fetch(CHANNEL_ID);

  if (
    !channel ||
    !channel.isTextBased() ||
    channel.type === ChannelType.DM
  ) {
    throw new Error(
      'The server information channel could not be found or is not a server text channel.'
    );
  }

  let panelMessage = null;

  // Find the existing panel so the bot edits it instead of
  // posting a new message on every restart.
  const messages = await channel.messages.fetch({ limit: 100 });

  panelMessage =
    messages.find((message) => {
      if (message.author.id !== client.user.id) {
        return false;
      }

      return JSON.stringify(message.components).includes(PANEL_TITLE);
    }) ?? null;

  let updating = false;

  async function updatePanel() {
    if (updating) return;
    updating = true;

    try {
      const [server, staffOnline] = await Promise.all([
        fetchServerInfo(),
        countStaffOnline(channel.guild),
      ]);

      const payload = buildPanel(server, staffOnline);

      if (panelMessage) {
        await panelMessage.edit(payload);
      } else {
        panelMessage = await channel.send(payload);
      }

      console.log('[LASRP PANEL] Updated successfully.');
    } catch (error) {
      console.error('[LASRP PANEL UPDATE ERROR]', error);
    } finally {
      updating = false;
    }
  }

  await updatePanel();

  if (updateTimer) {
    clearInterval(updateTimer);
  }

  updateTimer = setInterval(updatePanel, UPDATE_INTERVAL);
  updateTimer.unref?.();

  return () => {
    clearInterval(updateTimer);
    updateTimer = null;
  };
}

module.exports = { startServerInfoPanel };
