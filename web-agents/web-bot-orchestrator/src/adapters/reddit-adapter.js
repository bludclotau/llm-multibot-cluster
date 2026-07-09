class RedditAdapter {
  constructor(options = {}) {
    if (!options.orchestrator) throw new Error("RedditAdapter requires an orchestrator instance");
    if (!options.subreddit) throw new Error("RedditAdapter requires a subreddit");
    if (!options.clientId) throw new Error("RedditAdapter requires clientId");
    if (!options.clientSecret) throw new Error("RedditAdapter requires clientSecret");
    if (!options.refreshToken) throw new Error("RedditAdapter requires refreshToken");
    if (!options.userAgent) throw new Error("RedditAdapter requires a userAgent");

    this.orchestrator = options.orchestrator;
    this.subreddit = options.subreddit;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.refreshToken = options.refreshToken;
    this.userAgent = options.userAgent;

    this.accessToken = null;
    this.pollIntervalMs = options.pollIntervalMs || 5000;
    this.lastSeen = new Map();
    this.ownUsername = null;
    this._pollTimer = null;
    this._running = false;
  }

  async authenticate() {
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    let attempt = 0;
    const maxAttempts = 5;

    while (attempt < maxAttempts) {
      try {
        const res = await fetch("https://www.reddit.com/api/v1/access_token", {
          method: "POST",
          headers: {
            "Authorization": `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": this.userAgent
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: this.refreshToken
          })
        });

        if (!res.ok) {
          throw new Error(`auth status ${res.status}`);
        }

        const data = await res.json();
        this.accessToken = data.access_token;

        if (!this.accessToken) {
          throw new Error("no access_token in response");
        }

        return;
      } catch (err) {
        attempt++;
        if (attempt >= maxAttempts) {
          throw new Error(`RedditAdapter: authentication failed after ${maxAttempts} attempts: ${err.message}`);
        }
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  async start() {
    await this.authenticate();
    await this._fetchOwnUsername();
    this._running = true;
    this.lastSeen.set(this.subreddit, 0);
    await this._poll();
    this._pollTimer = setInterval(() => this._poll(), this.pollIntervalMs);
    console.log(`RedditAdapter: polling r/${this.subreddit} every ${this.pollIntervalMs}ms`);
  }

  async _fetchOwnUsername() {
    try {
      const res = await fetch("https://oauth.reddit.com/api/v1/me", {
        headers: this._apiHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        this.ownUsername = data.name;
      }
    } catch {
      // non-fatal
    }
  }

  _apiHeaders() {
    return {
      "Authorization": `Bearer ${this.accessToken}`,
      "User-Agent": this.userAgent
    };
  }

  async _poll() {
    if (!this._running) return;

    try {
      const res = await fetch(
        `https://oauth.reddit.com/r/${this.subreddit}/comments?limit=50`,
        { headers: this._apiHeaders() }
      );

      if (res.status === 401) {
        await this.authenticate();
        return;
      }

      if (!res.ok) return;

      const json = await res.json();
      const comments = json.data?.children || [];

      let latestTs = this.lastSeen.get(this.subreddit) || 0;

      for (const child of comments) {
        const comment = child.data;
        if (!comment) continue;

        const ts = (comment.created_utc || 0) * 1000;
        if (ts > latestTs) {
          latestTs = ts;
        }

        if (ts <= (this.lastSeen.get(this.subreddit) || 0)) continue;

        if (this._shouldSkip(comment)) continue;

        this._processComment(comment).catch((err) => {
          if (err && err.message !== "no reply text") {
            console.error("RedditAdapter: processComment error:", err.message);
          }
        });
      }

      this.lastSeen.set(this.subreddit, latestTs);
    } catch (err) {
      console.error("RedditAdapter: poll error:", err.message);
    }
  }

  _shouldSkip(comment) {
    if (comment.author === "[deleted]") return true;
    if (!comment.body || comment.body === "[removed]") return true;
    if (comment.distinguished === "moderator") return true;
    if (comment.author === this.ownUsername) return true;
    return false;
  }

  async _processComment(comment) {
    const rawEvent = {
      platform: "reddit",
      user: {
        id: comment.author_fullname || "",
        name: comment.author || "unknown"
      },
      content: comment.body || "",
      metadata: {
        subreddit: this.subreddit,
        commentId: comment.id,
        parentId: comment.parent_id
      },
      timestamp: (comment.created_utc || 0) * 1000
    };

    const result = await this.orchestrator.handleEvent(rawEvent);
    const replyText = result && result.text ? result.text.trim() : "";

    if (!replyText) {
      throw new Error("no reply text");
    }

    await this._reply(comment.id, replyText);
  }

  async _reply(commentId, text) {
    const res = await fetch("https://oauth.reddit.com/api/comment", {
      method: "POST",
      headers: {
        ...this._apiHeaders(),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        api_type: "json",
        thing_id: `t1_${commentId}`,
        text
      })
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`reply failed (${res.status}): ${body}`);
    }
  }

  stop() {
    this._running = false;
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }
}

module.exports = { RedditAdapter };
