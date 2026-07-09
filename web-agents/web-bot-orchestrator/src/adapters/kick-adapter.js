const { createClient } = require("@retconned/kick-js");
const { normalizeEvent } = require("../core/event-normalizer");

class KickAdapter {
  constructor(options = {}) {
    if (!options.orchestrator) throw new Error("KickAdapter requires an orchestrator instance");
    if (!options.channelSlug) throw new Error("KickAdapter requires a channelSlug");

    this.orchestrator = options.orchestrator;
    this.channelSlug = options.channelSlug;
    this.client = createClient(options.channelSlug, { logger: options.logger !== false });
    this._running = false;
  }

  async start() {
    const credentials = {
      username: process.env.KICK_BOT_USER,
      password: process.env.KICK_BOT_PASS,
      otp_secret: process.env.KICK_BOT_OTP
    };

    try {
      await this.client.login({ type: "login", credentials });
    } catch (err) {
      throw new Error(`KickAdapter: login failed: ${err.message}`);
    }

    this._running = true;

    this.client.on("ready", () => {
      console.log("KickAdapter: bot connected");
    });

    this.client.on("ChatMessage", async (message) => {
      if (!this._running) return;

      if (!message || !message.sender || !message.content) return;

      if (message.sender.username === process.env.KICK_BOT_USER) return;

      try {
        const rawEvent = {
          platform: "kick",
          user: {
            id: message.sender.id,
            name: message.sender.username
          },
          content: message.content,
          metadata: {
            channel: message.channel,
            messageId: message.id
          },
          timestamp: Date.now()
        };

        const normalized = normalizeEvent(rawEvent);
        const result = await this.orchestrator.handleEvent(normalized);

        const replyText = result && result.text ? result.text.trim() : "";
        if (replyText) {
          await this.client.sendMessage(replyText);
        }
      } catch (err) {
        console.error("KickAdapter: ChatMessage handler error:", err.message);
      }
    });
  }

  stop() {
    this._running = false;
    if (this.client && typeof this.client.disconnect === "function") {
      try {
        this.client.disconnect();
      } catch {
        // ignore
      }
    }
  }
}

module.exports = { KickAdapter };
