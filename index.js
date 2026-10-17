require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  Collection,
  GatewayIntentBits,
  MessageFlags,
  ChannelType,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');

const { logTicket } = require('./src/utils/ticketLogs');

process.on('unhandledRejection', (err) => console.error('Unhandled error:', err));

let client; // created in buildClient() below

/* ------------------------------------------------------------------ */
/*  TICKET SETTINGS                                                    */
/*  staffRoles = roles that can SEE the ticket, get PINGED, and are    */
/*  the ONLY people who can use claim / unclaim / hold / close         */
/* ------------------------------------------------------------------ */
const TICKET_TYPES = {
  general_assistance: {
    label: 'General Assistance',
    short: 'general',
    categoryId: '1555328403899551754',
    staffRoles: ['1555593610370748469', '1555283780447641620'],
  },
  high_rank_assistance: {
    label: 'High Rank Assistance',
    short: 'highrank',
    categoryId: '1555328448916889700',
    staffRoles: ['1555283780447641620'],
  },
  department_assistance: {
    label: 'Department Assistance',
    short: 'department',
    categoryId: 'PUT_DEPARTMENT_CATEGORY_ID_HERE', // <-- paste the category ID
    staffRoles: ['1555279476949258320'],
  },
};

const PREFIX = '-'; // so -claim, -unclaim, -hold, -close work

const CLAIM_ID = 'btn_1792097545132_xx7k';
const CLOSE_ID = 'btn_1792097546591_44l5';

// animated emoji shown when a ticket is closing
const CLOSING_EMOJI_ID = '1490848277313224774';
function closingEmoji() {
  const emoji = client.emojis.cache.get(CLOSING_EMOJI_ID);
  return emoji ? emoji.toString() : '⏳'; // falls back if the bot can't see the emoji
}

/* ------------------------------------------------------------------ */
/*  Your ticket panel (placeholders get filled in automatically)       */
/* ------------------------------------------------------------------ */
const TICKET_PANEL = {
  type: 17,
  components: [
    {
      type: 12,
      items: [
        {
          media: {
            url: 'https://discord-webhook.com/uploads/36b741241f018105c95db468d97da2b0.webp',
          },
        },
      ],
    },
    { type: 14, spacing: 1, divider: true },
    {
      type: 10,
      content:
        '## <:lasrp:1559999109669191811>┃Assistance Ticket\n\n**Ticket Creator:** {user}\n\n**Ticket Type:** {ticket_type}\n\n**Reason for Opening:** {ticket_reason}\n\n**Status:** Awaiting Staff Response\n\n> Please wait for a member of the appropriate team to respond. Thank you for contacting **Los Angeles State Roleplay Assistance**.',
    },
    { type: 14, spacing: 1, divider: true },
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: 'Claim', custom_id: CLAIM_ID },
        { type: 2, style: 4, label: 'Close', custom_id: CLOSE_ID },
      ],
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
    { type: 14, spacing: 1, divider: true },
  ],
};

/* ------------------------------------------------------------------ */
/*  Replies for the guide + store dropdowns (edit the text freely)     */
/* ------------------------------------------------------------------ */
const guideReplies = {
  staff_applications:
    '## Staff Applications\n> Want to join our staff team? You can apply [here](https://melon.ly/form/7516607442520641536).',

  channel_information:
    '## Channel Information\n' +
    '> <#1559677196094808206> — Open a ticket here whenever you need help, have a question, or want to raise a concern.\n' +
    '> <#1559677290676490281> — Chat with other members of the community here.\n' +
    '> <#1559679218651103262> — Find all of our roleplay session announcements and information here.\n' +
    '> <#1559679263739871252> — Share your screenshots, clips, and other media with the community here.',

  appeals:
    '## Appeals\n> If you believe a punishment was issued unfairly, you can appeal it by opening a ticket. Please provide a clear explanation and any evidence that supports your appeal.\n> Open your appeal in <#1559677196094808206>.',
};

const storeReplies = {
  booster_perks:
    '## Booster Perks\n' +
    '> Thank you for supporting **Los Angeles State Roleplay**! Boosting the server unlocks the following perks:\n\n' +
    '> • **Exclusive Booster role** with a custom colour in the member list\n' +
    '> • **Booster-only chat** to hang out with fellow boosters\n' +
    '> • **Early access** to session announcements\n' +
    '> • **Priority assistance** when you open a ticket\n' +
    '> • **Increased giveaway entries** in community giveaways',

  los_angeles_plus:
    '## Los Angeles Plus\n> Coming soon!',

  donations:
    '## Donations\n> Coming soon!',
};

