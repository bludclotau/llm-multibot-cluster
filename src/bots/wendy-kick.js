import { KickAdapter } from "../adapters/kick-adapter.js";
import { WebBotOrchestrator } from "../core/orchestrator.js";
import { PersonaEngine } from "../engines/persona-engine.js";

import dotenv from "dotenv";

dotenv.config();

const personaEngine = new PersonaEngine();

const orchestrator = new WebBotOrchestrator({
  personaEngine,
});

const adapter = new KickAdapter({
  orchestrator,
  channelSlug: process.env.KICK_CHANNEL_SLUG,
  logger: true,
});

adapter.start();

console.log("Wendy Kick bot is running...");
