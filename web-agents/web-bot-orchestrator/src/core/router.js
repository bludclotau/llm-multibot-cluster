const DEFAULT_OPTIONS = {
  maxSlotsPerNode: 1,
  ewmaAlpha: 0.3,
  failureThreshold: 3,
  recoveryCheckMs: 15000,
  requestTimeoutMs: 60000,
  busyPenaltyMs: 5000
};

class Router {
  constructor(nodes, options = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };

    this.nodes = nodes.map((n) => ({
      id: n.id,
      url: n.url.replace(/\/+$/, ""),
      maxSlots: n.maxSlots || this.opts.maxSlotsPerNode,
      slotsInUse: 0,
      latencyMs: n.initialLatencyMs || 2000,
      healthy: true,
      failures: 0,
      lastFailure: 0
    }));

    this._recoveryTimer = setInterval(() => this._recoveryCheck(), this.opts.recoveryCheckMs);
    this._running = true;
  }

  async send(payload) {
    if (!this._running) throw new Error("Router is shut down");

    const node = this._selectNode();
    if (!node) throw new Error("No available nodes");

    node.slotsInUse += 1;

    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.opts.requestTimeoutMs);

    try {
      const res = await fetch(`${node.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeout);
      const data = await res.json();
      const latencyMs = Date.now() - start;

      const alpha = this.opts.ewmaAlpha;
      node.latencyMs = Math.round(node.latencyMs * (1 - alpha) + latencyMs * alpha);
      node.healthy = true;
      node.failures = 0;

      return { data, nodeId: node.id, latencyMs, meta: { nodeUrl: node.url } };
    } catch (err) {
      clearTimeout(timeout);
      node.failures += 1;
      node.lastFailure = Date.now();

      if (node.failures >= this.opts.failureThreshold) {
        node.healthy = false;
        console.error(`router: node ${node.id} marked unhealthy after ${node.failures} failures`);
      }

      node.latencyMs = Math.round(node.latencyMs + this.opts.busyPenaltyMs);

      const latencyMs = Date.now() - start;
      throw Object.assign(new Error(err.message || "Node request failed"), {
        nodeId: node.id,
        latencyMs
      });
    } finally {
      node.slotsInUse -= 1;
    }
  }

  _selectNode() {
    const candidates = this.nodes.filter((n) => n.healthy && n.slotsInUse < n.maxSlots);

    if (candidates.length === 0) {
      const fallback = this.nodes.find((n) => n.healthy);
      if (fallback) return fallback;
      const anyAlive = this.nodes.find((n) => n.slotsInUse < n.maxSlots);
      if (anyAlive) return anyAlive;
      return this.nodes[0] || null;
    }

    candidates.sort((a, b) => {
      const slotsRatioA = a.slotsInUse / Math.max(a.maxSlots, 1);
      const slotsRatioB = b.slotsInUse / Math.max(b.maxSlots, 1);
      if (slotsRatioA !== slotsRatioB) return slotsRatioA - slotsRatioB;
      return a.latencyMs - b.latencyMs;
    });

    return candidates[0];
  }

  _recoveryCheck() {
    const now = Date.now();
    for (const node of this.nodes) {
      if (!node.healthy && now - node.lastFailure >= this.opts.recoveryCheckMs) {
        node.healthy = true;
        node.failures = 0;
        console.error(`router: node ${node.id} restored to healthy`);
      }
    }
  }

  shutdown() {
    this._running = false;
    if (this._recoveryTimer) {
      clearInterval(this._recoveryTimer);
      this._recoveryTimer = null;
    }
  }
}

module.exports = { Router };
