/* ------------------------------------------------------------------ */
/*  SETTINGS                                                           */
/* ------------------------------------------------------------------ */
const GUILD_ID = '1555272140029173800';

const CHANNELS = {
  members: '1559684413917368370',
  players: '1559685026310918216',
  queue: '1559685443690307704',
};

// Discord only allows a channel to be renamed 2 times every 10 minutes,
// so this can't be faster than about every 5 minutes. 6 is safe.
const UPDATE_EVERY_MS = 6 * 60 * 1000;

// How each channel is named (change the emoji / wording however you like)
const NAMES = {
  members: (count) => `👥 Members: ${count}`,
  players: (current, max) => `🚓 In-Game: ${current}/${max}`,
  playersOffline: () => '🚓 In-Game: Offline',
  queue: (count) => `⏳ Queue: ${count}`,
};

/* ------------------------------------------------------------------ */
/*  ER:LC API                                                          */
/* ------------------------------------------------------------------ */

// looks for your server key in .env under any of these names
function getServerKey() {
  return (
    process.env.ERLC_SERVER_KEY ||
    process.env.ERLC_API_KEY ||
    process.env.ERLC_KEY ||
    process.env.ERLC_TOKEN ||
    process.env.SERVER_KEY ||
    process.env.PRC_SERVER_KEY ||
    process.env.PRC_KEY
  );
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// returns { offline: false, players, max, queue } or { offline: true } or null if the API failed
async function fetchErlc(key) {
  const headers = { 'server-key': key };

  // current API (v2)
  try {
    const res = await fetch('https://api.erlc.gg/v2/server?Queue=true', { headers });
    const data = await readJson(res);

    if (res.ok && data) {
      return {
        offline: false,
        players: data.CurrentPlayers ?? 0,
        max: data.MaxPlayers ?? 0,
        queue: Array.isArray(data.Queue) ? data.Queue.length : 0,
      };
    }
    if (data && data.code === 3002) return { offline: true };
    if (data && data.code === 2002) {
      console.error('[STAT CHANNELS] The ER:LC server key is invalid or expired.');
      return null;
    }
  } catch (err) {
    console.error('[STAT CHANNELS] v2 request failed:', err.message);
  }

  // older API (v1) as a backup
  try {
    const base = 'https://api.policeroleplay.community/v1';
    const [serverRes, queueRes] = await Promise.all([
      fetch(`${base}/server`, { headers }),
      fetch(`${base}/server/queue`, { headers }),
    ]);

    const server = await readJson(serverRes);
    if (serverRes.ok && server) {
      const queue = queueRes.ok ? await readJson(queueRes) : [];
      return {
        offline: false,
        players: server.CurrentPlayers ?? 0,
        max: server.MaxPlayers ?? 0,
        queue: Array.isArray(queue) ? queue.length : 0,
      };
    }
    if (server && server.code === 3002) return { offline: true };
  } catch (err) {
    console.error('[STAT CHANNELS] v1 request failed:', err.message);
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Updating the channels                                              */
/* ------------------------------------------------------------------ */

// only renames if the name actually changed (saves Discord's rename limit)
async function rename(guild, channelId, newName) {
  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel) return;
    if (channel.name === newName) return;
    await channel.setName(newName, 'Live stat channel update');
  } catch (err) {
    console.error(`[STAT CHANNELS] Couldn't rename ${channelId}:`, err.message);
  }
}

let updating = false;

async function update(client) {
  if (updating) return;
  updating = true;

  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
      console.error('[STAT CHANNELS] The bot isn\'t in the server with ID', GUILD_ID);
      return;
    }

    // member count
    await rename(guild, CHANNELS.members, NAMES.members(guild.memberCount));

    // ER:LC players + queue
    const key = getServerKey();
    if (!key) {
      console.error(
        '[STAT CHANNELS] No ER:LC key found in .env (tried ERLC_SERVER_KEY, ERLC_API_KEY, ERLC_KEY...).'
      );
      return;
    }

    const erlc = await fetchErlc(key);
    if (!erlc) return; // API problem - leave the old names alone

    if (erlc.offline) {
      await rename(guild, CHANNELS.players, NAMES.playersOffline());
      await rename(guild, CHANNELS.queue, NAMES.queue(0));
    } else {
      await rename(guild, CHANNELS.players, NAMES.players(erlc.players, erlc.max));
      await rename(guild, CHANNELS.queue, NAMES.queue(erlc.queue));
    }
  } catch (err) {
    console.error('[STAT CHANNELS] Update failed:', err);
  } finally {
    updating = false;
  }
}

function startStatChannels(client) {
  if (typeof fetch !== 'function') {
    console.error(
      '[STAT CHANNELS] This needs Node.js 18 or newer. Run "node -v" to check your version.'
    );
    return;
  }

  update(client); // once right away
  setInterval(() => update(client), UPDATE_EVERY_MS);
}

module.exports = { startStatChannels };