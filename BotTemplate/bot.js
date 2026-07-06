const fs = require("fs");
const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const { acquireLock, releaseLock } = require("../shared/llm-lock");
const { enqueue } = require("../shared/llm-queue");

// -------------------------
// Environment Variables
// -------------------------
const TOKEN = process.env.BOT_TOKEN;   // ⭐ Set in systemd service
const ALLOWED_CHANNELS = [];           // ⭐ Fill with channel IDs

const LLM_TIMEOUT_MS = 180000;
const COOLDOWN_MS = 30000;
const MEMORY_FILE = __dirname + "/memory.json";

let lastReplyTime = 0;
let memory = [];

// -------------------------
// Personality (loaded from file)
// -------------------------
const PERSONA_FILE = __dirname + "/personas/persona.txt";
let PERSONALITY = fs.readFileSync(PERSONA_FILE, "utf8");

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
  if (!gotLock) throw new Error("LLM lock timeout");

  try {
    const res = await axios.post(
      "http://127.0.0.1:11434/v1/chat/completions",
      {
        model: "llama-3.2-3b-uncensored.gguf",
        messages: [{ role: "user", content: prompt }],
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
  console.log(`Bot logged in as ${client.user.tag}`);
  loadMemory();
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (!ALLOWED_CHANNELS.includes(msg.channel.id)) return;

  const now = Date.now();
  const mentioned = msg.mentions.has(client.user);

  if (!mentioned && now - lastReplyTime < COOLDOWN_MS) return;

  const prompt = `
${PERSONALITY}

Memory:
${memory.map(m => "- " + m.entry).join("\n")}

Conversation:
User: ${msg.content}
Bot:`.trim();

  try {
    const reply = await enqueue(() => askLLM(prompt));
    if (reply?.trim()) {
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
  console.error("BOT_TOKEN is not set in the environment.");
  process.exit(1);
}

client.login(TOKEN);
