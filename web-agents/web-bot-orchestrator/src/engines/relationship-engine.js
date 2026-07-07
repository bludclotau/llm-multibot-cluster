function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function computeFamiliarity(interactions, thresholds) {
  if (interactions >= thresholds.close) return "close";
  if (interactions >= thresholds.familiar) return "familiar";
  if (interactions >= thresholds.regular) return "regular";
  return "stranger";
}

class RelationshipEngine {
  constructor(options = {}) {
    this.initialTrust = typeof options.initialTrust === "number" ? options.initialTrust : 0.5;
    this.trustDecayMs = typeof options.trustDecayMs === "number" ? options.trustDecayMs : 7 * 24 * 60 * 60 * 1000;
    this.familiarityThresholds = {
      stranger: 0,
      regular: 10,
      familiar: 30,
      close: 75,
      ...(options.familiarityThresholds || {})
    };
    this.store = new Map();
  }

  getState(event) {
    const identityKey = event?.identityKey;
    if (!identityKey) {
      return { familiarity: "stranger", trustScore: this.initialTrust };
    }

    if (!this.store.has(identityKey)) {
      this.store.set(identityKey, {
        identityKey,
        interactions: 0,
        trustScore: this.initialTrust,
        lastInteraction: Date.now()
      });
    }

    const record = this.store.get(identityKey);
    const familiarity = computeFamiliarity(record.interactions, this.familiarityThresholds);

    return { familiarity, trustScore: record.trustScore };
  }

  update(event, processedResponse) {
    const identityKey = event?.identityKey;
    if (!identityKey) return;

    if (!this.store.has(identityKey)) {
      this.store.set(identityKey, {
        identityKey,
        interactions: 0,
        trustScore: this.initialTrust,
        lastInteraction: Date.now()
      });
    }

    const record = this.store.get(identityKey);
    const now = Date.now();

    record.interactions += 1;
    record.lastInteraction = now;

    if (processedResponse && typeof processedResponse.text === "string") {
      const text = processedResponse.text.toLowerCase();
      const positiveWords = ["thank", "great", "help", "yes", "good", "love", "perfect", "awesome", "nice", "correct"];
      const negativeWords = ["no", "not", "can't", "won't", "refuse", "sorry", "unable", "wrong", "bad"];

      let isPositive = false;
      let isNegative = false;

      for (const word of positiveWords) {
        if (text.includes(word)) {
          isPositive = true;
          break;
        }
      }

      if (!isPositive) {
        for (const word of negativeWords) {
          if (text.includes(word)) {
            isNegative = true;
            break;
          }
        }
      }

      if (isPositive) {
        record.trustScore += 0.01;
      } else if (isNegative) {
        record.trustScore -= 0.01;
      }

      record.trustScore = clamp(record.trustScore, 0, 1);
    }

    if (now - record.lastInteraction > this.trustDecayMs) {
      record.trustScore *= 0.9;
      record.trustScore = clamp(record.trustScore, 0, 1);
    }
  }

  mergeIdentityKeys(primaryKey, secondaryKey) {
    if (!this.store.has(primaryKey) && !this.store.has(secondaryKey)) return;

    const primary = this.store.get(primaryKey);
    const secondary = this.store.get(secondaryKey);

    if (primary && secondary) {
      primary.interactions += secondary.interactions;
      primary.trustScore = (primary.trustScore + secondary.trustScore) / 2;
      primary.lastInteraction = Math.max(primary.lastInteraction, secondary.lastInteraction);
    } else if (secondary) {
      this.store.set(primaryKey, { ...secondary, identityKey: primaryKey });
    }

    this.store.delete(secondaryKey);
  }

  clear(identityKey) {
    if (identityKey) {
      this.store.delete(identityKey);
    }
  }

  clearAll() {
    this.store.clear();
  }
}

module.exports = { RelationshipEngine };
