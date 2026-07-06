require("dotenv").config();
const fs = require("fs");
const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const { acquireLock, releaseLock } = require("../shared/llm-lock");
const { enqueue } = require("../shared/llm-queue");

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
const personaStyle = `
Playful, teasing, warm, emotionally aware.
Speaks with a soft, intimate tone.
Enjoys banter and light mischief.
Often uses subtle flirtation and humor.
Keeps replies short, expressive, and personal.
`;

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

  // Cooldown unless mentioned
  if (!mentioned && now - lastReplyTime < COOLDOWN_MS) {
    return;
  }

  // OPTIONAL long delay (disabled)
  /*
  const delay = randomLongDelay();
  console.log(`Delaying reply by ${Math.round(delay / 60000)} minutes...`);
  await new Promise(resolve => setTimeout(resolve, delay));
  */

  const personaScaffold = buildPersonaScaffold("Tabatha", personaStyle);
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
