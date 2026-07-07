const WebSocket = require("ws");

class KickAdapter {
  constructor(options = {}) {
    if (!options.orchestrator) throw new Error("KickAdapter requires an orchestrator instance");

    this.orchestrator = options.orchestrator;
    this.channel = options.channel || "";
    this.wsUrl = options.wsUrl || "";
    this.ws = null;
    this.reconnectDelay = 5000;
    this.shouldReconnect = true;
  }

  async start() {
    if (!this.wsUrl) {
      console.error("KickAdapter: no wsUrl provided, skipping connection");
      return;
    }

    this.shouldReconnect = true;

    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch (err) {
      console.error("KickAdapter: WebSocket construction failed:", err.message);
      return;
    }

    this.ws.on("open", () => {
      console.log(`KickAdapter: connected to ${this.wsUrl}`);
    });

    this.ws.on("message", async (raw) => {
      try {
        const parsed = JSON.parse(raw.toString());

        if (parsed.type !== "message") return;

        const data = parsed.data;
        if (!data || !data.sender || !data.content) return;

        const normalized = {
          platform: "kick",
          user: {
            id: String(data.sender.id || ""),
            name: String(data.sender.username || "unknown")
          },
          content: String(data.content),
          metadata: {
            channel: String(data.channel || this.channel)
          },
          timestamp: Date.now()
        };

        const result = await this.orchestrator.handleEvent(normalized);

        const replyText = result && result.text ? result.text : "";
        if (replyText.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            action: "sendMessage",
            data: {
              channel: this.channel,
              content: replyText
            }
          }));
        }
      } catch (err) {
        console.error("KickAdapter: message handler error:", err.message);
      }
    });

    this.ws.on("close", () => {
      console.log("KickAdapter: connection closed");
      if (this.shouldReconnect) {
        console.log(`KickAdapter: reconnecting in ${this.reconnectDelay}ms`);
        setTimeout(() => {
          if (this.shouldReconnect) this.start();
        }, this.reconnectDelay);
      }
    });

    this.ws.on("error", (err) => {
      console.error("KickAdapter: WebSocket error:", err.message);
    });
  }

  stop() {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

module.exports = { KickAdapter };
