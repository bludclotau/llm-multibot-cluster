#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const WIZARD = path.join(ROOT, "scripts", "deploy-wizard.js");

function fail(msg) {
  console.error("SMOKE FAIL:", msg);
  process.exit(1);
}

function run(args) {
  const res = spawnSync(process.execPath, [WIZARD, ...args], { encoding: "utf8" });
  return res;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bot-wizard-"));
const token = "dummy.smoke.test-token-not-real-xx";
const name = "wizardsmoke";

const good = run([
  "--name", name,
  "--token", token,
  "--channels", "1503348313397923871,1504438057103790120",
  "--guild", "1503348313397923870",
  "--model", "dolphin-2.8-mistral-7b-v02",
  "--traits", "smoke test persona",
  "--allow-bot-messages",
  "--prefix", tmp,
  "--out", tmp,
  "--no-install",
]);
if (good.status !== 0) fail(`wizard exited ${good.status}: ${good.stderr || good.stdout}`);

const envPath = path.join(tmp, name, ".env");
const secretUnit = path.join(tmp, "deploy", `${name}.service`);
const publicUnit = path.join(tmp, "systemd-units", `${name}.service`);
const localUnit = path.join(tmp, name, `${name}.service`);
const persona = path.join(tmp, name, "personas", `${name}.txt`);
const registry = path.join(tmp, "bots.json");

for (const p of [envPath, secretUnit, publicUnit, localUnit, persona, registry]) {
  if (!fs.existsSync(p)) fail(`missing ${p}`);
}

const env = fs.readFileSync(envPath, "utf8");
const secret = fs.readFileSync(secretUnit, "utf8");
const pub = fs.readFileSync(publicUnit, "utf8");
const bots = JSON.parse(fs.readFileSync(registry, "utf8"));

if (!env.includes(`DISCORD_TOKEN=${token}`)) fail(".env missing token");
if (!secret.includes(`Environment=DISCORD_TOKEN=${token}`)) fail("deploy unit missing token");
if (!secret.includes("DISCORD_GUILD_ID=1503348313397923870")) fail("deploy unit missing guild");
if (!secret.includes("ALLOWED_CHANNELS=1503348313397923871,1504438057103790120")) fail("deploy unit missing channels");
if (pub.includes(token)) fail("public systemd unit leaked the token");
if (!pub.includes("EnvironmentFile=")) fail("public unit should load .env");
if (!pub.includes("ExecStart=/usr/bin/node") || !pub.includes("shared/bot.js")) {
  fail("unit does not start shared/bot.js");
}
if (!bots.bots.some((b) => b.name === name && b.guild === "1503348313397923870")) {
  fail("bots.json was not registered");
}

const reserved = run([
  "--name", "bot4",
  "--token", token,
  "--channels", "1503348313397923871",
  "--out", tmp,
  "--prefix", tmp,
  "--no-install",
  "--no-register",
]);
if (reserved.status === 0) fail("wizard must refuse bot4 / Lyla");
if (!/lyla|bot4/i.test(reserved.stderr + reserved.stdout)) {
  fail("refusal message should mention Lyla/bot4");
}

const badChannel = run([
  "--name", "notreal",
  "--token", token,
  "--channels", "nope",
  "--out", tmp,
  "--prefix", tmp,
  "--no-install",
  "--no-register",
]);
if (badChannel.status === 0) fail("wizard must reject a non-snowflake channel");

fs.rmSync(tmp, { recursive: true, force: true });
console.log("SMOKE OK: wizard writes token + server/channel IDs, hides secrets from git units, leaves bot4 alone.");
