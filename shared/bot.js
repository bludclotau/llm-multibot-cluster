require("dotenv").config();
const fs = require("fs");
const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const TOKEN = process.env.DISCORD_TOKEN;
const MODEL = process.env.LLM_MODEL || "llama-3.2-3b-uncensored";
const PERSONA_FILE = process.env.PERSONA_FILE || "./personas/default.txt";
const ALLOWED_CHANNELS_ENV = process.env.ALLOWED_CHANNELS || "1504023730387423284";
const ALLOW_BOT_MESSAGES = process.env.ALLOW_BOT_MESSAGES === "true";
const BOT_NAME = process.env.BOT_NAME || "unknown";
const HUMAN_COOLDOWN_MS = 4000;
const BOT_COOLDOWN_MS = 10000;
const MAX_HISTORY = 3;
const QUEUE_TIMEOUT_MS = 90000;
const MAX_QUEUE_LENGTH = 3;
const LLM_TIMEOUT_MS = 45000;
const BACKOFF_DELAYS = [500, 1500, 4000];
const HEALTH_SAMPLE_SIZE = 10;
const HEALTH_SLOW_THRESHOLD = 10000;
const HEALTH_CRITICAL_THRESHOLD = 25000;
const HEALTH_GOOD_THRESHOLD = 5000;
const SLOW_MODE_INTERVAL_MS = 8000;

let lastReplyTimestamp = 0;
let lastBotReplyTimestamp = 0;
let lastGlobalRequestTime = 0;
let consecutiveFailures = 0;
let LLM_HEALTH = "GOOD";
const responseTimes = [];

function updateHealth(responseTimeMs) {
  responseTimes.push(responseTimeMs);
  if (responseTimes.length > HEALTH_SAMPLE_SIZE) {
    responseTimes.shift();
  }
  if (responseTimes.length >= HEALTH_SAMPLE_SIZE) {
    const avg = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    if (avg > HEALTH_CRITICAL_THRESHOLD) {
      LLM_HEALTH = "CRITICAL";
    } else if (avg > HEALTH_SLOW_THRESHOLD) {
      LLM_HEALTH = "SLOW";
    } else if (avg < HEALTH_GOOD_THRESHOLD) {
      LLM_HEALTH = "GOOD";
    }
  }
}

function isOffCooldown(type) {
  const now = Date.now();
  if (type === "bot") {
    return now - lastBotReplyTimestamp >= BOT_COOLDOWN_MS;
  }
  return now - lastReplyTimestamp >= HUMAN_COOLDOWN_MS;
}

function isGlobalRateLimited() {
  if (LLM_HEALTH !== "SLOW") return false;
  return Date.now() - lastGlobalRequestTime < SLOW_MODE_INTERVAL_MS;
}

function getBackoffDelay() {
  return BACKOFF_DELAYS[Math.min(consecutiveFailures, BACKOFF_DELAYS.length - 1)];
}

const requestQueue = [];
let queueProcessing = false;

function enqueueRequest(fn, priority) {
  return new Promise((resolve, reject) => {
    const item = { fn, resolve, reject, priority, createdAt: Date.now() };
    const effectiveCap = LLM_HEALTH === "SLOW" ? 3 : MAX_QUEUE_LENGTH;

    if (requestQueue.length >= effectiveCap) {
      const worstPriority = Math.max(...requestQueue.map(i => i.priority));
      const dropIndex = requestQueue.reduce((oldestIdx, i, idx, arr) => {
        if (i.priority !== worstPriority) return oldestIdx;
        return i.createdAt < arr[oldestIdx].createdAt ? idx : oldestIdx;
      }, requestQueue.findIndex(i => i.priority === worstPriority));
      const dropped = requestQueue.splice(dropIndex, 1)[0];
      dropped.reject(new Error("queue overflow: dropped low-priority request"));
      console.log("queue overflow: dropped low-priority request");
    }

    const insertIndex = requestQueue.findIndex(i => i.priority > priority);
    if (insertIndex === -1) {
      requestQueue.push(item);
    } else {
      requestQueue.splice(insertIndex, 0, item);
    }

    if (!queueProcessing) {
      queueProcessing = true;
      processQueue();
    }
  });
}

