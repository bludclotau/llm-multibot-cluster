const { KickAdapter } = require("../adapters/kick-adapter");
const { WebBotOrchestrator } = require("../core/orchestrator");
const { Router } = require("../core/router");
const { nodes, routerOptions } = require("../core/config");

const { PersonaEngine } = require("../engines/persona-engine");
const { EmotionEngine } = require("../engines/emotion-engine");
const { RelationshipEngine } = require("../engines/relationship-engine");
const { HistoryManager } = require("../engines/history-manager");
const { processLLMResponse } = require("../core/llm-response-processor");

const dotenv = require("dotenv");
dotenv.config();

const router = new Router(nodes, routerOptions);

const personaEngine = new PersonaEngine();
const emotionEngine = new EmotionEngine();
const relationshipEngine = new RelationshipEngine();
const historyManager = new HistoryManager();
const responseProcessor = { processLLMResponse };

personaEngine.bindPersona("kick:wendybot", "wendy");

const orchestrator = new WebBotOrchestrator({
  router,
  personaEngine,
  emotionEngine,
  relationshipEngine,
  historyManager,
  responseProcessor
});

const adapter = new KickAdapter({
  orchestrator,
  channelSlug: process.env.KICK_CHANNEL_SLUG,
  logger: true
});

adapter.start();

console.log("Wendy Kick bot is running...");
