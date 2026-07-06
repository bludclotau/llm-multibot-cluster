// Global LLM request queue shared by all bots

let queue = [];
let processing = false;

async function processQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const job = queue.shift();
    try {
      const result = await job.fn();
      job.resolve(result);
    } catch (err) {
      job.reject(err);
    }
  }

  processing = false;
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    processQueue();
  });
}

module.exports = { enqueue };
