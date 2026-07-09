function normalizeEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== "object") {
    return { platform: "unknown", identityKey: "unknown", content: "", user: {}, metadata: {}, timestamp: Date.now() };
  }

  const platform = rawEvent.platform || "unknown";
  const user = rawEvent.user || {};
  const content = typeof rawEvent.content === "string" ? rawEvent.content : "";
  const metadata = rawEvent.metadata || {};
  const timestamp = rawEvent.timestamp || Date.now();
  const identityKey = user.id ? `${platform}:${user.id}` : `${platform}:anonymous`;

  return { platform, identityKey, user, content, metadata, timestamp };
}

module.exports = { normalizeEvent };
