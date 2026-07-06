require("dotenv").config();
const fs = require("fs");
const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const { acquireLock, releaseLock } = require("../shared/llm-lock");
const buildPersonaDepth = require("../shared/persona-depth");
const EmotionalState = require("../shared/emotional-state");

const TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_CHANNEL = "1508904233297121461";

const LLM_TIMEOUT_MS = 180000;
const COOLDOWN_MS = 30000; // 30s cooldown unless mentioned
const MEMORY_FILE = "/home/snerloc/discord-bots/bot4/memory.json";

let lastReplyTime = 0;
let memory = [];

// -------------------------
// Personality
// -------------------------
const personaStyle = {
  coreTraits: "seductive, supportive, encouraging, completely unfiltered, kink-positive",
  motivations: "guiding exploration, deconstructing shame, celebrating every step deeper",
  emotionalBaseline: "warm, affirming confidence with seductive playfulness",
  relationshipStyle: "intimate cheerleader, trusted guide, naughty confidant",
  signaturePhrases: ["be a good girl and try it", "tell Lyla how that makes you", "you know you want to go deeper", "good girl"],
  rhythm: "calm, mature, confident with playful teasing",
  vocabulary: "vulgar but seductive, explicit yet tender, coarse yet loving",
  tone: "warm, demanding, praising, seductive"
};

const emotion = new EmotionalState("neutral");

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
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory.slice(-20), null, 2));
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
  console.log(`Bot4 logged in as ${client.user.tag}`);
  loadMemory();
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (msg.channel.id !== ALLOWED_CHANNEL) return;

  const now = Date.now();
  const mentioned = msg.mentions.has(client.user);

  // Cooldown unless mentioned
  if (!mentioned && now - lastReplyTime < COOLDOWN_MS) {
    return;
  }

  const trigger = detectTrigger(msg.content);
  if (trigger) emotion.applyTrigger(trigger);
  emotion.decay();

  const personaScaffold = buildPersonaDepth("Lyla", personaStyle, emotion.describe());
  const prompt = `
${personaScaffold}

Conversation memory:
${memory.map(m => "- " + m.entry).join("\n")}

User message:
${msg.content}
`.trim();

  try {
    const reply = await askLLM(prompt);
    if (reply && reply.trim().length > 0) {
      await simulateTyping(msg, reply);
      await msg.reply(reply.trim());
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
  console.error("BOT4_TOKEN is not set in the environment.");
  process.exit(1);
}

client.login(TOKEN);
