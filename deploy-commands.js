require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

console.log('[DEPLOY] Starting...');

const { TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('[DEPLOY] Missing from .env:', [
    !TOKEN && 'TOKEN',
    !CLIENT_ID && 'CLIENT_ID',
    !GUILD_ID && 'GUILD_ID',
  ].filter(Boolean).join(', '));
  process.exit(1);
}

const commands = [];
const seen = new Set();
const directory = path.join(__dirname, 'commands');

for (const file of fs.readdirSync(directory).filter((f) => f.endsWith('.js'))) {
  try {
    const loaded = require(path.join(directory, file));

    // some files hold one command, others (like moderation.js) hold a list
    const list = Array.isArray(loaded.commands) ? loaded.commands : [loaded];
    let added = 0;

    for (const command of list) {
      if (!command || !command.data || !command.execute) continue;

      const json = command.data.toJSON();
      if (seen.has(json.name)) continue;

      seen.add(json.name);
      commands.push(json);
      added++;
    }

    console.log(`[DEPLOY] ${file}: ${added} command(s)`);
  } catch (error) {
    console.error(`[DEPLOY] Could not load commands/${file}:`, error.message);
  }
}

console.log(`[DEPLOY] Sending ${commands.length} command(s) to Discord...`);

// stops it hanging forever if something goes wrong
const timer = setTimeout(() => {
  console.error('[DEPLOY] Timed out after 60 seconds. Check your internet connection and your TOKEN.');
  process.exit(1);
}, 60_000);

const rest = new REST().setToken(TOKEN);

rest
  .put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands })
  .then(() => {
    clearTimeout(timer);
    console.log(
      `[DEPLOY] ✅ Registered ${commands.length} command(s): ${commands.map((c) => c.name).join(', ')}`
    );
    process.exit(0);
  })
  .catch((error) => {
    clearTimeout(timer);
    console.error('[DEPLOY] ❌ Could not register the commands:', error.message);
    process.exit(1);
  });