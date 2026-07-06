class EmotionalState {
  constructor(baseline = "neutral") {
    this.baseline = baseline;
    this.state = baseline;
    this.intensity = 0.3;
    this.lastUpdate = Date.now();
  }

  applyTrigger(trigger) {
    const map = {
      warm: "affection",
      rude: "annoyed",
      chaotic: "excited",
      calm: "soothing",
      stressed: "concerned",
      playful: "mischievous"
    };

    const newState = map[trigger] || this.baseline;

    this.intensity = Math.min(1, this.intensity + 0.2);
    this.state = newState;
    this.lastUpdate = Date.now();
  }

  decay() {
    const now = Date.now();
    const elapsed = (now - this.lastUpdate) / 1000;

    if (elapsed > 30) {
      this.intensity = Math.max(0.3, this.intensity - 0.1);
      if (this.intensity <= 0.3) {
        this.state = this.baseline;
      }
      this.lastUpdate = now;
    }
  }

  describe() {
    return `${this.state} (intensity ${this.intensity.toFixed(2)})`;
  }
}

module.exports = EmotionalState;