const menuReplies = {
  guide_menu: guideReplies,
  store_menu: storeReplies,
};

/* ------------------------------------------------------------------ */
/*  Ticket helpers                                                     */
/* ------------------------------------------------------------------ */

// walks through the panel JSON and replaces text in every string
function fillPlaceholders(node, values) {
  if (typeof node === 'string') {
    let out = node;
    for (const [key, val] of Object.entries(values)) {
      out = out.split(key).join(val);
    }
    return out;
  }
  if (Array.isArray(node)) return node.map((n) => fillPlaceholders(n, values));
  if (node && typeof node === 'object') {
    const copy = {};
    for (const [k, v] of Object.entries(node)) {
      // never touch URLs or IDs
      copy[k] = k === 'url' || k === 'custom_id' ? v : fillPlaceholders(v, values);
    }
    return copy;
  }
  return node;
}

function parseTopic(channel) {
  const [tag, userId, type] = (channel.topic || '').split('|');
  if (tag !== 'ticket' || !TICKET_TYPES[type]) return null;
  return { userId, type };
}

// ONLY members with one of this ticket type's pinged roles count as staff
function isStaff(member, type) {
  return TICKET_TYPES[type].staffRoles.some((r) => member.roles.cache.has(r));
}

const NO_PERMISSION = '❌ Only the staff team for this ticket can use this.';

function ephemeral(interaction, content) {
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

// step 1: person picks a category -> check things -> show the reason form
async function startTicket(interaction) {
  const type = interaction.values[0];
  const cfg = TICKET_TYPES[type];

  if (!cfg || !/^\d+$/.test(cfg.categoryId)) {
    return ephemeral(
      interaction,
      `🚧 The **${cfg ? cfg.label : 'selected'}** ticket category hasn't been set up yet.`
    );
  }

  const existing = interaction.guild.channels.cache.find(
    (c) =>
      c.parentId === cfg.categoryId &&
      c.topic === `ticket|${interaction.user.id}|${type}`
  );
  if (existing) {
    return ephemeral(interaction, `❌ You already have an open ticket: ${existing}`);
  }

  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal:${type}`)
    .setTitle(`${cfg.label} Ticket`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason for opening')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Please explain your request in detail...')
          .setRequired(true)
          .setMaxLength(1000)
      )
    );

  return interaction.showModal(modal);
}

// step 2: form submitted -> make the channel and send the filled-in panel
async function createTicket(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const type = interaction.customId.split(':')[1];
  const cfg = TICKET_TYPES[type];
  if (!cfg) return interaction.editReply('🚧 This option isn\'t set up yet.');

  const reason = interaction.fields.getTextInputValue('reason');
  const guild = interaction.guild;
  const user = interaction.user;

  const existing = guild.channels.cache.find(
    (c) => c.parentId === cfg.categoryId && c.topic === `ticket|${user.id}|${type}`
  );
  if (existing) {
    return interaction.editReply(`❌ You already have an open ticket: ${existing}`);
  }

  const name = `${cfg.short}-${user.username}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 90);

  const allow = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
  ];

  // everyone is hidden; only the creator, the bot and this ticket type's roles can see it
  const permissionOverwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow },
    { id: client.user.id, allow: [...allow, PermissionFlagsBits.ManageChannels] },
    ...cfg.staffRoles.map((roleId) => ({ id: roleId, allow })),
  ];

  let channel;
  try {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: cfg.categoryId,
      topic: `ticket|${user.id}|${type}`,
      permissionOverwrites,
    });
  } catch (err) {
    console.error(err);
    return interaction.editReply(
      '❌ I couldn\'t create the ticket. Check that I have **Manage Channels** and that the category ID and role IDs are right.'
    );
  }

  // ping only this ticket type's roles
  if (cfg.staffRoles.length) {
    await channel
      .send({
        content: cfg.staffRoles.map((r) => `<@&${r}>`).join(' '),
        allowedMentions: { roles: cfg.staffRoles },
      })
      .catch(() => {});
  }

  // send YOUR panel with the info filled in
  const panel = fillPlaceholders(TICKET_PANEL, {
    '{user}': `<@${user.id}>`,
    '{ticket_type}': cfg.label,
    '{ticket_reason}': reason,
  });

  await channel.send({
    components: [panel],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { users: [user.id] },
  });

  await interaction.editReply(`✅ Your ticket has been created: ${channel}`);

  // reset the dropdown so the old choice doesn't stay highlighted
  if (interaction.message) {
    interaction.message
      .edit({
        components: interaction.message.components.map((c) => c.toJSON()),
        flags: MessageFlags.IsComponentsV2,
      })
      .catch(() => {});
  }
}