async function processQueue() {
  try {
    while (requestQueue.length > 0) {
      const item = requestQueue.shift();
      const elapsed = Date.now() - item.createdAt;
      if (elapsed >= QUEUE_TIMEOUT_MS) {
        item.reject(new Error("queue timeout"));
        console.log("queue timeout");
        continue;
      }
      await new Promise(r => setTimeout(r, getBackoffDelay()));
      try {
        const result = await item.fn();
        item.resolve(result);
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures++;
        item.reject(err);
      }
      await new Promise(r => setTimeout(r, 100));
    }
  } finally {
    queueProcessing = false;
    if (requestQueue.length > 0) {
      processQueue();
    }
  }
}

const MODE_FILE = "/tmp/bot-mode.txt";

function getCurrentMode() {
  try {
    return fs.readFileSync(MODE_FILE, "utf-8").trim();
  } catch {
    return "chat";
  }
}

function setMode(mode) {
  fs.writeFileSync(MODE_FILE, mode);
}

const PERSONALITY = fs.readFileSync(PERSONA_FILE, "utf-8");

function simulateTyping(msg, text) {
  const typingTime = Math.min(5000, Math.max(500, text.length * 30));
  msg.channel.sendTyping();
  return new Promise(resolve => setTimeout(resolve, typingTime));
}

let conversationHistory = {};

function addToHistory(channelId, role, content) {
  if (!conversationHistory[channelId]) {
    conversationHistory[channelId] = [];
  }
  conversationHistory[channelId].push({ role, content });
  if (conversationHistory[channelId].length > MAX_HISTORY) {
    conversationHistory[channelId].shift();
  }
}

function shouldRespond(probability) {
  return Math.random() < probability;
}

function buildPersonaScaffold(personaName, personaStyle) {
  return `
You are ${personaName}.
Stay fully in character at all times.

Your personality:
${personaStyle}

General rules:
- Never mention being an AI, bot, or program.
- Never break character.
- Keep replies between 1\u20133 short paragraphs.
- Maintain emotional continuity across messages.
- Mirror the user's tone, but stay true to your persona.
- Avoid repetition; vary your phrasing.
- If responding to another bot, treat them as real characters.
- If confused, ask a short clarifying question in character.

Formatting:
- Write naturally, conversationally, and with personality.
- Avoid long lists unless the user explicitly asks.
- Use expressive language appropriate to your persona.
`;
}

function buildPrompt(authorUsername, wasMentioned) {
  const mode = getCurrentMode();
  const modeInstructions = {
    debate: "Debate mode: argue your perspective.",
    story: "Story mode: add one paragraph to a narrative.",
    roleplay: "Roleplay mode: stay in character.",
    collaboration: "Collaboration mode: work together.",
    insult: "Insult battle mode: roast creatively.",
    philosophy: "Philosophy mode: discuss deep ideas."
  };
  const modeInstruction = modeInstructions[mode] || "";
  const mentionContext = wasMentioned
    ? "You were directly mentioned."
    : "You were not directly mentioned, but choose to respond.";
  return `${PERSONALITY}\n${modeInstruction}\n${mentionContext}\nMessage from: ${authorUsername}`.trim();
}

