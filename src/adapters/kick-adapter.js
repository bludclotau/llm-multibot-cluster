import { createClient } from "@retconned/kick-js";

export class KickAdapter {
  constructor({ orchestrator, channelSlug, logger = true }) {
    this.orchestrator = orchestrator;
    this.channelSlug = channelSlug;
    this.logger = logger;

    // Create Kick client
    this.client = createClient(channelSlug, { logger });
  }

  async start() {
    // Token login (no Puppeteer, no sandbox, no OTP)
    await this.client.login({
      type: "token",
      credentials: {
        token: process.env.KICK_WENDY_TOKEN
      }
    });

    console.log("Kick bot authenticated via token.");

    // Store bot username once connected
    this.client.on("ready", () => {
      console.log("Kick bot connected to channel:", this.channelSlug);
    });

    // Prevent Wendy from replying to herself
    this.client.on("ChatMessage", async (message) => {
      if (!message || !message.sender) return;

      const botName = this.client.user?.username?.toLowerCase();
      const senderName = message.sender.username.toLowerCase();

      if (botName && senderName === botName) {
        return; // ignore Wendy's own messages
      }

      // Normalize event
      const rawEvent = {
        platform: "kick",
        identityKey: `kick:${message.sender.id}`,
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

      // Process through orchestrator
      const result = await this.orchestrator.handleEvent(rawEvent);

      // Send reply
      await this.client.sendMessage(result.text);
    });
  }
}
