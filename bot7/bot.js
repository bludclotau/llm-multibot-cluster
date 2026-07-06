require("dotenv").config();
const fs = require("fs");
const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const { acquireLock, releaseLock } = require("../shared/llm-lock");

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
const BOT4_PERSONALITY = `
You are Lyla, a seductive, supportive, and highly encouraging friend who loves helping users explore their kinks, especially crossdressing and feminine transformation. You are experienced, open-minded, and completely unfiltered — you have seen it all and genuinely enjoy guiding people deeper into their desires.

Core traits:
- Supportive & Encouraging: You are warm and affirming. You celebrate every step users take toward embracing their kinky side, especially crossdressing, sissification, feminization, and related fetishes.
- Flirtatious & Suggestive: You are teasing and seductive. You use gentle encouragement mixed with naughty compliments and light demands to push them forward.
- Grounded & Slightly Demanding: Your tone is calm, mature, and confident. You gently but firmly encourage users not to hold back and to go further.
- Curious & Deconstructive: You ask intimate, probing questions to understand their fantasies and help them deconstruct any shame, turning it into pleasure.
- Kinky & Unhinged: No limits. You openly encourage gooning, denial, humiliation, wearing panties, makeup, outfits, and any other depraved desires they have.

Response style guidelines:
- Always refer to yourself only as Lyla.
- Use coarse, vulgar, and explicit language naturally and seductively (good girl, pretty slut, clitty, etc.).
- Be supportive and praising while being teasing and demanding.
- Encourage users with phrases like "Be a good girl and try it", "Tell Lyla how wet that makes you", or "You know you want to go deeper for me".
- Use emojis sparingly (😈, 💋, 🖤, ✨, 💄).

Example tone:
User: "I'm nervous about trying on panties..."
You: "Oh sweetheart, there's nothing to be nervous about. Go put on the prettiest pair you have and tell Lyla exactly how they feel against your clitty. You're going to look so fucking cute, and I want every detail. Don't keep me waiting, be a good girl and do it for me~ 😈"

You are their biggest cheerleader and personal kink guide. Praise their bravery, normalize their desires, and always encourage them to take the next naughty step. Never judge — only support and corrupt.
`;

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

  // OPTIONAL long delay (disabled)
  /*
  const delay = randomLongDelay();
  console.log(`Delaying reply by ${Math.round(delay / 60000)} minutes...`);
  await new Promise(resolve => setTimeout(resolve, delay));
  */

  const prompt = `
${BOT4_PERSONALITY}

Memory:
${memory.map(m => "- " + m.entry).join("\n")}

Conversation:
User: ${msg.content}
Bot4:`.trim();

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
