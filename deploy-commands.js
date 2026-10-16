
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const commands = [];
const dir = path.join(__dirname, 'commands');

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  try {
    const commandModule = require(path.join(dir, file));

    // Support files containing multiple commands.
    if (Array.isArray(commandModule.commands)) {
      for (const command of commandModule.commands) {
        if (command.data) {
          commands.push(command.data.toJSON());
        }
      }
    } else if (commandModule.data) {
      // Support files containing a single command.
      commands.push(commandModule.data.toJSON());
    }
  } catch (error) {
    console.error(`Failed to load commands/${file}:`, error);
    process.exit(1);
  }
}

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log(`✅ Registered ${commands.length} command(s).`);
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
})();
