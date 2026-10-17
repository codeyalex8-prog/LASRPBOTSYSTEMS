const { AttachmentBuilder, MessageFlags } = require('discord.js');

/* ------------------------------------------------------------------ */
/*  SETTINGS                                                           */
/* ------------------------------------------------------------------ */
const TICKET_LOG_CHANNEL_ID = '1555604116804468746';
const MAX_MESSAGES = 5000; // safety limit for really long tickets
const ACCENT_COLOUR = 0x2563eb; // the blue stripe on the log panel
const LOGO_EMOJI = '<:lasrp:1559999109669191811>';

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(ms) {
  return (
    new Date(ms).toLocaleString('en-GB', {
      timeZone: 'UTC',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) + ' UTC'
  );
}

// pulls the text out of Components V2 messages (like the ticket panel)
function extractComponentText(node, out = []) {
  if (Array.isArray(node)) {
    node.forEach((n) => extractComponentText(n, out));
    return out;
  }
  if (node && typeof node === 'object') {
    if (node.type === 10 && typeof node.content === 'string') out.push(node.content);
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') extractComponentText(value, out);
    }
  }
  return out;
}

function messageText(message) {
  const parts = [];
  if (message.content) parts.push(message.content);
  try {
    parts.push(...extractComponentText(message.components.map((c) => c.toJSON())));
  } catch {
    // ignore components we can't read
  }
  return parts.join('\n\n');
}

// gets every message in the ticket, oldest first
async function fetchAllMessages(channel) {
  const all = [];
  let before;

  while (all.length < MAX_MESSAGES) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }

  return all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

