const express = require("express");

const app = express();
app.use(express.json());

const PORT = 3005;

const queue = [];
let busy = false;
let lastCompletion = 0;

const LLM_TIMEOUT_MS = 240000;
const HUMAN_DELAY_BEFORE_MS = 3000 + Math.random() * 2000;  // 3–5s jitter
const HUMAN_DELAY_AFTER_MS = 4000 + Math.random() * 3000;   // 4–7s jitter

const ALPHA = 0.3;

const LLM_NODES = [
  { url: "http://127.0.0.1:11434", name: "main", latency: 200, healthy: true },
  { url: "http://10.1.1.122:8080", name: "hunsun", latency: 600, healthy: true }
];

function selectBestNode() {
  const healthyNodes = LLM_NODES.filter(n => n.healthy);

  if (healthyNodes.length === 0) {
    return LLM_NODES[0];
  }

  healthyNodes.sort((a, b) => a.latency - b.latency);
  return healthyNodes[0];
}

async function measureLatency(node, payload) {
  const start = Date.now();

  try {
    const res = await fetch(`${node.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    const duration = Date.now() - start;

    node.latency = node.latency * (1 - ALPHA) + duration * ALPHA;
    node.healthy = true;

    return data;
  } catch (err) {
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

async function callLLM(payload) {
  const node = selectBestNode();

  try {
    return await measureLatency(node, payload);
  } catch {
    const fallback = LLM_NODES[0];
    return await measureLatency(fallback, payload);
  }
}

class Job {
  constructor(bot, prompt, resolve, reject) {
    this.bot = bot;
    this.prompt = prompt;
    this.resolve = resolve;
    this.reject = reject;
  }
}

function idle() {
  return !busy && queue.length === 0;
}

async function processNext() {
  if (busy) return;
  const job = queue.shift();
  if (!job) return;

  busy = true;

  try {
    await new Promise(r => setTimeout(r, HUMAN_DELAY_BEFORE_MS));

    const payload = {
      model: "dolphin-2.8-mistral-7b-v02.Q4_K_M.gguf",
      messages: [{ role: "user", content: job.prompt }]
    };
    const data = await callLLM(payload);
    const reply = data.choices?.[0]?.message?.content || "";

    await new Promise(r => setTimeout(r, HUMAN_DELAY_AFTER_MS));

    lastCompletion = Date.now();
    job.resolve(reply);
  } catch (err) {
    job.reject(err);
  } finally {
    const GLOBAL_GAP_MS = 1500 + Math.random() * 1500;  // 1.5–3s jitter gap
    busy = false;
    setTimeout(() => {
        if (queue.length > 0) processNext();
    }, GLOBAL_GAP_MS);
  }
}

app.post("/ask", async (req, res) => {
  const { bot, prompt } = req.body || {};
  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt" });
  }

  try {
    const reply = await new Promise((resolve, reject) => {
      const job = new Job(bot || "unknown", prompt, resolve, reject);
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
    busy,
    queueLength: queue.length,
    idle: idle(),
    lastCompletion
  });
});

app.listen(PORT, () => {
  console.log("LLM sequencer listening on port", PORT);
});