// finds the Claim button inside the panel JSON
function findClaimButton(node) {
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findClaimButton(n);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === 'object') {
    if (node.type === 2 && node.custom_id === CLAIM_ID) return node;
    for (const v of Object.values(node)) {
      const found = findClaimButton(v);
      if (found) return found;
    }
  }
  return null;
}

// panel edit: status line + greyed-out claim button
function patchClaimed(node, claimer) {
  if (Array.isArray(node)) return node.forEach((n) => patchClaimed(n, claimer));
  if (!node || typeof node !== 'object') return;

  if (node.type === 10 && typeof node.content === 'string') {
    node.content = node.content.replace(
      '**Status:** Awaiting Staff Response',
      `**Status:** Claimed by ${claimer}`
    );
  }
  if (node.type === 2 && node.custom_id === CLAIM_ID) {
    node.disabled = true;
    node.label = 'Claimed';
  }
  for (const v of Object.values(node)) patchClaimed(v, claimer);
}

// panel edit: back to "Awaiting Staff Response" + Claim button works again
function patchUnclaimed(node) {
  if (Array.isArray(node)) return node.forEach((n) => patchUnclaimed(n));
  if (!node || typeof node !== 'object') return;

  if (node.type === 10 && typeof node.content === 'string') {
    node.content = node.content.replace(
      /\*\*Status:\*\* Claimed by <@!?\d+>/,
      '**Status:** Awaiting Staff Response'
    );
  }
  if (node.type === 2 && node.custom_id === CLAIM_ID) {
    node.disabled = false;
    node.label = 'Claim';
  }
  for (const v of Object.values(node)) patchUnclaimed(v);
}

// finds the bot's ticket panel in a ticket channel (used by -claim / -unclaim)
async function findPanelMessage(channel) {
  const messages = await channel.messages.fetch({ limit: 30 });
  return messages.find(
    (m) =>
      m.author.id === client.user.id &&
      JSON.stringify(m.components.map((c) => c.toJSON())).includes(CLAIM_ID)
  );
}

/* ------------------------------------------------------------------ */
/*  Ticket actions - used by buttons, / commands AND - commands        */
/*  All four are staff-role only                                       */
/* ------------------------------------------------------------------ */
async function claimTicket(interaction) {
  const info = parseTopic(interaction.channel);
  if (!info) return ephemeral(interaction, '❌ This isn\'t a ticket channel.');
  if (!isStaff(interaction.member, info.type)) {
    return ephemeral(interaction, NO_PERMISSION);
  }

  const panelMsg = interaction.isButton()
    ? interaction.message
    : await findPanelMessage(interaction.channel);
  if (!panelMsg) {
    return ephemeral(interaction, '❌ I couldn\'t find the ticket panel in this channel.');
  }

  const json = panelMsg.components.map((c) => c.toJSON());
  const claimBtn = findClaimButton(json);
  if (claimBtn && claimBtn.disabled) {
    return ephemeral(interaction, '❌ This ticket has already been claimed.');
  }

  patchClaimed(json, `<@${interaction.user.id}>`);
  await panelMsg.edit({
    components: json,
    flags: MessageFlags.IsComponentsV2,
  });

  return interaction.reply({
    content: `✅ This ticket has been claimed by ${interaction.user}.`,
    allowedMentions: { parse: [] },
  });
}

async function unclaimTicket(interaction) {
  const info = parseTopic(interaction.channel);
  if (!info) return ephemeral(interaction, '❌ This isn\'t a ticket channel.');
  if (!isStaff(interaction.member, info.type)) {
    return ephemeral(interaction, NO_PERMISSION);
  }

  const panelMsg = await findPanelMessage(interaction.channel);
  if (!panelMsg) {
    return ephemeral(interaction, '❌ I couldn\'t find the ticket panel in this channel.');
  }

  const json = panelMsg.components.map((c) => c.toJSON());
  const claimBtn = findClaimButton(json);
  if (!claimBtn || !claimBtn.disabled) {
    return ephemeral(interaction, '❌ This ticket hasn\'t been claimed.');
  }

  patchUnclaimed(json);
  await panelMsg.edit({
    components: json,
    flags: MessageFlags.IsComponentsV2,
  });

  return interaction.reply({
    content: `✅ This ticket has been unclaimed by ${interaction.user} and can be claimed again.`,
    allowedMentions: { parse: [] },
  });
}

