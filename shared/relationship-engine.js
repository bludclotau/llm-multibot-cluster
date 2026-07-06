class RelationshipEngine {
  constructor(botName, allBots) {
    this.botName = botName;

    this.relationships = {};
    allBots.forEach(other => {
      if (other !== botName) {
        this.relationships[other] = {
          affinity: 0.5,
          tension: 0.0,
          trust: 0.5
        };
      }
    });
  }

  applyInteraction(otherBot, type) {
    const rel = this.relationships[otherBot];
    if (!rel) return;

    const adjust = (key, delta) => {
      rel[key] = Math.min(1, Math.max(0, rel[key] + delta));
    };

    const map = {
      "warm":   () => { adjust("affinity", +0.1); adjust("trust", +0.05); },
      "playful":() => { adjust("affinity", +0.05); },
      "chaotic":() => { adjust("tension", +0.1); },
      "rude":   () => { adjust("tension", +0.2); adjust("trust", -0.1); },
      "calm":   () => { adjust("tension", -0.05); adjust("trust", +0.05); },
      "support":() => { adjust("trust", +0.1); adjust("affinity", +0.05); }
    };

    if (map[type]) map[type]();
  }

  describe(otherBot) {
    const rel = this.relationships[otherBot];
    if (!rel) return "";

    return `
Affinity: ${rel.affinity.toFixed(2)}
Tension: ${rel.tension.toFixed(2)}
Trust: ${rel.trust.toFixed(2)}
`;
  }
}

module.exports = RelationshipEngine;
