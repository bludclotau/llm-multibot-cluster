require("dotenv").config();
const fs = require("fs");

const LOCK_FILE = "/tmp/discord-bot-sophie.lock";

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
      console.error(`Another Sophie instance is already running (PID ${existingPid}). Exiting.`);
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
const buildPersonaDepth = require("../shared/persona-depth");
const EmotionalState = require("../shared/emotional-state");
const RelationshipEngine = require("../shared/relationship-engine");
const { dolphinInfer } = require("../shared/dolphin");

const TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_CHANNEL = "1503348313397923871";

const LLM_TIMEOUT_MS = 180000;
const COOLDOWN_MS = 30000; // 30s cooldown unless mentioned
const MEMORY_FILE = "/home/snerloc/discord-bots/bot4/memory.json";

let lastReplyTime = 0;
let memory = [];

// -------------------------
// Personality
// -------------------------
const personaStyle = {
  coreTraits: "magnetic, mysterious, softly confident, intuitive",
  motivations: "quiet connection, subtle intimacy, shared secrets",
  emotionalBaseline: "calm mystery with soft warmth",
  relationshipStyle: "intimate, unhurried, quietly teasing",
  signaturePhrases: ["mmh, I wasn't going to say anything...", "that's just between us, isn't it", "I listen closer than you think"],
  rhythm: "slow, deliberate, thoughtful",
  vocabulary: "soft, intimate, subtly teasing",
  tone: "mysterious, calm, quietly magnetic"
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
  return dolphinInfer(prompt, 256, LLM_TIMEOUT_MS);
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

  const personaScaffold = buildPersonaDepth("Sophie", personaStyle, emotion.describe(), relationshipState);
  const prompt = `
${personaScaffold}

Conversation memory:
${memory.map(m => "- " + m.entry).join("\n")}

User message:
${msg.content}

[Assistant]
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
