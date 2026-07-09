function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function detectSentiment(text) {
  if (!text || typeof text !== "string") return "neutral";
  const t = text.toLowerCase();

  const positive = ["thanks", "love", "great", "awesome", "cool"];
  const negative = ["hate", "bad", "terrible", "stupid", "annoying"];

  for (const kw of positive) {
    if (t.includes(kw)) return "positive";
  }
  for (const kw of negative) {
    if (t.includes(kw)) return "negative";
  }

  return "neutral";
}

function applyDecay(record, options) {
  const now = Date.now();
  const elapsed = now - record.lastUpdate;

  if (elapsed > options.decayMs) {
    record.intensity *= 0.5;
    if (record.intensity < 0.05) {
      record.mood = options.baseline;
    }
    record.lastUpdate = now;
  }
}

class EmotionEngine {
  constructor(options = {}) {
    this.baseline = options.baseline || "neutral";
    this.decayMs = typeof options.decayMs === "number" ? options.decayMs : 10 * 60 * 1000;
    this.intensityRange = options.intensityRange || [0, 1];
    this.reactions = {
      positive: ["happy", "warm", "encouraging"],
      negative: ["frustrated", "cold", "dismissive"],
      neutral: ["neutral"],
      ...(options.reactions || {})
    };

    this.store = new Map();
  }

  getState(event) {
    const identityKey = event?.identityKey;
    if (!identityKey) {
      return { mood: this.baseline, intensity: 0 };
    }

    if (!this.store.has(identityKey)) {
      this.store.set(identityKey, {
        identityKey,
        mood: this.baseline,
        intensity: 0,
        lastUpdate: Date.now()
      });
    }

    const record = this.store.get(identityKey);
    applyDecay(record, { decayMs: this.decayMs, baseline: this.baseline });

    return { mood: record.mood, intensity: record.intensity };
  }

  update(event, processedResponse) {
    const identityKey = event?.identityKey;
    if (!identityKey) return;

    if (!this.store.has(identityKey)) {
      this.store.set(identityKey, {
        identityKey,
        mood: this.baseline,
        intensity: 0,
        lastUpdate: Date.now()
      });
    }

    const record = this.store.get(identityKey);
    applyDecay(record, { decayMs: this.decayMs, baseline: this.baseline });

    const userText = event?.content || "";
    const sentiment = detectSentiment(userText);

    if (sentiment === "positive") {
      record.intensity += 0.05;
      record.mood = this.reactions.positive[0];
    } else if (sentiment === "negative") {
      record.intensity += 0.05;
      record.mood = this.reactions.negative[0];
    } else {
      record.intensity = Math.max(0, record.intensity - 0.01);
      if (record.mood !== this.baseline) {
        record.mood = this.reactions.neutral[0];
      }
    }

    record.intensity = clamp(record.intensity, this.intensityRange[0], this.intensityRange[1]);
    record.lastUpdate = Date.now();
  }

  shutdown() {
    this.store.clear();
  }
}

module.exports = { EmotionEngine };
