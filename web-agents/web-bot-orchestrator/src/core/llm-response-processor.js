function extractText(data) {
  if (!data) return "";

  if (typeof data.content === "string") {
    return data.content;
  }

  if (Array.isArray(data.choices) && data.choices.length > 0) {
    if (typeof data.choices[0].text === "string") {
      return data.choices[0].text;
    }
    if (data.choices[0].message && typeof data.choices[0].message.content === "string") {
      return data.choices[0].message.content;
    }
  }

  if (typeof data.response === "string") {
    return data.response;
  }

  return "";
}

function applyPlatformFormatting(text, platform) {
  if (!text) return text;

  if (platform === "discord") {
    text = text.replace(/@(everyone|here|someone)/gi, "@\u200B$1");
    text = text.replace(/<@!?(\d+)>/g, "<@\u200B$1>");
    text = text.replace(/\|\|/g, "\u200B|\u200B|");
    return text;
  }

  if (platform === "kick") {
    const lines = text.split("\n").filter(l => l.trim().length > 0);
    if (lines.length > 2) {
      text = lines.slice(0, 2).join("\n");
    }
    if (text.length > 500) {
      text = text.slice(0, 497) + "...";
    }
    return text;
  }

  if (platform === "reddit") {
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    text = paragraphs.join("\n\n");
    return text;
  }

  return text;
}

function applySafetyFilters(text) {
  if (!text) return text;

  text = text.replace(/\0/g, "");

  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  text = text.replace(/[\u200B-\u200F\uFEFF]/g, "");

  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/\r/g, "\n");

  text = text.replace(/[^\S\n]+/g, " ");

  text = text.replace(/\n{3,}/g, "\n\n");

  return Buffer.from(text, "utf8").toString("utf8");
}

function processLLMResponse(result, options = {}) {
  if (!result || !result.data) {
    return {
      text: "",
      nodeId: result?.nodeId || null,
      latencyMs: result?.latencyMs || null,
      meta: result?.meta || {}
    };
  }

  let text = extractText(result.data);

  text = text.trim();

  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/\r/g, "\n");

  text = text.replace(/\n{3,}/g, "\n\n");

  text = text.replace(/\s+$/, "");

  text = text.replace(/Assistant:\s*$/i, "");
  text = text.replace(/^Assistant:\s*/i, "");
  text = text.replace(/(\b\w+)(?:[\s\S]*?)?$/, (match, lastWord) => {
    if (lastWord.length < 3 && match.endsWith(":")) {
      return "";
    }
    return match;
  });

  const incompletePatterns = [
    /\.\.\.$/,
    /\w+:$/,
    /\w+…$/,
    /^[^a-zA-Z0-9]+$/
  ];

  for (const pattern of incompletePatterns) {
    if (pattern.test(text)) {
      text = text.replace(pattern, "").trimEnd();
    }
  }

  const platform = options.format || (result.meta && result.meta.platform) || null;
  text = applyPlatformFormatting(text, platform);

  text = applySafetyFilters(text);

  text = text.trim();

  return {
    text,
    nodeId: result.nodeId,
    latencyMs: result.latencyMs,
    meta: result.meta || {}
  };
}

module.exports = { processLLMResponse };
