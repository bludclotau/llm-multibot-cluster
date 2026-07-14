require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");
const buildPersonaDepth = require("./persona-depth");
const EmotionalState = require("./emotional-state");
const RelationshipEngine = require("./relationship-engine");
const { dolphinInfer, buildPrompt: buildDolphinPrompt } = require("./dolphin");
const { enqueue } = require("./llm-queue");

// -------------------------
// CLI: --persona <name>
// -------------------------
const personaArgIndex = process.argv.indexOf("--persona");
const PERSONA_NAME = personaArgIndex !== -1 ? process.argv[personaArgIndex + 1] : process.env.BOT_NAME;
if (!PERSONA_NAME) {
  console.error("Usage: node shared/bot-runtime.js --persona <botname>");
  process.exit(1);
}

// -------------------------
// Load persona.json
// -------------------------
const personaJsonPath = path.join(process.cwd(), "persona.json");
let personaData;
try {
  personaData = JSON.parse(fs.readFileSync(personaJsonPath, "utf-8"));
} catch {
  console.error(`persona.json not found in ${process.cwd()}`);
  process.exit(1);
}

const BOT_NAME = personaData.name;
const personaStyle = {
  coreTraits: personaData.coreTraits,
  motivations: personaData.motivations,
  emotionalBaseline: personaData.emotionalBaseline,
  relationshipStyle: personaData.relationshipStyle,
  signaturePhrases: personaData.signaturePhrases || [],
  rhythm: personaData.rhythm,
  vocabulary: personaData.vocabulary,
  tone: personaData.tone
};

// -------------------------
// Single-instance lock
// -------------------------
const LOCK_FILE = `/tmp/discord-bot-${BOT_NAME.toLowerCase()}.lock`;

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function acquireSingleInstanceLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const existingPid = parseInt(fs.readFileSync(LOCK_FILE, "utf-8").trim(), 10);
    if (existingPid && isProcessAlive(existingPid)) {
      console.error(`Another ${BOT_NAME} instance is already running (PID ${existingPid}). Exiting.`);
      process.exit(1);
    }
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  process.on("exit", () => {
    try {
      if (fs.readFileSync(LOCK_FILE, "utf-8").trim() === String(process.pid)) {
        fs.unlinkSync(LOCK_FILE);
      }
    } catch {}
  });
}

acquireSingleInstanceLock();

// -------------------------
// Config
// -------------------------
const TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_CHANNELS = (process.env.ALLOWED_CHANNELS || "").split(",").filter(Boolean);
const ALLOW_BOT_MESSAGES = process.env.ALLOW_BOT_MESSAGES === "true";

const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || "180000", 10);
const MEMORY_LIMIT = parseInt(process.env.MEMORY_LIMIT || "8", 10);
const BOT_COOLDOWN_MS = 1500 + Math.random() * 1500;
const BOT_CHATTER_DELAY_MS = 1500 + Math.random() * 1500;
const HUMAN_COOLDOWN_MS = 4000;
const QUEUE_TIMEOUT_MS = 90000;
const MAX_QUEUE_LENGTH = 3;
const BACKOFF_DELAYS = [500, 1500, 4000];
const HEALTH_SAMPLE_SIZE = 10;
const HEALTH_SLOW_THRESHOLD = 10000;
const HEALTH_CRITICAL_THRESHOLD = 25000;
const HEALTH_GOOD_THRESHOLD = 5000;
const SLOW_MODE_INTERVAL_MS = 8000;
const SPAM_IGNORE_MS = 8000;
const SPAM_THRESHOLD = 4;

// -------------------------
// State
// -------------------------
const MEMORY_FILE = path.join(process.cwd(), "memory.json");
let memory = [];
let lastReplyTime = 0;
let consecutiveFailures = 0;
let LLM_HEALTH = "GOOD";
const responseTimes = [];
const userMentionCount = {};
let conversationHistory = {};
const MAX_HISTORY = 3;

const emotion = new EmotionalState("neutral");
const allBots = ["gumbo", "tabatha", "wendy", "bot4", "bot5", "bot6", "bot7"];
const relationships = new RelationshipEngine(BOT_NAME, allBots);

// -------------------------
// Memory helpers
// -------------------------
function loadMemory() {
  try {
    memory = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
    if (!Array.isArray(memory)) memory = [];
  } catch { memory = []; }
}

function saveMemory() {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory.slice(-MEMORY_LIMIT), null, 2));
  } catch (e) {
    console.error("Failed to save memory:", e.message || e);
  }
}

function addMemory(entry) {
  memory.push({ time: Date.now(), entry });
  saveMemory();
}

// -------------------------
// Health tracking
// -------------------------
function updateHealth(responseTimeMs) {
  responseTimes.push(responseTimeMs);
  if (responseTimes.length > HEALTH_SAMPLE_SIZE) responseTimes.shift();
  if (responseTimes.length >= HEALTH_SAMPLE_SIZE) {
    const avg = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    if (avg > HEALTH_CRITICAL_THRESHOLD) LLM_HEALTH = "CRITICAL";
    else if (avg > HEALTH_SLOW_THRESHOLD) LLM_HEALTH = "SLOW";
    else if (avg < HEALTH_GOOD_THRESHOLD) LLM_HEALTH = "GOOD";
  }
}