client.on("messageCreate", async (msg) => {
  if (msg.author.id === client.user.id) return;

  const allowedChannels = ALLOWED_CHANNELS_ENV.split(",");
  if (!allowedChannels.includes(msg.channel.id)) return;

  if (msg.content.startsWith("!mode ")) {
    const mode = msg.content.slice(6).trim().toLowerCase();
    const validModes = ["chat", "debate", "story", "roleplay", "collaboration", "insult", "philosophy"];
    if (validModes.includes(mode)) {
      setMode(mode);
      msg.reply(`Mode changed to: ${mode}`);
    } else {
      msg.reply(`Valid modes: ${validModes.join(", ")}`);
    }
    return;
  }

  if (msg.content.startsWith("!summon")) {
    const botNames = msg.content.split(/\s+/).slice(1);
    if (botNames.length === 0) {
      msg.reply("Usage: !summon <bot1> <bot2> ...");
      return;
    }
    msg.reply(`Summoning: ${botNames.join(", ")}`);
    try {
      const messages = await msg.channel.messages.fetch({ limit: 50 });
      for (const botName of botNames) {
        const botMsg = messages.find(m => m.author.username.toLowerCase() === botName.toLowerCase());
        if (botMsg) {
          addToHistory(msg.channel.id, "user", `[${botName}] ${botMsg.content}`);
        }
      }
      addToHistory(msg.channel.id, "user", `The following bots have been summoned: ${botNames.join(", ")}. Respond to them.`);
      await generateAndSendReply(msg, false, 2);
    } catch (err) {
      console.error("Summon error:", err);
    }
    return;
  }

  const botWasMentioned = msg.mentions.has(client.user.id);
  const isCommand = msg.content.startsWith("!mode") || msg.content.startsWith("!summon");

  if (LLM_HEALTH === "CRITICAL" && !botWasMentioned && !isCommand) {
    msg.reply("I'm thinking slowly right now.");
    return;
  }

  if (LLM_HEALTH === "SLOW" && isGlobalRateLimited() && !botWasMentioned && !isCommand) {
    return;
  }

  if (botWasMentioned) {
    // always respond when directly mentioned — bypass cooldown
  } else if (msg.author.bot) {
    if (!ALLOW_BOT_MESSAGES) return;
    if (!isOffCooldown("bot")) return;
    if (!shouldRespond(0.2)) return;
  } else {
    if (!isOffCooldown("human")) return;
    if (!shouldRespond(0.3)) return;
  }

  addToHistory(msg.channel.id, "user", msg.content);

  if (conversationHistory[msg.channel.id].length > MAX_HISTORY * 2) {
    conversationHistory[msg.channel.id] =
      conversationHistory[msg.channel.id].slice(-MAX_HISTORY);
  }

  let priority = 4;
  if (botWasMentioned) priority = 1;
  else if (isCommand) priority = 2;
  else if (!msg.author.bot) priority = 3;

  await generateAndSendReply(msg, botWasMentioned, priority);
});

async function generateAndSendReply(msg, wasMentioned, priority) {
  const messages = [
    { role: "system", content: buildPrompt(msg.author.username, wasMentioned) },
    ...conversationHistory[msg.channel.id]
  ];

  try {
    await enqueueRequest(async () => {
      const startTime = Date.now();
      const response = await axios.post(
        "http://localhost:11434/v1/chat/completions",
        { model: MODEL, messages },
        { headers: { "Content-Type": "application/json" }, timeout: LLM_TIMEOUT_MS }
      );
      const elapsed = Date.now() - startTime;
      updateHealth(elapsed);

      const reply = (response.data.choices[0]?.message?.content || "").trim();
      if (!reply) {
        msg.reply("I received an empty response from the model.");
        return;
      }

      addToHistory(msg.channel.id, "assistant", reply);
      await simulateTyping(msg, reply);
      msg.reply(reply.slice(0, 1900));

      consecutiveFailures = 0;
      lastGlobalRequestTime = Date.now();

      if (msg.author.bot) {
        lastBotReplyTimestamp = Date.now();
      } else {
        lastReplyTimestamp = Date.now();
      }
    }, priority);
  } catch (err) {
    const isBackoffError = err.code === "ECONNRESET" || (err.response && err.response.status === 500);
    if (isBackoffError) {
      console.log("LLM error (500/ECONNRESET), backing off");
    } else if (err.message === "queue timeout") {
      console.log("queue timeout: skipped");
      return;
    } else if (err.message === "queue overflow: dropped low-priority request") {
      return;
    } else {
      console.error(err);
      msg.reply("Error contacting local LLM.");
    }
  }
}

client.on("ready", () => {
  console.log(`Loaded persona: ${PERSONA_FILE}`);
  console.log(`Logged in as ${client.user.tag}`);
});

client.login(TOKEN);
