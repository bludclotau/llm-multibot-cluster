export const nodes = [
  {
    id: "nodeA",
    url: "http://10.1.1.7:8080",
    model: "/home/snerloc/models/uncensored/llama-3.1-70b-uncensored.gguf",
    maxSlots: 1,
    initialLatencyMs: 2000
  },
  {
    id: "nodeB",
    url: "http://10.1.1.7:8081",
    model: "/home/snerloc/models/uncensored/llama-3.1-70b-uncensored.gguf",
    maxSlots: 1,
    initialLatencyMs: 2000
  }
];

export const routerOptions = {
  maxSlotsPerNode: 1,
  ewmaAlpha: 0.3,
  failureThreshold: 3,
  recoveryCheckMs: 15000,
  requestTimeoutMs: 60000,
  busyPenaltyMs: 5000
};
