const { Client, GatewayIntentBits } = require("discord.js");
const { normalizeEvent } = require("../core/event-normalizer");

class DiscordAdapter {
  constructor(options = {}) {
    if (!options.orchestrator) throw new Error("DiscordAdapter requires an orchestrator instance");
    if (!options.token) throw new Error("DiscordAdapter requires a bot token");

    this.orchestrator = options.orchestrator;
    this.token = options.token;
    this.botUserId = null;
    this.client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
  }

  async start() {
    await this.client.login(this.token);
    this.botUserId = this.client.user.id;
    console.log(`DiscordAdapter: logged in as ${this.client.user.username}`);

    this.client.on("messageCreate", async (message) => {
      try {
        if (message.author.id === this.botUserId) return;
        if (message.author.bot) return;

        const rawEvent = {
          platform: "discord",
          user: {
            id: message.author.id,
            name: message.author.username
          },
          content: message.content,
          metadata: {
            channelId: message.channel.id,
            messageId: message.id
          },
          timestamp: Date.now()
        };

        const normalized = normalizeEvent(rawEvent);
        const result = await this.orchestrator.handleEvent(normalized);

        if (result && result.text) {
          await message.channel.send(result.text);
        }
      } catch (err) {
        console.error("DiscordAdapter: messageCreate error:", err.message);
      }
    });
  }

  stop() {
    if (this.client) {
      this.client.destroy();
    }
  }
}

module.exports = { DiscordAdapter };
