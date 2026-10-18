const fs = require('fs');
const path = require('path');
const { MessageFlags } = require('discord.js');

/* ------------------------------------------------------------------ */
/*  SETTINGS                                                           */
/* ------------------------------------------------------------------ */

// YOUR Discord user ID
const OWNER_ID = '1444276604938489886';

// The name the bot uses when talking about you
const OWNER_NAME = 'Frosty';

// People with any of these role IDs can ping you without the bot answering them, e.g. ['123456789012345678']
const EXEMPT_ROLE_IDS = [];

// How long someone has to reply to the bot's message before it's ignored
const REQUEST_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

// After someone has sent you their message, pinging again within this time gets a warning
const REPING_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

// Messages starting with this are bot commands, so they never count as pings
const COMMAND_PREFIX = '-';

// Prints the reason to the terminal whenever a ping is skipped (set to false once it works)
const DEBUG = true;

function log(...args) {
  if (DEBUG) console.log('[PING GUARD]', ...args);
}

/* ------------------------------------------------------------------ */
/*  On / off switch (saved so it survives restarts)                    */
/* ------------------------------------------------------------------ */
const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'pingguard.json');

function loadEnabled() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).enabled !== false;
  } catch {
    return true; // on by default
  }
}

let enabled = loadEnabled();

function isEnabled() {
  return enabled;
}

function setEnabled(value) {
  enabled = Boolean(value);

  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ enabled }, null, 2));

  // switching it off clears anyone who was in the middle of replying
  if (!enabled) {
    pending.clear();
    waiting.clear();
    recentlyHandled.clear();
  }
}

/* ------------------------------------------------------------------ */
/*  Memory (resets if the bot restarts)                                */
/* ------------------------------------------------------------------ */
const pending = new Map(); // bot message id -> { userId, pingMessage, createdAt }
const waiting = new Map(); // user id -> { botMessageId, createdAt }
const recentlyHandled = new Map(); // user id -> time their message was passed on

let announcedStartup = false;

function cleanUp() {
  const now = Date.now();
  for (const [id, request] of pending) {
    if (now - request.createdAt > REQUEST_TIMEOUT_MS) pending.delete(id);
  }
  for (const [id, entry] of waiting) {
    if (now - entry.createdAt > REQUEST_TIMEOUT_MS) waiting.delete(id);
  }
  for (const [id, time] of recentlyHandled) {
    if (now - time > REPING_COOLDOWN_MS) recentlyHandled.delete(id);
  }
}

// trims text and turns it into a quote block
function quote(text, max = 600) {
  const clean = String(text || '').trim() || '(no text)';
  const short = clean.length > max ? `${clean.slice(0, max)}…` : clean;
  return short.replace(/\n/g, '\n> ');
}

