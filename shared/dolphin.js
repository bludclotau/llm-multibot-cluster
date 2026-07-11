const http = require("http");

const SEQUENCER_URL = "http://127.0.0.1:3005/ask";

function buildPrompt(systemMessage, conversationHistory, userMessage) {
  let prompt = "";

  if (systemMessage) {
    prompt += `[System]\n${systemMessage}\n\n`;
  }

  if (Array.isArray(conversationHistory)) {
    for (const turn of conversationHistory) {
      if (turn.role === "user") {
        prompt += `[User]\n${turn.content}\n\n`;
      } else if (turn.role === "assistant") {
        prompt += `[Assistant]\n${turn.content}\n\n`;
      }
    }
  }

  if (userMessage) {
    prompt += `[User]\n${userMessage}\n\n`;
  }

  prompt += "[Assistant]\n";

  return prompt;
}

function postJson(url, data, timeoutMs) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);

    const body = JSON.stringify(data);

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      },
      timeout: timeoutMs || 60000
    };

    const req = http.request(options, (res) => {
      let chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString());
          resolve(parsed);
        } catch (e) {
          reject(new Error("Invalid JSON response"));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")); });
    req.write(body);
    req.end();
  });
}

async function dolphinInfer(prompt, nPredict = 256, timeoutMs = 60000) {
  const data = await postJson(SEQUENCER_URL, {
    bot: "dolphin",
    prompt
  }, timeoutMs);

  if (data && typeof data.reply === "string") {
    return data.reply.trim();
  }

  throw new Error("Sequencer returned unexpected response format");
}

module.exports = { dolphinInfer, buildPrompt };
