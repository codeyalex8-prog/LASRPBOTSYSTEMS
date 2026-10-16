const fs = require('fs');
const path = require('path');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  AttachmentBuilder,
} = require('discord.js');

const rootDir = path.join(__dirname, '..');
const panelsDir = path.join(rootDir, 'panels');
const imagesDir = path.join(rootDir, 'images');

// every .json file in /panels becomes a choice automatically
const choices = fs
  .readdirSync(panelsDir)
  .filter((f) => f.endsWith('.json'))
  .slice(0, 25)
  .map((f) => ({ name: f.replace('.json', ''), value: f.replace('.json', '') }));

// looks for the image in the main folder first, then in /images
function findImage(fileName) {
  const options = [path.join(rootDir, fileName), path.join(imagesDir, fileName)];
  return options.find((p) => fs.existsSync(p));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setuppanel')
    .setDescription('Send a panel into this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o
        .setName('panel')
        .setDescription('Which panel to send')
        .setRequired(true)
        .addChoices(...choices)
    ),

  async execute(interaction) {
    const name = interaction.options.getString('panel');

    let raw;
    let json;
    try {
      raw = fs.readFileSync(path.join(panelsDir, `${name}.json`), 'utf8');
      json = JSON.parse(raw);
    } catch (err) {
      return interaction.reply({
        content: `❌ Couldn't load \`${name}.json\`: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // accepts [ ...components ], { components: [...] }, or a single component
    const components = Array.isArray(json)
      ? json
      : json.components
      ? json.components
      : [json];

    // find every attachment://file in the panel and attach it
    const fileNames = [
      ...new Set(
        [...raw.matchAll(/attachment:\/\/([^"\s]+)/g)].map((m) => m[1])
      ),
    ];
    const files = [];
    for (const fileName of fileNames) {
      const filePath = findImage(fileName);
      if (!filePath) {
        return interaction.reply({
          content: `❌ Image \`${fileName}\` wasn't found. Put it in the main bot folder (next to index.js) and check the name matches exactly.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      files.push(new AttachmentBuilder(filePath, { name: fileName }));
    }

    try {
      // sent as a normal channel message, so it does NOT show "X used /setuppanel"
      await interaction.channel.send({
        components,
        files,
        flags: MessageFlags.IsComponentsV2,
      });
    } catch (err) {
      return interaction.reply({
        content: `❌ Couldn't send the panel: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // only you see this
    await interaction.reply({
      content: '✅ Panel sent.',
      flags: MessageFlags.Ephemeral,
    });
  },
};