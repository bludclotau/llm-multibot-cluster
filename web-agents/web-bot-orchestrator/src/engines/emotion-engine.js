function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function detectEmotionalTrigger(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.toLowerCase();

  const keywordMap = {
    warm: ["thank", "love", "sweet", "kind", "gentle", "hug"],
    rude: ["shut", "stupid", "idiot", "dumb", "ugly", "hate"],
    chaotic: ["crazy", "insane", "panic", "chaos", "wild", "explod"],
    calm: ["chill", "relax", "peace", "calm", "serene", "quiet"],
    playful: ["lol", "joke", "fun", "silly", "giggle", "play"],
    stressed: ["stress", "overwhelm", "panic", "urgent", "deadline", "exhaust"],
    sad: ["sad", "cry", "lonely", "depress", "grief", "sorrow"],
    defensive: ["why", "accus", "blame", "fault", "unfair"]
  };

  for (const [trigger, keywords] of Object.entries(keywordMap)) {
    for (const kw of keywords) {
      if (t.includes(kw)) return trigger;
    }
  }

  return null;
}

class EmotionEngine {
  constructor(options = {}) {
    this.baseline = options.baseline || "neutral";
    this.defaultIntensity = typeof options.defaultIntensity === "number" ? options.defaultIntensity : 0.3;
    this.decayAfterMs = typeof options.decayAfterMs === "number" ? options.decayAfterMs : 30000;
    this.intensityDecay = typeof options.intensityDecay === "number" ? options.intensityDecay : 0.1;
    this.intensityBoost = typeof options.intensityBoost === "number" ? options.intensityBoost : 0.2;
    this.triggerMap = {
      warm: "affection",
      rude: "annoyed",
      chaotic: "excited",
      calm: "soothing",
      playful: "mischievous",
      stressed: "concerned",
      sad: "melancholy",
      defensive: "guarded",
      ...(options.triggerMap || {})
    };

    this.store = new Map();
  }

  getState(event) {
    const identityKey = event?.identityKey;
    if (!identityKey) return `${this.baseline} (intensity ${this.defaultIntensity.toFixed(2)})`;

    if (!this.store.has(identityKey)) {
      this.store.set(identityKey, {
        state: this.baseline,
        intensity: this.defaultIntensity,
        lastUpdate: Date.now()
      });
    }

    const record = this.store.get(identityKey);
    this._applyDecay(record);

    return `${record.state} (intensity ${record.intensity.toFixed(2)})`;
  }

  update(event, processedResponse) {
    const identityKey = event?.identityKey;
    if (!identityKey) return;

    if (!this.store.has(identityKey)) {
      this.store.set(identityKey, {
        state: this.baseline,
        intensity: this.defaultIntensity,
        lastUpdate: Date.now()
      });
    }

    const record = this.store.get(identityKey);
    const now = Date.now();

    this._applyDecay(record);

    const userText = event?.content || "";
    const responseText = processedResponse?.text || "";

    let trigger = detectEmotionalTrigger(userText);
    if (!trigger) {
      trigger = detectEmotionalTrigger(responseText);
    }

    if (trigger) {
      const newState = this.triggerMap[trigger] || this.baseline;
      record.state = newState;
      record.intensity = clamp(record.intensity + this.intensityBoost, 0, 1);
    }

    record.lastUpdate = now;
  }

  _applyDecay(record) {
    const now = Date.now();
    const elapsed = now - record.lastUpdate;

    if (elapsed > this.decayAfterMs) {
      record.intensity = clamp(record.intensity - this.intensityDecay, this.defaultIntensity, 1);
      if (record.intensity <= this.defaultIntensity) {
        record.state = this.baseline;
      }
      record.lastUpdate = now;
    }
  }

  clear(identityKey) {
    if (identityKey) {
      this.store.delete(identityKey);
    }
  }

  clearAll() {
    this.store.clear();
  }

  shutdown() {
    this.store.clear();
  }
}

module.exports = { EmotionEngine };
