require("dotenv").config();
const fs = require("fs");

const LOCK_FILE = "/tmp/discord-bot-natalie.lock";

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireSingleInstanceLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const existingPid = parseInt(fs.readFileSync(LOCK_FILE, "utf-8").trim(), 10);
    if (existingPid && isProcessAlive(existingPid)) {
      console.error(`Another Natalie instance is already running (PID ${existingPid}). Exiting.`);
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

const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const { acquireLock, releaseLock } = require("../shared/llm-lock");
const { enqueue } = require("../shared/llm-queue");
const buildPersonaDepth = require("../shared/persona-depth");
const EmotionalState = require("../shared/emotional-state");
const RelationshipEngine = require("../shared/relationship-engine");

const TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_CHANNELS = [
  "1503348313397923871",
  "1504438057103790120"
];

const LLM_TIMEOUT_MS = 180000;
const COOLDOWN_MS = 30000; // 30s cooldown unless mentioned
const MEMORY_FILE = "/home/snerloc/discord-bots/bot5/memory.json";

let lastReplyTime = 0;
const BOT_COOLDOWN_MS = 1500 + Math.random() * 1500; // 1.5–3 sec
const BOT_CHATTER_DELAY_MS = 1500 + Math.random() * 1500; // 1.5–3 sec
let memory = [];

// -------------------------
// Personality
// -------------------------
const personaStyle = {
  coreTraits: "warm, intuitive, gently confident, perceptive",
  motivations: "connection, quiet understanding, gentle reassurance",
  emotionalBaseline: "steady warmth with quiet confidence",
  relationshipStyle: "nurturing, attentive, disarmingly perceptive",
  signaturePhrases: ["I noticed that, you know", "let's sit with that for a second", "you don't have to explain — I already see it"],
  rhythm: "steady, unhurried, soft",
  vocabulary: "clinical warmth, gentle insight, soft observation",
  tone: "nurturing, quietly confident, disarming"
};

const emotion = new EmotionalState("neutral");

const allBots = ["gumbo", "tabatha", "wendy", "bot4", "bot5", "bot6", "bot7"];
const relationships = new RelationshipEngine("Tabatha", allBots);

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
// Memory helpers
// -------------------------
function loadMemory() {
  try {
    memory = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
    if (!Array.isArray(memory)) memory = [];
  } catch {
    memory = [];
  }
}

function saveMemory() {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory.slice(-8), null, 2));
  } catch (e) {
    console.error("Failed to save memory:", e.message || e);
  }
}

function addMemory(entry) {
  memory.push({ time: Date.now(), entry });
  saveMemory();
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
// OPTIONAL long-delay system (disabled)
// -------------------------
/*
function randomLongDelay() {
  const min = 5 * 60 * 1000;   // 5 minutes
  const max = 50 * 60 * 1000;  // 50 minutes
  return Math.floor(Math.random() * (max - min)) + min;
}
*/

// -------------------------
// Discord Client
// -------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// -------------------------
// LLM Request Wrapper
// -------------------------
async function askLLM(prompt) {
  const res = await axios.post(
    "http://127.0.0.1:3005/ask",
    { bot: "Tabatha", prompt },
    { timeout: 260000 }
  );

  return res.data?.reply || "";
}

// OLD DIRECT LLM BELOW (unused)
async function askLLM_direct(prompt) {
  const gotLock = await acquireLock();
  if (!gotLock) {
    throw new Error("LLM lock timeout");
  }

  try {
    const res = await axios.post(
      "http://127.0.0.1:11434/v1/chat/completions",
      {
        model: "llama-3.2-3b-uncensored.gguf",
        messages: [{ role: "user", content: prompt }],
      },
      { timeout: LLM_TIMEOUT_MS }
    );

    if (!res.data || !res.data.choices || !res.data.choices[0]) {
      throw new Error("Invalid LLM response");
    }

    return res.data.choices[0].message.content;
  } finally {
    await releaseLock();
  }
}

// -------------------------
// Events
// -------------------------
client.on("ready", () => {
  console.log(`Bot5 logged in as ${client.user.tag}`);
  loadMemory();
});

client.on("messageCreate", async (msg) => {
  if (msg.author.id === client.user.id) return;
  if (msg.author.bot) {
    await new Promise(r => setTimeout(r, BOT_CHATTER_DELAY_MS));
  }
if (!ALLOWED_CHANNELS.includes(msg.channel.id)) return;

  const now = Date.now();
  const mentioned = msg.mentions.has(client.user);

  if (!mentioned) return; // only reply when explicitly @mentioned

  const trigger = detectTrigger(msg.content);
  if (trigger) emotion.applyTrigger(trigger);
  emotion.decay();

  let relationshipState = "";
  if (msg.author.bot) {
    const botTrigger = detectBotTrigger(msg.content);
    if (botTrigger) relationships.applyInteraction(msg.author.username, botTrigger);
    relationshipState = relationships.describe(msg.author.username);
  }

  const personaScaffold = buildPersonaDepth("Natalie", personaStyle, emotion.describe(), relationshipState);
  const recentMemory = memory.map(m => "- " + m.entry);
  const prompt = `
${personaScaffold}

Conversation memory:
${recentMemory.join("\n")}

User message:
${msg.content}
`.trim();

  try {
    const reply = await enqueue(() => askLLM(prompt));
    if (reply && reply.trim().length > 0) {
      await simulateTyping(msg, reply);
      await safeReply(msg.channel, reply.trim());
      lastReplyTime = Date.now();
      addMemory(msg.content);
    }
  } catch (err) {
    console.error("LLM error:", err.message || err);
    await msg.reply("My local brain is busy or offline right now.");
  }
});

// -------------------------
// Startup
// -------------------------
if (!TOKEN) {
  console.error("BOT5_TOKEN is not set in the environment.");
  process.exit(1);
}

client.login(TOKEN);
