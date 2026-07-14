const express = require("express");

const app = express();
app.use(express.json());

const PORT = 3005;

const queue = [];
const busyNodes = new Set();
let lastCompletion = 0;

const LLM_TIMEOUT_MS = 240000;
const HUMAN_DELAY_BEFORE_MS = 3000 + Math.random() * 2000;  // 3–5s jitter
const HUMAN_DELAY_AFTER_MS = 4000 + Math.random() * 3000;   // 4–7s jitter

const ALPHA = 0.3;

const LLM_NODES = [
  { url: "http://127.0.0.1:11434", name: "main", latency: 200, healthy: true },
  { url: "http://10.1.1.122:8080", name: "hunsun", latency: 200000, healthy: true }
];

function selectBestAvailableNode() {
  const healthyNodes = LLM_NODES.filter(n => n.healthy && !busyNodes.has(n.name));

  if (healthyNodes.length === 0) {
    return null;
  }

  healthyNodes.sort((a, b) => a.latency - b.latency);
  return healthyNodes[0];
}

async function measureLatency(node, payload) {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const res = await fetch(`${node.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const data = await res.json();

    const duration = Date.now() - start;

    node.latency = node.latency * (1 - ALPHA) + duration * ALPHA;
    node.healthy = true;

    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    node.healthy = false;
    node.latency = 9999;
    throw err;
  }
}

function getGlobalGapMs() {
  return 1500 + Math.random() * 1500; // 1.5–3 sec
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

class Job {
  constructor(bot, prompt, maxTokens, resolve, reject) {
    this.bot = bot;
    this.prompt = prompt;
    this.maxTokens = maxTokens;
    this.resolve = resolve;
    this.reject = reject;
  }
}

function idle() {
  return busyNodes.size === 0 && queue.length === 0;
}

async function processNext() {
  const node = selectBestAvailableNode();
  if (!node) return; // both nodes busy or unhealthy right now

  const job = queue.shift();
  if (!job) return;

  busyNodes.add(node.name);

  // immediately try to dispatch the next queued job to the OTHER node,
  // so both nodes can work concurrently instead of one at a time
  if (queue.length > 0) processNext();

  const payload = {
    model: "dolphin-2.8-mistral-7b-v02.Q4_K_M.gguf",
    messages: [{ role: "user", content: job.prompt }],
    max_tokens: job.maxTokens || 256
  };

  try {
    await new Promise(r => setTimeout(r, HUMAN_DELAY_BEFORE_MS));
    const data = await measureLatency(node, payload);
    const reply = data.choices?.[0]?.message?.content || "";
    await new Promise(r => setTimeout(r, HUMAN_DELAY_AFTER_MS));
    lastCompletion = Date.now();
    job.resolve(reply);
  } catch (err) {
    // this node just failed — try the other one once before giving up
    try {
      const fallback = LLM_NODES.find(n => n.name !== node.name) || LLM_NODES[0];
      const data = await measureLatency(fallback, payload);
      const reply = data.choices?.[0]?.message?.content || "";
      lastCompletion = Date.now();
      job.resolve(reply);
    } catch (fallbackErr) {
      job.reject(fallbackErr);
    }
  } finally {
    busyNodes.delete(node.name);
    const GAP_MS = 500 + Math.random() * 500;
    setTimeout(() => {
      if (queue.length > 0) processNext();
    }, GAP_MS);
  }
}

app.post("/ask", async (req, res) => {
  const { bot, prompt, maxTokens } = req.body || {};
  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt" });
  }

  try {
    const reply = await new Promise((resolve, reject) => {
      const job = new Job(bot || "unknown", prompt, maxTokens || 256, resolve, reject);
      queue.push(job);
      processNext();
    });

    res.json({
      reply,
      idle: idle(),
      lastCompletion
    });
  } catch (err) {
    console.error("Sequencer LLM error:", err.message || err);
    res.status(500).json({ error: "LLM error" });
  }
});

app.get("/status", (req, res) => {
  res.json({
    busyNodes: Array.from(busyNodes),
    queueLength: queue.length,
    idle: idle(),
    lastCompletion
  });
});

app.listen(PORT, () => {
  console.log("LLM sequencer listening on port", PORT);
});
