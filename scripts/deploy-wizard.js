#!/usr/bin/env node
"use strict";

/**
 * Paint-by-numbers bot deploy wizard.
 * Collects the unique values for one bot and writes the same file shape
 * Tabatha / Wendy / Gumbo already use.
 *
 *   node scripts/deploy-wizard.js
 *   node scripts/deploy-wizard.js --name rex --token '…' --channels 1,2 --guild 9
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const REPO_ROOT = path.resolve(__dirname, "..");
const RESERVED = new Set(["bot4", "lyla", "layla"]);
const DEFAULT_PREFIX = "/home/snerloc/discord-bots";
const DEFAULT_USER = "snerloc";
const DEFAULT_MODEL = "dolphin-2.8-mistral-7b-v02";
const SNOWFLAKE = /^\d{17,20}$/;
const NAME_RE = /^[a-z][a-z0-9_-]{1,31}$/;

function usage() {
  return `Paint-by-numbers bot deploy wizard

Required to launch a bot (shared/bot.js):
  --name       bot slug (BOT_NAME), also the directory name
  --token      Discord bot token (DISCORD_TOKEN) — login fails without this
  --channels   comma-separated Discord channel IDs (ALLOWED_CHANNELS)

Recommended:
  --guild      Discord server / guild ID (DISCORD_GUILD_ID)
  --model      LLM_MODEL (default: ${DEFAULT_MODEL})
  --traits     persona stub text if no persona file exists

Optional:
  --allow-bot-messages / --no-allow-bot-messages
  --prefix     install prefix baked into unit paths (default: ${DEFAULT_PREFIX})
  --user       systemd User= (default: ${DEFAULT_USER})
  --out        where to write files (default: repo root)
  --install    copy the secret-bearing unit to /etc/systemd/system and enable it
  --no-install
  --no-register   do not update bots.json

bot4 / Lyla is reserved and will be refused.
`;
}

function parseArgs(argv) {
  const args = {
    install: false,
    register: true,
    allowBotMessages: true,
    prefix: DEFAULT_PREFIX,
    user: DEFAULT_USER,
    model: DEFAULT_MODEL,
    out: REPO_ROOT,
    traits: "Default helpful bot personality",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--name": args.name = next(); break;
      case "--token": args.token = next(); break;
      case "--channels": args.channels = next(); break;
      case "--guild":
      case "--server": args.guild = next(); break;
      case "--model": args.model = next(); break;
      case "--traits": args.traits = next(); break;
      case "--prefix": args.prefix = next(); break;
      case "--user": args.user = next(); break;
      case "--out": args.out = path.resolve(next()); break;
      case "--allow-bot-messages": args.allowBotMessages = true; break;
      case "--no-allow-bot-messages": args.allowBotMessages = false; break;
      case "--install": args.install = true; break;
      case "--no-install": args.install = false; break;
      case "--no-register": args.register = false; break;
      case "-h":
      case "--help": args.help = true; break;
      default:
        throw new Error(`Unknown flag: ${a}\n\n${usage()}`);
    }
  }
  return args;
}

function parseChannels(raw) {
  const channels = String(raw || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (channels.length === 0) throw new Error("Need at least one channel ID");
  for (const id of channels) {
    if (!SNOWFLAKE.test(id)) {
      throw new Error(`Channel ID looks wrong (want a Discord snowflake): ${id}`);
    }
  }
  return channels;
}

function validate(spec) {
  const name = String(spec.name || "").trim().toLowerCase();
  if (!NAME_RE.test(name)) {
    throw new Error("Bot name must be lowercase, start with a letter, and be 2–32 chars");
  }
  if (RESERVED.has(name)) {
    throw new Error("bot4 / Lyla is a special case — the wizard will not touch it");
  }
  const token = String(spec.token || "").trim();
  if (!token) throw new Error("Discord token is required (DISCORD_TOKEN)");
  if (/\s/.test(token)) throw new Error("Discord token must not contain whitespace");
  if (token.length < 20) throw new Error("Discord token looks too short");
  const channels = parseChannels(spec.channels);
  const guild = spec.guild ? String(spec.guild).trim() : "";
  if (guild && !SNOWFLAKE.test(guild)) {
    throw new Error(`Server / guild ID looks wrong (want a Discord snowflake): ${guild}`);
  }
  return {
    name,
    token,
    channels,
    guild,
    model: String(spec.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    traits: String(spec.traits || "Default helpful bot personality"),
    allowBotMessages: Boolean(spec.allowBotMessages),
    prefix: String(spec.prefix || DEFAULT_PREFIX).replace(/\/+$/, ""),
    user: String(spec.user || DEFAULT_USER),
    out: spec.out || REPO_ROOT,
    install: Boolean(spec.install),
    register: spec.register !== false,
  };
}

function renderSafeUnit(s) {
  const channels = s.channels.join(",");
  const guildLine = s.guild ? `Environment=DISCORD_GUILD_ID=${s.guild}\n` : "";
  return `[Unit]
Description=${s.name} Discord Bot
After=network.target

[Service]
Type=simple
User=${s.user}
WorkingDirectory=${s.prefix}/${s.name}
EnvironmentFile=-${s.prefix}/${s.name}/.env
Environment=PERSONA_FILE=${s.prefix}/${s.name}/personas/${s.name}.txt
Environment=LLM_MODEL=${s.model}
Environment=ALLOWED_CHANNELS=${channels}
${guildLine}Environment=ALLOW_BOT_MESSAGES=${s.allowBotMessages}
Environment=BOT_NAME=${s.name}
ExecStart=/usr/bin/node ${s.prefix}/shared/bot.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
}

function renderSecretUnit(s) {
  const channels = s.channels.join(",");
  const guildLine = s.guild ? `Environment=DISCORD_GUILD_ID=${s.guild}\n` : "";
  return `[Unit]
Description=${s.name} Discord Bot
After=network.target

[Service]
Type=simple
User=${s.user}
WorkingDirectory=${s.prefix}/${s.name}
Environment=DISCORD_TOKEN=${s.token}
${guildLine}Environment=PERSONA_FILE=${s.prefix}/${s.name}/personas/${s.name}.txt
Environment=LLM_MODEL=${s.model}
Environment=ALLOWED_CHANNELS=${channels}
Environment=ALLOW_BOT_MESSAGES=${s.allowBotMessages}
Environment=BOT_NAME=${s.name}
ExecStart=/usr/bin/node ${s.prefix}/shared/bot.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
}

function renderEnv(s) {
  const lines = [
    `# Unique secrets for ${s.name}. Do not commit.`,
    `DISCORD_TOKEN=${s.token}`,
    `BOT_NAME=${s.name}`,
    `ALLOWED_CHANNELS=${s.channels.join(",")}`,
    `LLM_MODEL=${s.model}`,
    `ALLOW_BOT_MESSAGES=${s.allowBotMessages}`,
    `PERSONA_FILE=${s.prefix}/${s.name}/personas/${s.name}.txt`,
  ];
  if (s.guild) lines.push(`DISCORD_GUILD_ID=${s.guild}`);
  return lines.join("\n") + "\n";
}

function renderEnvExample(s) {
  return `# Copy to .env and fill in. .env is gitignored.
DISCORD_TOKEN=
BOT_NAME=${s.name}
ALLOWED_CHANNELS=${s.channels.join(",") || ""}
LLM_MODEL=${s.model}
ALLOW_BOT_MESSAGES=${s.allowBotMessages}
PERSONA_FILE=${s.prefix}/${s.name}/personas/${s.name}.txt
${s.guild ? `DISCORD_GUILD_ID=${s.guild}\n` : ""}`;
}

function renderPersona(s) {
  return `You are ${s.name}, a Discord bot persona.
Your personality is defined by the following traits:
${s.traits}
`;
}

function writeFile(filePath, contents, { overwrite = true } = {}) {
  if (!overwrite && fs.existsSync(filePath)) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, { mode: 0o600 });
  // keep non-secret files group-readable
  if (!filePath.endsWith(".env") && !filePath.includes(`${path.sep}deploy${path.sep}`)) {
    fs.chmodSync(filePath, 0o644);
  }
  return true;
}

function registerBot(s) {
  const registryPath = path.join(s.out, "bots.json");
  let registry = { bots: [] };
  if (fs.existsSync(registryPath)) {
    registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    if (!Array.isArray(registry.bots)) registry.bots = [];
  }
  const entry = {
    name: s.name,
    directory: s.name,
    service: `${s.name}.service`,
    persona: `${s.name}/personas/${s.name}.txt`,
    channels: s.channels,
    model: s.model,
  };
  if (s.guild) entry.guild = s.guild;
  const idx = registry.bots.findIndex((b) => b.name === s.name);
  if (idx === -1) registry.bots.push(entry);
  else registry.bots[idx] = { ...registry.bots[idx], ...entry };
  writeFile(registryPath, JSON.stringify(registry, null, 2) + "\n");
}

function scaffold(s) {
  const written = [];
  const botDir = path.join(s.out, s.name);
  const personaPath = path.join(botDir, "personas", `${s.name}.txt`);
  const envPath = path.join(botDir, ".env");
  const envExamplePath = path.join(botDir, ".env.example");
  const localUnitPath = path.join(botDir, `${s.name}.service`);
  const publicUnitPath = path.join(s.out, "systemd-units", `${s.name}.service`);
  const secretUnitPath = path.join(s.out, "deploy", `${s.name}.service`);

  if (RESERVED.has(s.name) || s.name === "bot4") {
    throw new Error("bot4 / Lyla is a special case — the wizard will not touch it");
  }

  if (writeFile(personaPath, renderPersona(s), { overwrite: false })) {
    written.push(personaPath);
  }
  writeFile(envPath, renderEnv(s));
  written.push(envPath);
  writeFile(envExamplePath, renderEnvExample(s));
  written.push(envExamplePath);

  const safeUnit = renderSafeUnit(s);
  writeFile(localUnitPath, safeUnit);
  written.push(localUnitPath);
  writeFile(publicUnitPath, safeUnit);
  written.push(publicUnitPath);
  writeFile(secretUnitPath, renderSecretUnit(s));
  written.push(secretUnitPath);

  if (s.register) {
    registerBot(s);
    written.push(path.join(s.out, "bots.json"));
  }

  return { written, secretUnitPath, envPath };
}

function maybeInstall(s, secretUnitPath) {
  if (!s.install) return null;
  const { spawnSync } = require("child_process");
  const dest = `/etc/systemd/system/${s.name}.service`;
  const cp = spawnSync("sudo", ["cp", secretUnitPath, dest], { encoding: "utf8" });
  if (cp.status !== 0) {
    throw new Error(`Failed to copy unit to ${dest}: ${cp.stderr || cp.stdout}`);
  }
  const reload = spawnSync("sudo", ["systemctl", "daemon-reload"], { encoding: "utf8" });
  if (reload.status !== 0) {
    throw new Error(`daemon-reload failed: ${reload.stderr || reload.stdout}`);
  }
  const enable = spawnSync("sudo", ["systemctl", "enable", "--now", `${s.name}.service`], {
    encoding: "utf8",
  });
  if (enable.status !== 0) {
    throw new Error(`enable --now failed: ${enable.stderr || enable.stdout}`);
  }
  return dest;
}

function ask(rl, question, def) {
  const hint = def === undefined || def === "" ? "" : ` [${def}]`;
  return new Promise((resolve) => {
    rl.question(`${question}${hint}: `, (answer) => {
      const v = answer.trim();
      resolve(v === "" ? def : v);
    });
  });
}

async function interactive(base) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("Bot deploy wizard — paste the unique values. bot4 / Lyla is left alone.\n");
    const name = await ask(rl, "Bot name (slug)", base.name);
    const token = await ask(rl, "Discord bot token", base.token);
    const guild = await ask(rl, "Discord server / guild ID", base.guild || "");
    const channels = await ask(rl, "Channel IDs (comma-separated)", base.channels);
    const model = await ask(rl, "LLM model", base.model || DEFAULT_MODEL);
    const allowRaw = await ask(
      rl,
      "Allow bot-to-bot messages? (true/false)",
      String(base.allowBotMessages !== false)
    );
    const traits = await ask(rl, "Persona traits (if no persona file yet)", base.traits);
    return {
      ...base,
      name,
      token,
      guild,
      channels,
      model,
      allowBotMessages: String(allowRaw).toLowerCase() !== "false",
      traits,
    };
  } finally {
    rl.close();
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const needsPrompt = !args.name || !args.token || !args.channels;
  const spec = needsPrompt ? await interactive(args) : args;

  let ready;
  try {
    ready = validate(spec);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  const result = scaffold(ready);
  let installed = null;
  try {
    installed = maybeInstall(ready, result.secretUnitPath);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  console.log(`\nEnumerated bot: ${ready.name}`);
  console.log("Wrote:");
  for (const file of result.written) console.log(`  ${file}`);
  console.log(`\nSecret-bearing unit (gitignored): ${result.secretUnitPath}`);
  console.log(`Env file (gitignored):            ${result.envPath}`);
  if (installed) console.log(`Installed unit:                   ${installed}`);
  else console.log("Not installed. Copy the deploy unit onto the host when ready.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  validate,
  scaffold,
  renderSafeUnit,
  renderSecretUnit,
  renderEnv,
  RESERVED,
};