// tickets that are in the middle of closing (stops double closes / double logs)
const closingChannels = new Set();

async function closeTicket(interaction) {
  const info = parseTopic(interaction.channel);
  if (!info) return ephemeral(interaction, '❌ This isn\'t a ticket channel.');
  if (!isStaff(interaction.member, info.type)) {
    return ephemeral(interaction, NO_PERMISSION);
  }

  const channel = interaction.channel;
  if (closingChannels.has(channel.id)) {
    return ephemeral(interaction, '❌ This ticket is already closing.');
  }
  closingChannels.add(channel.id);

  await interaction.reply({
    content: `${closingEmoji()} This ticket will close in **5 seconds**.`,
  });

  // save the transcript + log BEFORE the channel is deleted
  const startedAt = Date.now();
  try {
    await logTicket({
      client,
      channel,
      typeLabel: TICKET_TYPES[info.type].label,
      openerId: info.userId,
      closedBy: interaction.user,
    });
  } catch (err) {
    console.error('[TICKET LOG ERROR]', err);
    closingChannels.delete(channel.id);
    return channel
      .send(
        '❌ I couldn\'t save the transcript, so this ticket has **not** been closed. Check that I can view, send messages and attach files in the ticket log channel, then try closing again.'
      )
      .catch(() => {});
  }

  const wait = Math.max(0, 5000 - (Date.now() - startedAt));
  setTimeout(() => {
    channel.delete().catch(console.error);
  }, wait);
}