/* ------------------------------------------------------------------ */
/*  The DM you receive                                                 */
/* ------------------------------------------------------------------ */
async function sendSummaryDm(client, request, replyMessage) {
  const owner = await client.users.fetch(OWNER_ID);
  const pingMessage = request.pingMessage;
  const author = replyMessage.author;

  const attachments = [...replyMessage.attachments.values()]
    .map((a) => `[${a.name}](${a.url})`)
    .join('\n');

  const text =
    `## 📩 New message for you\n` +
    `**From:** <@${author.id}> (\`${author.username}\`)\n` +
    `**Channel:** <#${replyMessage.channelId}>\n\n` +
    `**They pinged you with:**\n> ${quote(pingMessage.content)}\n\n` +
    `**What they need:**\n> ${quote(replyMessage.content)}` +
    (attachments ? `\n\n**Attachments:**\n${attachments}` : '');

  await owner.send({
    components: [
      {
        type: 17,
        components: [
          { type: 10, content: text },
          { type: 14, spacing: 1, divider: true },
          {
            type: 1,
            components: [
              { type: 2, style: 5, label: 'Jump to their reply', url: replyMessage.url },
              { type: 2, style: 5, label: 'Original ping', url: pingMessage.url },
            ],
          },
        ],
      },
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
}

/* ------------------------------------------------------------------ */
/*  Called for every message                                           */
/* ------------------------------------------------------------------ */
async function handlePingGuard(message, client) {
  // not set up yet
  if (!/^\d+$/.test(OWNER_ID)) {
    if (!announcedStartup) {
      announcedStartup = true;
      console.log(
        '[PING GUARD] OFF - OWNER_ID in src/utils/pingGuard.js is still the placeholder. Put your user ID in.'
      );
    }
    return;
  }

  // switched off with /pingguard off
  if (!enabled) return;

  if (!announcedStartup) {
    announcedStartup = true;
    console.log(`[PING GUARD] ON - watching for pings of user ID ${OWNER_ID}`);
  }

  const mentionsOwner = message.mentions.users.has(OWNER_ID);

  if (message.author.bot) return;

  if (message.author.id === OWNER_ID) {
    if (mentionsOwner) {
      log('Skipped: that message was sent from the owner account. Ping from a DIFFERENT account to test.');
    }
    return;
  }

  cleanUp();

  /* ---- 1. Is this someone replying to the bot's "what do you need" message? ---- */
  const referenceId = message.reference?.messageId;
  if (referenceId && pending.has(referenceId)) {
    const request = pending.get(referenceId);

    // only the person who pinged can answer it
    if (request.userId !== message.author.id) {
      log('Skipped: a different person replied to the bot\'s message.');
      return;
    }

    pending.delete(referenceId);
    waiting.delete(message.author.id);
    recentlyHandled.set(message.author.id, Date.now());

    // tell them thank you
    await message
      .reply({
        components: [
          {
            type: 17,
            components: [
              {
                type: 10,
                content:
                  `## ✅ Thank you!\n` +
                  `Your message has been passed on to **${OWNER_NAME}**.\n\n` +
                  `**Please don't ping ${OWNER_NAME} again** — he has been notified and will get back to you when he's free.`,
              },
            ],
          },
        ],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [], repliedUser: true },
      })
      .catch((err) => console.error('[PING GUARD] Could not send the thank you:', err.message));

    // DM the owner
    try {
      await sendSummaryDm(client, request, message);
      log('Sent you the DM.');
    } catch (err) {
      console.error(
        '[PING GUARD] Could not DM you. Check your Discord privacy settings allow DMs from server members:',
        err.message
      );
    }
    return;
  }

  /* ---- 2. Did this message ping the owner? ---- */
  if (!mentionsOwner) return; // normal message, nothing to say

  if (message.content.startsWith(COMMAND_PREFIX)) {
    log(`Skipped: message starts with "${COMMAND_PREFIX}" so it's treated as a bot command.`);
    return;
  }

  // a real @mention in the text (not just a reply that pings)
  if (!message.content) {
    log(
      'Skipped: the message text is EMPTY, so Message Content Intent is probably OFF. Turn it on in the Developer Portal → Bot → Privileged Gateway Intents, then restart.'
    );
    return;
  }

  const pinged =
    message.content.includes(`<@${OWNER_ID}>`) || message.content.includes(`<@!${OWNER_ID}>`);
  if (!pinged) {
    log('Skipped: you were only pinged through a reply, not a typed @mention.');
    return;
  }

  // people allowed to ping freely
  if (
    EXEMPT_ROLE_IDS.length &&
    message.member &&
    message.member.roles.cache.some((role) => EXEMPT_ROLE_IDS.includes(role.id))
  ) {
    log('Skipped: that person has an exempt role.');
    return;
  }

  // already told them to explain - just wait for their reply
  if (waiting.has(message.author.id)) {
    log('Skipped: the bot already asked this person to explain, waiting for their reply.');
    return;
  }

  // they already sent their message and are pinging again
  if (recentlyHandled.has(message.author.id)) {
    const warning = await message
      .reply({
        content: `🚫 **${OWNER_NAME} has already been notified.** Please don't ping him again — he'll get back to you when he's free.`,
        allowedMentions: { parse: [], repliedUser: true },
      })
      .catch(() => null);

    if (warning) setTimeout(() => warning.delete().catch(() => {}), 15000);
    return;
  }

  /* ---- 3. Ask them what they need ---- */
  log(`Ping detected from ${message.author.username} - replying.`);

  let botMessage;
  try {
    botMessage = await message.reply({
      components: [
        {
          type: 17,
          components: [
            {
              type: 10,
              content:
                `## ⏳ ${OWNER_NAME} is busy right now\n` +
                `Hey <@${message.author.id}>, ${OWNER_NAME} can't get back to you at the moment.\n\n` +
                `**Please summarise what you need by replying to this message.** I'll pass it straight on to him, so there's no need to ping again.`,
            },
          ],
        },
      ],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [], repliedUser: true },
    });
  } catch (err) {
    console.error(
      '[PING GUARD] Could not reply in that channel. Check the bot can view the channel, send messages and read message history there:',
      err.message
    );
    return;
  }

  pending.set(botMessage.id, {
    userId: message.author.id,
    pingMessage: message,
    createdAt: Date.now(),
  });
  waiting.set(message.author.id, { botMessageId: botMessage.id, createdAt: Date.now() });
}

module.exports = { handlePingGuard, isEnabled, setEnabled, OWNER_ID };