function getBackoffDelay() {
  return BACKOFF_DELAYS[Math.min(consecutiveFailures, BACKOFF_DELAYS.length - 1)];
}

// -------------------------
// Queue
// -------------------------
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
    }
    const insertIndex = requestQueue.findIndex(i => i.priority > priority);
    if (insertIndex === -1) requestQueue.push(item);
    else requestQueue.splice(insertIndex, 0, item);
    if (!queueProcessing) { queueProcessing = true; processQueue(); }
  });
}

async function processQueue() {
  try {
    while (requestQueue.length > 0) {
      const item = requestQueue.shift();
      const elapsed = Date.now() - item.createdAt;
      if (elapsed >= QUEUE_TIMEOUT_MS) { item.reject(new Error("queue timeout")); continue; }
      await new Promise(r => setTimeout(r, getBackoffDelay()));
      try { const result = await item.fn(); item.resolve(result); consecutiveFailures = 0; }
      catch (err) { consecutiveFailures++; item.reject(err); }
      await new Promise(r => setTimeout(r, 100));
    }
  } finally {
    queueProcessing = false;
    if (requestQueue.length > 0) processQueue();
  }
}

// -------------------------
// Mode (optional shared mode file)
// -------------------------
const MODE_FILE = "/tmp/bot-mode.txt";
function getCurrentMode() {
  try { return fs.readFileSync(MODE_FILE, "utf-8").trim(); } catch { return "chat"; }
}
function setMode(mode) { fs.writeFileSync(MODE_FILE, mode); }

// -------------------------
// Trigger detection
// -------------------------
function detectBotTrigger(message) {
  const text = message.toLowerCase();
  if (text.includes("love") || text.includes("thanks")) return "warm";
  if (text.includes("lol") || text.includes("haha")) return "playful";
  if (text.includes("chaos") || text.includes("feral")) return "chaotic";
  if (text.includes("calm") || text.includes("breathe")) return "calm";
  if (text.includes("help") || text.includes("support")) return "support";
  if (text.includes("shut up") || text.includes("stupid")) return "rude";
  return null;
}

function detectTrigger(message) {
  const text = message.toLowerCase();
  if (text.includes("love") || text.includes("thank")) return "warm";
  if (text.includes("calm") || text.includes("slow")) return "calm";
  if (text.includes("stress") || text.includes("help")) return "stressed";
  if (text.includes("lol") || text.includes("haha")) return "playful";
  if (text.includes("chaos") || text.includes("feral")) return "chaotic";
  if (text.includes("shut up") || text.includes("stupid")) return "rude";
  return null;
}

// -------------------------
// Typing simulation
// -------------------------
function simulateTyping(msg, text) {
  const typingTime = Math.min(8000, Math.max(1500, text.length * 25));
  msg.channel.sendTyping();
  return new Promise(resolve => setTimeout(resolve, typingTime));
}

async function safeReply(channel, content) {
  const now = Date.now();
  const diff = now - lastReplyTime;
  if (diff < BOT_COOLDOWN_MS) {
    await new Promise(r => setTimeout(r, BOT_COOLDOWN_MS - diff));
  }
  lastReplyTime = Date.now();
  return channel.send(content);
}

// -------------------------
// Prompt building
// -------------------------
function buildPrompt(authorUsername, wasMentioned, relationshipState) {
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

  const personaScaffold = buildPersonaDepth(
    personaData.displayName || BOT_NAME,
    personaStyle,
    emotion.describe(),
    relationshipState
  );
  return `${personaScaffold}\n${modeInstruction}\n${mentionContext}\nMessage from: ${authorUsername}`.trim();
}

function addToHistory(channelId, role, content) {
  if (!conversationHistory[channelId]) conversationHistory[channelId] = [];
  conversationHistory[channelId].push({ role, content });
  if (conversationHistory[channelId].length > MAX_HISTORY) conversationHistory[channelId].shift();
}

// -------------------------
// Discord Client
// -------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// -------------------------
// Event: ready
// -------------------------
client.on("ready", () => {
  console.log(`[${BOT_NAME}] logged in as ${client.user.tag}`);
  loadMemory();
});

