const nodes = [
  {
    id: "nodeA",
    url: "http://10.1.1.122:8081",
    maxSlots: 1,
    initialLatencyMs: 600
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
