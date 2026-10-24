require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const { TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    '[DEPLOY] TOKEN, CLIENT_ID or GUILD_ID is missing. Add them to .env (or the Railway Variables tab).'
  );
  return;
}

const commands = [];
const seen = new Set();
const directory = path.join(__dirname, 'commands');

for (const file of fs.readdirSync(directory).filter((f) => f.endsWith('.js'))) {
  try {
    const loaded = require(path.join(directory, file));

    // some files hold one command, others (like moderation.js) hold a list
    const list = Array.isArray(loaded.commands) ? loaded.commands : [loaded];

    for (const command of list) {
      if (!command || !command.data || !command.execute) continue;

      const json = command.data.toJSON();
      if (seen.has(json.name)) continue;

      seen.add(json.name);
      commands.push(json);
    }
  } catch (error) {
    console.error(`[DEPLOY] Could not load commands/${file}:`, error.message);
  }
}

const rest = new REST().setToken(TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });

    console.log(
      `[DEPLOY] Registered ${commands.length} command(s): ${commands
        .map((c) => c.name)
        .join(', ')}`
    );
  } catch (error) {
    console.error('[DEPLOY] Could not register the commands:', error);
  }
})();