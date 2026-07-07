const nodes = [
  {
    id: "nodeA",
    url: "http://10.1.1.7:8080",
    maxSlots: 1,
    initialLatencyMs: 2000
  },
  {
    id: "nodeB",
    url: "http://10.1.1.7:8081",
    maxSlots: 1,
    initialLatencyMs: 2000
  }
];

const routerOptions = {
  maxSlotsPerNode: 1,
  ewmaAlpha: 0.3,
  failureThreshold: 3,
  recoveryCheckMs: 15000,
  requestTimeoutMs: 60000,
  busyPenaltyMs: 5000
};

module.exports = { nodes, routerOptions };