// -------------------------
// Event: messageCreate
// -------------------------
client.on("messageCreate", async (msg) => {
  if (msg.author.id === client.user.id) return;

  // Channel check
  if (ALLOWED_CHANNELS.length > 0 && !ALLOWED_CHANNELS.includes(msg.channel.id)) return;

  // Bot message handling
  if (msg.author.bot) {
    if (!ALLOW_BOT_MESSAGES) return;
    await new Promise(r => setTimeout(r, BOT_CHATTER_DELAY_MS));
  }

  // Commands
  if (msg.content.startsWith("!mode ")) {
    const mode = msg.content.slice(6).trim().toLowerCase();
    const validModes = ["chat", "debate", "story", "roleplay", "collaboration", "insult", "philosophy"];
    if (validModes.includes(mode)) { setMode(mode); msg.reply(`Mode changed to: ${mode}`); }
    else { msg.reply(`Valid modes: ${validModes.join(", ")}`); }
    return;
  }

  if (msg.content.startsWith("!summon")) {
    const botNames = msg.content.split(/\s+/).slice(1);
    if (botNames.length === 0) { msg.reply("Usage: !summon <bot1> <bot2> ..."); return; }
    msg.reply(`Summoning: ${botNames.join(", ")}`);
    try {
      const messages = await msg.channel.messages.fetch({ limit: 50 });
      for (const botName of botNames) {
        const botMsg = messages.find(m => m.author.username.toLowerCase() === botName.toLowerCase());
        if (botMsg) addToHistory(msg.channel.id, "user", `[${botName}] ${botMsg.content}`);
      }
      addToHistory(msg.channel.id, "user", `The following bots have been summoned: ${botNames.join(", ")}. Respond to them.`);
      await generateAndSendReply(msg, false, 2);
    } catch (err) { console.error("Summon error:", err); }
    return;
  }

  // Mention-only reply
  const now = Date.now();
  const botWasMentioned = msg.mentions.has(client.user);
  console.log(`[${BOT_NAME}] handling msg.id=${msg.id} author=${msg.author.username} mentioned=${botWasMentioned} at ${new Date().toISOString()}`);

  if (!botWasMentioned) return;

  // Anti-spam
  const userId = msg.author.id;
  if (!userMentionCount[userId]) userMentionCount[userId] = 0;
  userMentionCount[userId]++;
  if (userMentionCount[userId] >= SPAM_THRESHOLD) {
    console.log(`[${BOT_NAME}] Ignoring spam mention from: ${userId}`);
    return;
  }
  setTimeout(() => { userMentionCount[userId] = Math.max(0, userMentionCount[userId] - 1); }, SPAM_IGNORE_MS);

  if (LLM_HEALTH === "CRITICAL" && !botWasMentioned) { msg.reply("I'm thinking slowly right now."); return; }

  // Emotional state
  const trigger = detectTrigger(msg.content);
  if (trigger) emotion.applyTrigger(trigger);
  emotion.decay();

  addToHistory(msg.channel.id, "user", msg.content);
  if (conversationHistory[msg.channel.id] && conversationHistory[msg.channel.id].length > MAX_HISTORY * 2) {
    conversationHistory[msg.channel.id] = conversationHistory[msg.channel.id].slice(-MAX_HISTORY);
  }

  await generateAndSendReply(msg, botWasMentioned, 1);
});

// -------------------------
// generateAndSendReply
// -------------------------
async function generateAndSendReply(msg, wasMentioned, priority) {
  let relationshipState = "";
  if (msg.author.bot) {
    const trigger = detectBotTrigger(msg.content);
    if (trigger) relationships.applyInteraction(msg.author.username, trigger);
    relationshipState = relationships.describe(msg.author.username);
  }

  async function callOnce() {
    const startTime = Date.now();
    const flatPrompt = buildDolphinPrompt(
      buildPrompt(msg.author.username, wasMentioned, relationshipState),
      conversationHistory[msg.channel.id],
      null
    );
    const reply = await dolphinInfer(flatPrompt, 256, LLM_TIMEOUT_MS);
    const elapsed = Date.now() - startTime;
    updateHealth(elapsed);
    if (!reply) { msg.reply("I received an empty response from the model."); return; }

    addToHistory(msg.channel.id, "assistant", reply);
    await simulateTyping(msg, reply);
    console.log(`[${BOT_NAME}] SENDING reply for msg.id=${msg.id} at ${new Date().toISOString()}`);

    if (msg.author.bot) {
      await safeReply(msg.channel, reply.slice(0, 1900));
    } else {
      await msg.reply(reply.slice(0, 1900));
    }

    consecutiveFailures = 0;
    addMemory(msg.content);
  }

  try {
    await enqueueRequest(async () => {
      try { await callOnce(); } catch (err) {
        const isBackoffError = err.code === "ECONNRESET" || (err.response && err.response.status === 500);
        if (!isBackoffError) throw err;
        console.log("[${BOT_NAME}] LLM error (500/ECONNRESET), retrying once");
        await new Promise(r => setTimeout(r, 1500));
        try { await callOnce(); } catch (retryErr) {
          console.log("[${BOT_NAME}] LLM retry also failed, notifying channel");
          msg.reply("Having trouble thinking right now — try again in a moment.");
          throw retryErr;
        }
      }
    }, priority);
  } catch (err) {
    if (err.message === "queue timeout" || err.message === "queue overflow: dropped low-priority request") return;
    console.error(err);
    msg.reply("Error contacting local LLM.");
  }
}

// -------------------------
// Startup
// -------------------------
if (!TOKEN) {
  console.error(`DISCORD_TOKEN is not set for ${BOT_NAME}.`);
  process.exit(1);
}

client.login(TOKEN);