/* ------------------------------------------------------------------ */
/*  Turns Discord-style text into HTML                                 */
/* ------------------------------------------------------------------ */
function formatText(raw, { client, guild, message }) {
  const stash = [];
  const hold = (html) => `\u0000${stash.push(html) - 1}\u0000`;

  let text = escapeHtml(raw);

  // code blocks + inline code (protected from other formatting)
  text = text.replace(/```(?:[a-z]+\n)?([\s\S]*?)```/gi, (_, code) =>
    hold(`<pre>${code.trim()}</pre>`)
  );
  text = text.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${code}</code>`));

  // mentions, channels, emoji, timestamps
  text = text.replace(/&lt;@!?(\d+)&gt;/g, (_, id) => {
    const user = message.mentions?.users?.get(id) || client.users.cache.get(id);
    return `<span class="mention">@${escapeHtml(user ? user.username : 'unknown-user')}</span>`;
  });
  text = text.replace(/&lt;@&amp;(\d+)&gt;/g, (_, id) => {
    const role = guild.roles.cache.get(id);
    return `<span class="mention">@${escapeHtml(role ? role.name : 'unknown-role')}</span>`;
  });
  text = text.replace(/&lt;#(\d+)&gt;/g, (_, id) => {
    const channel = guild.channels.cache.get(id);
    return `<span class="mention">#${escapeHtml(channel ? channel.name : 'unknown-channel')}</span>`;
  });
  text = text.replace(
    /&lt;(a?):(\w+):(\d+)&gt;/g,
    (_, animated, name, id) =>
      `<img class="emoji" src="https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'webp'}?size=48" alt=":${name}:">`
  );
  text = text.replace(
    /&lt;t:(\d+)(?::[a-zA-Z])?&gt;/g,
    (_, ts) => `<span class="mention">${formatDate(Number(ts) * 1000)}</span>`
  );

  // links
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) =>
    hold(`<a href="${url}" target="_blank" rel="noopener">${label}</a>`)
  );
  text = text.replace(/(https?:\/\/[^\s<\u0000]+)/g, (url) =>
    hold(`<a href="${url}" target="_blank" rel="noopener">${url}</a>`)
  );

  // bold, italics, underline, strike, spoiler
  text = text
    .replace(/\*\*\*(.+?)\*\*\*/gs, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>')
    .replace(/__(.+?)__/gs, '<u>$1</u>')
    .replace(/\*(?!\s)(.+?)\*/gs, '<em>$1</em>')
    .replace(/(?<![\w])_(?!\s)(.+?)_(?![\w])/gs, '<em>$1</em>')
    .replace(/~~(.+?)~~/gs, '<s>$1</s>')
    .replace(/\|\|(.+?)\|\|/gs, '<span class="spoiler">$1</span>');

  // headings, quotes, small text, line breaks
  text = text
    .split('\n')
    .map((line) => {
      if (/^#{1,3} /.test(line)) {
        const level = line.match(/^#+/)[0].length;
        return `<div class="h${level}">${line.replace(/^#+ /, '')}</div>`;
      }
      if (/^&gt; /.test(line)) {
        return `<div class="quote">${line.replace(/^&gt; /, '')}</div>`;
      }
      if (/^-# /.test(line)) {
        return `<div class="subtext">${line.slice(3)}</div>`;
      }
      return line;
    })
    .join('\n')
    .replace(/<\/div>\n/g, '</div>')
    .replace(/\n/g, '<br>');

  // put the protected bits back
  return text.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
}

/* ------------------------------------------------------------------ */
/*  One message in the transcript                                      */
/* ------------------------------------------------------------------ */
function renderMessage(message, previous, ctx) {
  const member = message.member;
  const name = member?.displayName || message.author.globalName || message.author.username;
  const colour =
    member && member.displayHexColor && member.displayHexColor !== '#000000'
      ? member.displayHexColor
      : '#f2f3f5';
  const avatar = message.author.displayAvatarURL({ extension: 'png', size: 64 });
  const time = formatDate(message.createdTimestamp);

  const grouped =
    previous &&
    previous.author.id === message.author.id &&
    message.createdTimestamp - previous.createdTimestamp < 7 * 60 * 1000;

  let body = '';

  const text = messageText(message);
  if (text) {
    body += `<div class="text">${formatText(text, { ...ctx, message })}</div>`;
  }

  for (const attachment of message.attachments.values()) {
    const url = escapeHtml(attachment.url);
    if (attachment.contentType && attachment.contentType.startsWith('image/')) {
      body += `<a href="${url}" target="_blank" rel="noopener"><img class="attachment" src="${url}" alt="${escapeHtml(attachment.name)}"></a>`;
    } else {
      body += `<a class="file" href="${url}" target="_blank" rel="noopener">📎 ${escapeHtml(attachment.name)}</a>`;
    }
  }

  for (const embed of message.embeds) {
    if (!embed.title && !embed.description) continue;
    body +=
      `<div class="embed">` +
      (embed.title ? `<div class="embed-title">${escapeHtml(embed.title)}</div>` : '') +
      (embed.description
        ? `<div>${formatText(embed.description, { ...ctx, message })}</div>`
        : '') +
      `</div>`;
  }

  if (!body) body = '<div class="text muted">(no text)</div>';

  if (grouped) {
    return (
      `<div class="msg">` +
      `<div class="gutter">${escapeHtml(time.split(', ').pop())}</div>` +
      `<div class="content">${body}</div>` +
      `</div>`
    );
  }

  return (
    `<div class="msg first">` +
    `<img class="avatar" src="${escapeHtml(avatar)}" alt="">` +
    `<div class="content">` +
    `<div class="meta">` +
    `<span class="name" style="color:${escapeHtml(colour)}">${escapeHtml(name)}</span>` +
    (message.author.bot ? `<span class="tag">BOT</span>` : '') +
    `<span class="time">${escapeHtml(time)}</span>` +
    `</div>` +
    body +
    `</div></div>`
  );
}

/* ------------------------------------------------------------------ */
/*  The whole transcript page                                          */
/* ------------------------------------------------------------------ */
const CSS = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#313338;color:#dbdee1;font-family:'gg sans','Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45}
.wrap{max-width:960px;margin:0 auto;padding:28px 20px 60px}
.header{background:#2b2d31;border-radius:12px;border-left:4px solid #2563eb;padding:20px 24px;margin-bottom:24px}
.header h1{margin:0 0 4px;font-size:22px;color:#fff}
.header .sub{color:#949ba4;font-size:13px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px 24px}
.k{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#949ba4;font-weight:700}
.v{color:#f2f3f5;word-break:break-word}
.reason{margin-top:14px;padding-top:14px;border-top:1px solid #3f4147}
.msg{display:flex;gap:16px;padding:4px 8px;border-radius:6px}
.msg:hover{background:#2e3035}
.msg.first{margin-top:14px}
.avatar{width:40px;height:40px;border-radius:50%;flex:none}
.gutter{width:40px;flex:none;text-align:center;font-size:10px;color:#6d6f78;padding-top:4px;visibility:hidden}
.msg:hover .gutter{visibility:visible}
.content{min-width:0;flex:1}
.meta{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.name{font-weight:600}
.tag{background:#5865f2;color:#fff;font-size:10px;font-weight:700;border-radius:4px;padding:1px 5px}
.time{color:#949ba4;font-size:12px}
.text{word-break:break-word}
.muted{color:#6d6f78;font-style:italic}
.mention{background:rgba(88,101,242,.3);color:#c9cdfb;border-radius:3px;padding:0 2px;font-weight:500}
code{background:#1e1f22;border-radius:4px;padding:1px 5px;font-family:Consolas,monospace;font-size:13px}
pre{background:#1e1f22;border:1px solid #1a1b1e;border-radius:6px;padding:10px 12px;overflow:auto;font-family:Consolas,monospace;font-size:13px;white-space:pre-wrap;margin:6px 0}
.quote{border-left:4px solid #4e5058;padding-left:12px;margin:2px 0}
.h1{font-size:22px;font-weight:700;color:#fff;margin:6px 0 2px}
.h2{font-size:19px;font-weight:700;color:#fff;margin:6px 0 2px}
.h3{font-size:16px;font-weight:700;color:#fff;margin:6px 0 2px}
.subtext{font-size:12px;color:#949ba4}
.emoji{width:22px;height:22px;vertical-align:-5px}
.attachment{display:block;max-width:420px;max-height:320px;border-radius:8px;margin-top:6px}
.file{display:inline-block;background:#2b2d31;border:1px solid #3f4147;border-radius:6px;padding:8px 12px;margin-top:6px;color:#00a8fc;text-decoration:none}
.embed{background:#2b2d31;border-left:4px solid #4e5058;border-radius:4px;padding:8px 12px;margin-top:6px;max-width:520px}
.embed-title{font-weight:700;color:#fff;margin-bottom:2px}
.spoiler{background:#1e1f22;color:#1e1f22;border-radius:3px}
.spoiler:hover{color:#dbdee1}
a{color:#00a8fc}
.footer{text-align:center;color:#6d6f78;font-size:12px;margin-top:40px}
`;

function buildHtml(meta, messages, ctx) {
  const person = (id, user) =>
    id
      ? `${escapeHtml(user ? user.username : 'Unknown user')} <span class="time">(${escapeHtml(id)})</span>`
      : 'Nobody';

  let previous = null;
  const rendered = messages
    .map((message) => {
      const html = renderMessage(message, previous, ctx);
      previous = message;
      return html;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Transcript - ${escapeHtml(meta.ticketName)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>Ticket Transcript</h1>
    <div class="sub">${escapeHtml(meta.guildName)} • #${escapeHtml(meta.ticketName)}</div>
    <div class="grid">
      <div><div class="k">Ticket Type</div><div class="v">${escapeHtml(meta.typeLabel)}</div></div>
      <div><div class="k">Opened By</div><div class="v">${person(meta.openerId, meta.opener)}</div></div>
      <div><div class="k">Claimed By</div><div class="v">${person(meta.claimerId, meta.claimer)}</div></div>
      <div><div class="k">Closed By</div><div class="v">${person(meta.closedBy.id, meta.closedBy)}</div></div>
      <div><div class="k">Opened</div><div class="v">${formatDate(meta.openedAt)}</div></div>
      <div><div class="k">Closed</div><div class="v">${formatDate(meta.closedAt)}</div></div>
      <div><div class="k">Messages</div><div class="v">${meta.count}</div></div>
    </div>
    <div class="reason"><div class="k">Reason for Opening</div><div class="v">${escapeHtml(meta.reason)}</div></div>
  </div>
  ${rendered}
  <div class="footer">Transcript generated by LASRP Systems • ${formatDate(meta.closedAt)}</div>
</div>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Called when a ticket is closed                                     */
/* ------------------------------------------------------------------ */
async function logTicket({ client, channel, typeLabel, openerId, closedBy }) {
  const logChannel = await client.channels.fetch(TICKET_LOG_CHANNEL_ID);
  if (!logChannel || !logChannel.isTextBased()) {
    throw new Error('The ticket log channel could not be found.');
  }

  const guild = channel.guild;
  const messages = await fetchAllMessages(channel);

  // work out the reason + who claimed it from the ticket panel
  let reason = 'Not provided';
  let claimerId = null;
  for (const message of messages) {
    if (message.author.id !== client.user.id) continue;

    const text = messageText(message);
    const found = text.match(/\*\*Reason for Opening:\*\* ([\s\S]*?)\n\n\*\*Status:\*\*/);
    if (!found) continue;

    reason = found[1].trim() || reason;

    const statuses = [...text.matchAll(/\*\*Status:\*\* ([^\n]*)/g)];
    const lastStatus = statuses.length ? statuses[statuses.length - 1][1] : '';
    const claimed = lastStatus.match(/^Claimed by <@!?(\d+)>/);
    claimerId = claimed ? claimed[1] : null;
  }

  const [opener, claimer] = await Promise.all([
    client.users.fetch(openerId).catch(() => null),
    claimerId ? client.users.fetch(claimerId).catch(() => null) : null,
  ]);

  const openedAt = channel.createdTimestamp;
  const closedAt = Date.now();

  // ---- the transcript file ----
  const html = buildHtml(
    {
      guildName: guild.name,
      ticketName: channel.name,
      typeLabel,
      opener,
      openerId,
      claimer,
      claimerId,
      closedBy,
      openedAt,
      closedAt,
      reason,
      count: messages.length,
    },
    messages,
    { client, guild }
  );

  const fileName = `transcript-${channel.name}.html`;
  const attachment = new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: fileName });

  // ---- the log panel ----
  const who = (id, user) =>
    `<@${id}>${user ? ` (\`${user.username}\`)` : ''}`;

  const text =
    `## ${LOGO_EMOJI}┃Ticket Closed\n` +
    `**Ticket:** \`${channel.name}\`\n` +
    `**Type:** ${typeLabel}\n` +
    `**Reason:** ${reason.replace(/\n+/g, ' ').slice(0, 700)}\n\n` +
    `**Opened By:** ${who(openerId, opener)}\n` +
    `**Claimed By:** ${claimerId ? who(claimerId, claimer) : '*Nobody*'}\n` +
    `**Closed By:** ${who(closedBy.id, closedBy)}\n\n` +
    `**Opened:** <t:${Math.floor(openedAt / 1000)}:f>\n` +
    `**Closed:** <t:${Math.floor(closedAt / 1000)}:f>\n` +
    `**Messages:** ${messages.length}\n\n` +
    `-# Download the transcript below and open it in your web browser.`;

  const withFile = {
    type: 17,
    accent_color: ACCENT_COLOUR,
    components: [
      { type: 10, content: text },
      { type: 14, spacing: 1, divider: true },
      { type: 13, file: { url: `attachment://${fileName}` } },
    ],
  };

  try {
    await logChannel.send({
      components: [withFile],
      files: [attachment],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    // backup: send the panel, then the file on its own
    console.error('[TICKET LOG] Panel with file failed, sending separately:', err.message);

    await logChannel.send({
      components: [
        { type: 17, accent_color: ACCENT_COLOUR, components: [{ type: 10, content: text }] },
      ],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
    await logChannel.send({ files: [attachment] });
  }
}

module.exports = { logTicket, TICKET_LOG_CHANNEL_ID };