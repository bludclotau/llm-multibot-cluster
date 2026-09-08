export const nodes = [
  {
    id: "nodeA",
    url: "http://10.1.1.122:8081",
    model: "qwen2.5-7b-instruct-q4_k_m",
    maxSlots: 1,
    initialLatencyMs: 600
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
