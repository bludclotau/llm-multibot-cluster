const fs = require("fs").promises;
const path = "/home/snerloc/discord-bots/shared/llm.lock";

const LOCK_TIMEOUT_MS = 30000;   // max wait for lock
const RETRY_INTERVAL_MS = 100;   // retry every 100ms
const MAX_AGE_MS = 45000;        // auto-expire stale locks after 45s

async function isStaleLock() {
  try {
    const stat = await fs.stat(path);
    const age = Date.now() - stat.mtimeMs;
    return age > MAX_AGE_MS;
  } catch {
    return false;
  }
}

async function acquireLock() {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      await fs.mkdir(path);
      await fs.writeFile(path + "/meta.json", JSON.stringify({
        pid: process.pid,
        created: Date.now()
      }, null, 2));
      return true;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;

      if (await isStaleLock()) {
        await fs.rm(path, { recursive: true, force: true });
        continue;
      }

      await new Promise(r => setTimeout(r, RETRY_INTERVAL_MS));
    }
  }

  return false;
}

async function releaseLock() {
  try {
    await fs.rm(path, { recursive: true, force: true });
  } catch (err) {
    console.error("Failed to release lock:", err.message || err);
  }
}

module.exports = { acquireLock, releaseLock };
