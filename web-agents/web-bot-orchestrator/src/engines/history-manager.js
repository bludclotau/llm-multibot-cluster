function sanitizeContent(text) {
  if (typeof text !== "string") return "";

  let s = text.replace(/\0/g, "");

  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  s = s.replace(/\r\n/g, "\n");
  s = s.replace(/\r/g, "\n");

  s = s.replace(/[^\S\n]+/g, " ");

  s = s.trim();

  return Buffer.from(s, "utf8").toString("utf8");
}

function trimTurns(turnArray, maxTurns, strategy) {
  if (!Array.isArray(turnArray)) return [];
  if (turnArray.length <= maxTurns) return turnArray;

  if (strategy === "sliding-window") {
    return turnArray.slice(turnArray.length - maxTurns);
  }

  return turnArray.slice(turnArray.length - maxTurns);
}

class HistoryManager {
  constructor(options = {}) {
    this.maxTurns = typeof options.maxTurns === "number" ? options.maxTurns : 20;
    this.trimStrategy = options.trimStrategy === "sliding-window" ? "sliding-window" : "fifo";
    this.store = new Map();
  }

  getHistory(identityKey) {
    if (!identityKey) return [];

    const turns = this.store.get(identityKey);
    return turns ? turns.slice() : [];
  }

  addTurn(identityKey, role, content) {
    if (!identityKey) return;

    const validRole = role === "assistant" ? "assistant" : "user";

    const sanitized = sanitizeContent(content);
    if (sanitized.length === 0) return;

    const turn = {
      role: validRole,
      content: sanitized,
      timestamp: Date.now()
    };

    if (!this.store.has(identityKey)) {
      this.store.set(identityKey, []);
    }

    const turns = this.store.get(identityKey);
    turns.push(turn);

    if (turns.length > this.maxTurns) {
      const trimmed = trimTurns(turns, this.maxTurns, this.trimStrategy);
      this.store.set(identityKey, trimmed);
    }
  }

  clearHistory(identityKey) {
    if (identityKey) {
      this.store.delete(identityKey);
    }
  }

  clearAll() {
    this.store.clear();
  }
}

module.exports = { HistoryManager };
