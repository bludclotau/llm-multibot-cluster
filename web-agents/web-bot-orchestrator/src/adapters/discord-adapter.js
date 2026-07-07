const WebSocket = require("ws");

const DISCORD_API = "https://discord.com/api/v10";
const GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";

const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11
};

class DiscordAdapter {
  constructor(options = {}) {
    if (!options.orchestrator) throw new Error("DiscordAdapter requires an orchestrator instance");
    if (!options.token) throw new Error("DiscordAdapter requires a bot token");

    this.orchestrator = options.orchestrator;
    this.token = options.token;
    this.intents = typeof options.intents === "number" ? options.intents : 513;
    this.ws = null;
    this.heartbeatInterval = null;
    this.heartbeatAck = true;
    this.sequence = null;
    this.sessionId = null;
    this.shouldReconnect = true;
    this.reconnectDelay = 5000;
  }

  async start() {
    this.shouldReconnect = true;
    this._connect();
  }

  _connect() {
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }

    try {
      this.ws = new WebSocket(GATEWAY);
    } catch (err) {
      console.error("DiscordAdapter: WebSocket construction failed:", err.message);
      return;
    }

    this.ws.on("open", () => {
      console.log("DiscordAdapter: connected to gateway");
    });

    this.ws.on("message", (raw) => {
      try {
        const packet = JSON.parse(raw.toString());
        this._handlePacket(packet);
      } catch (err) {
        console.error("DiscordAdapter: parse error:", err.message);
      }
    });

    this.ws.on("close", (code) => {
      console.log(`DiscordAdapter: connection closed (code ${code})`);
      this._stopHeartbeat();
      if (this.shouldReconnect) {
        setTimeout(() => {
          if (this.shouldReconnect) this._connect();
        }, this.reconnectDelay);
      }
    });

    this.ws.on("error", (err) => {
      console.error("DiscordAdapter: WebSocket error:", err.message);
    });
  }

  _handlePacket(packet) {
    const { op, d, s, t } = packet;

    if (s !== null && s !== undefined) {
      this.sequence = s;
    }

    switch (op) {
      case OP.HELLO:
        this._startHeartbeat(d.heartbeat_interval);
        this._identify();
        break;

      case OP.HEARTBEAT_ACK:
        this.heartbeatAck = true;
        break;

      case OP.DISPATCH:
        this._handleDispatch(t, d);
        break;

      case OP.RECONNECT:
        console.log("DiscordAdapter: gateway requested reconnect");
        this._reconnect();
        break;

      case OP.INVALID_SESSION:
        console.log("DiscordAdapter: invalid session, re-identifying");
        this._stopHeartbeat();
        setTimeout(() => this._connect(), this.reconnectDelay);
        break;
    }
  }

  _handleDispatch(t, d) {
    if (t === "READY") {
      this.sessionId = d.session_id;
      console.log(`DiscordAdapter: ready as ${d.user?.username || "unknown"}`);
      return;
    }

    if (t === "MESSAGE_CREATE") {
      if (d.author?.bot || d.author?.id === d.application_id) return;

      const normalized = {
        platform: "discord",
        user: {
          id: String(d.author?.id || ""),
          name: String(d.author?.username || "unknown")
        },
        content: String(d.content || ""),
        metadata: {
          channelId: String(d.channel_id || ""),
          guildId: String(d.guild_id || ""),
          messageId: String(d.id || "")
        },
        timestamp: Date.now()
      };

      this.orchestrator
        .handleEvent(normalized)
        .then((result) => {
          const replyText = result && result.text ? result.text : "";
          if (replyText.length > 0) {
            this._sendMessage(d.channel_id, replyText).catch((err) => {
              console.error("DiscordAdapter: sendMessage error:", err.message);
            });
          }
        })
        .catch((err) => {
          console.error("DiscordAdapter: handleEvent error:", err.message);
        });
    }
  }

  _sendMessage(channelId, content) {
    return fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bot ${this.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content })
    });
  }

  _identify() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(JSON.stringify({
      op: OP.IDENTIFY,
      d: {
        token: this.token,
        intents: this.intents,
        properties: {
          os: "linux",
          browser: "node",
          device: "node"
        }
      }
    }));
  }

  _startHeartbeat(intervalMs) {
    this._stopHeartbeat();
    this.heartbeatAck = true;

    this.heartbeatInterval = setInterval(() => {
      if (!this.heartbeatAck) {
        console.error("DiscordAdapter: missed heartbeat ack, reconnecting");
        this._reconnect();
        return;
      }

      this.heartbeatAck = false;

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          op: OP.HEARTBEAT,
          d: this.sequence
        }));
      }
    }, intervalMs);
  }

  _stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  _reconnect() {
    this.shouldReconnect = true;
    this._stopHeartbeat();
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    setTimeout(() => this._connect(), this.reconnectDelay);
  }

  stop() {
    this.shouldReconnect = false;
    this._stopHeartbeat();
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
  }
}

module.exports = { DiscordAdapter };