async function holdTicket(interaction) {
  const info = parseTopic(interaction.channel);
  if (!info) return ephemeral(interaction, '❌ This isn\'t a ticket channel.');
  if (!isStaff(interaction.member, info.type)) {
    return ephemeral(interaction, NO_PERMISSION);
  }

  return interaction.reply({
    components: [
      {
        type: 17,
        components: [
          {
            type: 10,
            content:
              `## ⏸️ Ticket On Hold\n` +
              `> This ticket has been placed **on hold** by ${interaction.user}.\n` +
              `> A member of staff will get back to you as soon as possible. Thank you for your patience.`,
          },
        ],
      },
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
}

// makes a normal message look like an interaction so the actions above work for "-claim" etc.
function wrapMessage(message) {
  return {
    channel: message.channel,
    guild: message.guild,
    member: message.member,
    user: message.author,
    isButton: () => false,
    reply: async (opts) => {
      const { flags, ...rest } = opts;
      // "ephemeral" (private) replies don't exist for messages, so show them briefly then remove
      if (flags && (flags & MessageFlags.Ephemeral)) {
        const sent = await message.channel.send(rest);
        setTimeout(() => sent.delete().catch(() => {}), 5000);
        return sent;
      }
      return message.channel.send(opts);
    },
  };
}


/* ------------------------------------------------------------------ */
/* Client setup + LASRP server information panel                       */
/* ------------------------------------------------------------------ */

function buildClient(withMessageContent) {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ];

  if (withMessageContent) {
    intents.push(GatewayIntentBits.MessageContent);
  }

  client = new Client({ intents });

  // LASRP welcome messages
  client.on('guildMemberAdd', async (member) => {
    if (member.guild.id !== '1555272140029173800') return;

    const channel = await member.guild.channels
      .fetch('1559679218651103262')
      .catch(console.error);

    if (!channel) return;

    await channel.send(
      `Welcome ${member} to **LASRP** — enjoy your stay and have fun roleplaying!`
    ).catch(console.error);
  });

  // Load slash commands, including grouped commands.
  client.commands = new Collection();

  const commandDirectory = path.join(__dirname, 'commands');

  for (const file of fs.readdirSync(commandDirectory).filter((file) => file.endsWith('.js'))) {
    try {
      const command = require(path.join(commandDirectory, file));

      if (Array.isArray(command.commands)) {
        for (const subCommand of command.commands) {
          client.commands.set(subCommand.data.name, subCommand);
          console.log(`Loaded command: ${subCommand.data.name}`);
        }
      } else if (command.data && command.execute) {
        client.commands.set(command.data.name, command);
        console.log(`Loaded command: ${command.data.name}`);
      }
    } catch (error) {
      console.error(`Could not load commands/${file}:`, error);
    }
  }

  // Existing ticket actions
  client.ticketActions = {
    claim: claimTicket,
    unclaim: unclaimTicket,
    close: closeTicket,
    hold: holdTicket,
  };

  // Bot ready
  client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    if (client.emojis.cache.has(CLOSING_EMOJI_ID)) {
      console.log('Closing emoji found.');
    } else {
      console.log('Closing emoji not found; using the fallback.');
    }

    if (!withMessageContent) {
      console.log(
        'Message Content Intent is disabled. Prefix commands are unavailable.'
      );
    }

    // Start the automatic public LASRP server information panel
    try {
      const {
        startServerInfoPanel,
      } = require('./src/utils/serverInfoPanel');

      await startServerInfoPanel(client);

      console.log('LASRP server information panel started.');
    } catch (error) {
      console.error('[LASRP PANEL STARTUP ERROR]', error);
    }

    // Start the live stat channels (member count + ER:LC players + ER:LC queue)
    try {
      const { startStatChannels } = require('./src/utils/statChannels');

      startStatChannels(client);

      console.log('Live stat channels started.');
    } catch (error) {
      console.error('[STAT CHANNELS STARTUP ERROR]', error);
    }
  });

 
  // Prefix commands: tickets and moderation.
  if (withMessageContent) {
    client.on('messageCreate', async (message) => {
      if (message.author.bot || !message.guild) return;
      if (!message.content.startsWith(PREFIX)) return;

      const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
      const commandName = (args.shift() || '').toLowerCase();

      if (!commandName) return;

      try {
        // Existing ticket commands.
        const ticketAction = client.ticketActions[commandName];

        if (ticketAction) {
          await ticketAction(wrapMessage(message));
          message.delete().catch(() => {});
          return;
        }

        // Moderation commands.
        const moderation = require('./commands/moderation');
        const moderationNames = moderation.commands.map(
          (command) => command.data.name
        );

        if (moderationNames.includes(commandName)) {
          await message.delete().catch(() => {});
          await moderation.executePrefix(message, commandName, args, client);
        }
      } catch (error) {
        console.error('[PREFIX COMMAND ERROR]', error);
      }
    });
  }

  // Interactions: slash commands, ticket forms, dropdowns and buttons
  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);

        if (!command) {
          return interaction.reply({
            content: 'This command could not be found.',
            flags: MessageFlags.Ephemeral,
          });
        }

        await command.execute(interaction);
        return;
      }

      // Ticket form submitted
      if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('ticket_modal:')) {
          await createTicket(interaction);
        }

        return;
      }

      // Dropdown menus
      if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'assistance_menu') {
          await startTicket(interaction);
          return;
        }

        const replies = menuReplies[interaction.customId];
        const reply = replies
          ? replies[interaction.values[0]]
          : null;

        await ephemeral(
          interaction,
          reply || "This option hasn't been configured yet."
        );

        return;
      }

      // Buttons: ticket buttons + the session vote button
      if (interaction.isButton()) {
        if (interaction.customId === CLAIM_ID) {
          await claimTicket(interaction);
          return;
        }

        if (interaction.customId === CLOSE_ID) {
          await closeTicket(interaction);
          return;
        }

        // Session vote button (/sessionvote)
        if (interaction.customId === 'sessionvote_vote') {
          await require('./commands/sessionvote').handleVote(interaction);
          return;
        }

        await ephemeral(
          interaction,
          "This button hasn't been configured yet."
        );
      }
    } catch (error) {
      console.error('[INTERACTION ERROR]', error);

      const response = {
        content: 'Something went wrong while processing this interaction.',
        flags: MessageFlags.Ephemeral,
      };

      if (interaction.replied || interaction.deferred) {
        interaction.followUp(response).catch(console.error);
      } else {
        interaction.reply(response).catch(console.error);
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Start bot                                                           */
/* ------------------------------------------------------------------ */

async function start() {
  if (!process.env.TOKEN) {
    throw new Error('TOKEN is missing from your .env file.');
  }

  buildClient(true);

  try {
    await client.login(process.env.TOKEN);
  } catch (error) {
    const disallowed =
      error.code === 'DisallowedIntents' ||
      /disallowed intents/i.test(error.message || '');

    if (!disallowed) {
      throw error;
    }

    console.log(
      'Message Content Intent unavailable; restarting without prefix commands.'
    );

    client.destroy();
    buildClient(false);

    await client.login(process.env.TOKEN);
  }
}

start().catch((error) => {
  console.error('Bot failed to start:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});