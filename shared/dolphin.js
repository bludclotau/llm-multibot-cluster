const http = require("http");
const https = require("https");

const HEIDI_DOLPHIN = "http://10.1.1.122:8080/completion";
const SNERLOC_DOLPHIN = "http://10.1.1.7:8080/completion";

const ENDPOINTS = [HEIDI_DOLPHIN, SNERLOC_DOLPHIN];

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
    const transport = urlObj.protocol === "https:" ? https : http;

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

    const req = transport.request(options, (res) => {
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
  const errors = [];

  for (const endpoint of ENDPOINTS) {
    try {
      const data = await postJson(endpoint, {
        prompt,
        n_predict: nPredict
      }, timeoutMs);

      if (data && typeof data.content === "string") {
        return data.content.trim();
      }

      throw new Error("Unexpected response format");
    } catch (err) {
      errors.push(`${endpoint}: ${err.message}`);
    }
  }

  throw new Error(`All Dolphin nodes unreachable: ${errors.join("; ")}`);
}

module.exports = { dolphinInfer, buildPrompt, HEIDI_DOLPHIN, SNERLOC_DOLPHIN };
