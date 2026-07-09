const { normalizeEvent } = require("./event-normalizer");

function buildLLMRequest({ event, personaState, emotionState, relationshipState, conversationHistory }) {
  const messages = [];

  if (personaState && personaState.description) {
    let systemContent = personaState.description;
    if (Array.isArray(personaState.styleRules) && personaState.styleRules.length > 0) {
      systemContent += "\n\nStyle rules:\n- " + personaState.styleRules.join("\n- ");
    }
    if (personaState.tone) {
      systemContent += "\n\nTone: " + personaState.tone;
    }
    messages.push({ role: "system", content: systemContent });
  }

  if (emotionState) {
    messages.push({ role: "system", content: "Current emotional state: " + emotionState });
  }

  if (relationshipState) {
    messages.push({ role: "system", content: "Relationship with current speaker: " + relationshipState });
  }

  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    for (const turn of conversationHistory) {
      if (turn.role === "user" || turn.role === "assistant") {
        messages.push({ role: turn.role, content: turn.content });
      }
    }
  }

  if (event && event.content) {
    messages.push({ role: "user", content: event.content });
  }

  return { messages };
}

class WebBotOrchestrator {
  constructor(options = {}) {
    this.router = options.router || null;
    this.personaEngine = options.personaEngine || null;
    this.emotionEngine = options.emotionEngine || null;
    this.relationshipEngine = options.relationshipEngine || null;
    this.historyManager = options.historyManager || null;
    this.responseProcessor = options.responseProcessor || null;
  }

  async handleEvent(rawEvent) {
    const event = normalizeEvent(rawEvent);

    let personaState = null;
    let emotionState = null;
    let relationshipState = null;
    let conversationHistory = [];

    if (this.personaEngine) {
      try {
        personaState = this.personaEngine.getState(event);
      } catch (err) {
        console.error("orchestrator: personaEngine.getState error:", err.message);
      }
    }

    if (this.emotionEngine) {
      try {
        emotionState = this.emotionEngine.getState(event);
      } catch (err) {
        console.error("orchestrator: emotionEngine.getState error:", err.message);
      }
    }

    if (this.relationshipEngine) {
      try {
        relationshipState = this.relationshipEngine.getState(event);
      } catch (err) {
        console.error("orchestrator: relationshipEngine.getState error:", err.message);
      }
    }

    if (this.historyManager) {
      try {
        conversationHistory = this.historyManager.getHistory(event.identityKey);
      } catch (err) {
        console.error("orchestrator: historyManager.getHistory error:", err.message);
      }
    }

    if (this.historyManager) {
      try {
        this.historyManager.addTurn(event.identityKey, "user", event.content);
      } catch (err) {
        console.error("orchestrator: historyManager.addTurn (user) error:", err.message);
      }
    }

    const payload = buildLLMRequest({ event, personaState, emotionState, relationshipState, conversationHistory });

    let result = null;

    if (this.router) {
      try {
        result = await this.router.send(payload);
      } catch (err) {
        console.error("orchestrator: router.send error:", err.message);
      }
    }

    let processed = { text: "", nodeId: null, latencyMs: null, meta: {} };

    if (result && this.responseProcessor) {
      try {
        processed = this.responseProcessor.processLLMResponse(result, {
          format: event.platform
        });
      } catch (err) {
        console.error("orchestrator: responseProcessor error:", err.message);
      }
    } else if (result && result.data) {
      processed.text = result.data.content || "";
      processed.nodeId = result.nodeId;
      processed.latencyMs = result.latencyMs;
      processed.meta = result.meta || {};
    }

    if (this.historyManager && processed.text) {
      try {
        this.historyManager.addTurn(event.identityKey, "assistant", processed.text);
      } catch (err) {
        console.error("orchestrator: historyManager.addTurn (assistant) error:", err.message);
      }
    }

    if (this.emotionEngine) {
      try {
        this.emotionEngine.update(event, processed);
      } catch (err) {
        console.error("orchestrator: emotionEngine.update error:", err.message);
      }
    }

    if (this.relationshipEngine) {
      try {
        this.relationshipEngine.update(event, processed);
      } catch (err) {
        console.error("orchestrator: relationshipEngine.update error:", err.message);
      }
    }

    return {
      text: processed.text,
      nodeId: processed.nodeId,
      latencyMs: processed.latencyMs,
      meta: processed.meta
    };
  }

  shutdown() {
    if (this.router && typeof this.router.shutdown === "function") {
      try {
        this.router.shutdown();
      } catch (err) {
        console.error("orchestrator: router.shutdown error:", err.message);
      }
    }

    const engines = [
      this.personaEngine,
      this.emotionEngine,
      this.relationshipEngine,
      this.historyManager,
      this.responseProcessor
    ];

    for (const engine of engines) {
      if (engine && typeof engine.shutdown === "function") {
        try {
          engine.shutdown();
        } catch (err) {
          console.error("orchestrator: engine.shutdown error:", err.message);
        }
      }
    }
  }
}

module.exports = { WebBotOrchestrator };
