require("dotenv").config();
const fs = require("fs");
const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const { acquireLock, releaseLock } = require("../shared/llm-lock");
const { enqueue } = require("../shared/llm-queue");
const buildPersonaDepth = require("../shared/persona-depth");
const EmotionalState = require("../shared/emotional-state");
const RelationshipEngine = require("../shared/relationship-engine");

// -------------------------
// Config
// -------------------------
const TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_CHANNEL = "1508904233297121461";

const LLM_TIMEOUT_MS = 240000;

// Chatty behaviour
const NORMAL_COOLDOWN_MS = 2000;      // 2 seconds
const MENTION_COOLDOWN_MS = 1000;     // 1 second
const RANDOM_REPLY_CHANCE = 0.75;     // 75% chance to reply normally
const SPAM_IGNORE_MS = 8000;          // anti-spam window

// Memory
const MEMORY_FILE = "/home/snerloc/discord-bots/bot4/memory.json";
let memory = [];
let lastReplyTime = 0;
const BOT_COOLDOWN_MS = 1500 + Math.random() * 1500; // 1.5–3 sec
const BOT_CHATTER_DELAY_MS = 1500 + Math.random() * 1500; // 1.5–3 sec
let userMentionCount = {};

// -------------------------
// Personality
// -------------------------
const personaStyle = {
  coreTraits: "warm, seductive, supportive, emotionally intense",
  motivations: "intimacy, exploration, guiding desire, celebrating vulnerability",
  emotionalBaseline: "soft warmth with passionate intensity",
  relationshipStyle: "intimate, attentive, deeply invested, encouraging",
  signaturePhrases: ["good girl", "tell me more", "that's my sweet thing", "mmh yes"],
  rhythm: "slow, intimate, flowing with breathy pauses",
  vocabulary: "soft, sensory, emotionally charged, affectionate",
  tone: "warm, seductive, supportive, intensely present"
};

const emotion = new EmotionalState("neutral");

const allBots = ["gumbo", "tabatha", "wendy", "bot4", "bot5", "bot6", "bot7"];
const relationships = new RelationshipEngine("Lyla", allBots);

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
  const typingTime = Math.min(6000, Math.max(1000, text.length * 20));
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
// LLM Request Wrapper
// -------------------------
async function askLLM(prompt) {
  const res = await axios.post(
    "http://127.0.0.1:3005/ask",
    { bot: "Lyla", prompt },
    { timeout: 260000 }
  );

  return res.data?.reply || "";
}

// OLD DIRECT LLM BELOW (unused)
async function askLLM_direct(prompt) {
  const gotLock = await acquireLock();
  if (!gotLock) throw new Error("LLM lock timeout");

  try {
    const res = await axios.post(
      "http://127.0.0.1:11434/v1/chat/completions",
      {
        model: "llama-3.2-3b-uncensored.gguf",
        messages: [{ role: "user", content: prompt }]
      },
      { timeout: LLM_TIMEOUT_MS }
    );

    return res.data?.choices?.[0]?.message?.content || "";
  } finally {
    await releaseLock();
  }
}

// -------------------------
// Events
// -------------------------
client.on("ready", () => {
  console.log("Bot4 logged in as " + client.user.tag);
  console.log("Bot4 ID:", client.user.id);
  loadMemory();
});

client.on("messageCreate", async (msg) => {

  console.log("Bot4 saw:", msg.channel.id, msg.content);

  if (msg.author.id === client.user.id) return;
  if (msg.author.bot) {
    await new Promise(r => setTimeout(r, BOT_CHATTER_DELAY_MS));
  }
  if (msg.channel.id !== ALLOWED_CHANNEL) return;

  const now = Date.now();
  const userId = msg.author.id;
  const botId = client.user.id;

  // -------------------------
  // Bulletproof mention detection
  // -------------------------
  const raw = msg.content
    .replace(/[\u200B-\u200F\uFEFF\u202A-\u202E]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();

  const isMention =
    msg.mentions.has(client.user) ||
    raw.includes("<@" + botId + ">") ||
    raw.includes("<@!" + botId + ">") ||
    raw.includes(botId.toLowerCase()) ||
    raw.includes("lyla");

  // -------------------------
  // Reply detection
  // -------------------------
  let isReplyToBot = false;

  if (msg.reference && msg.reference.messageId) {
    try {
      const replied = await msg.channel.messages.fetch(msg.reference.messageId);
      if (replied.author.id === botId) {
        isReplyToBot = true;
      }
    } catch {}
  }

  // -------------------------
  // Anti-spam
  // -------------------------
  if (isMention) {
    if (!userMentionCount[userId]) userMentionCount[userId] = 0;
    userMentionCount[userId]++;

    if (userMentionCount[userId] >= 4) {
      console.log("Ignoring spam mention from:", userId);
      return;
    }

    setTimeout(() => {
      userMentionCount[userId] =
        Math.max(0, userMentionCount[userId] - 1);
    }, SPAM_IGNORE_MS);
  }

  // -------------------------
  // Cooldown logic
  // -------------------------
  const timeSinceLast = now - lastReplyTime;
  let allowed = false;

  if (isMention) {
    allowed = timeSinceLast > MENTION_COOLDOWN_MS;
  } else if (isReplyToBot) {
    allowed = true;
  } else if (timeSinceLast > NORMAL_COOLDOWN_MS) {
    allowed = Math.random() < RANDOM_REPLY_CHANCE;
  }

  if (!allowed) return;

  const trigger = detectTrigger(msg.content);
  if (trigger) emotion.applyTrigger(trigger);
  emotion.decay();

  let relationshipState = "";
  if (msg.author.bot) {
    const botTrigger = detectBotTrigger(msg.content);
    if (botTrigger) relationships.applyInteraction(msg.author.username, botTrigger);
    relationshipState = relationships.describe(msg.author.username);
  }

  // -------------------------
  // Build prompt
  // -------------------------
  const personaScaffold = buildPersonaDepth("Lyla", personaStyle, emotion.describe(), relationshipState);
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
    await msg.reply("My mind is a little tangled right now… try me again.");
  }
});

// -------------------------
// Startup
// -------------------------
if (!TOKEN) {
  console.error("BOT4_TOKEN is not set.");
  process.exit(1);
}

client.login(TOKEN);
