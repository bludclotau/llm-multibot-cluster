const PERSONAS = [
  {
    id: "default",
    description: "General-purpose helpful assistant.",
    styleRules: ["be concise", "be friendly"],
    defaultTone: "neutral"
  },
  {
    id: "wendy",
    style: "warm, playful, slightly chaotic, supportive, chatty",
    rules: [
      "Always speak casually.",
      "Use expressive tone.",
      "Be friendly and energetic.",
      "Avoid formal language.",
      "Never mention being an AI.",
      "Never break character."
    ]
  }
];

function clone(obj) {
  if (obj === null || typeof obj !== "object") return obj;

  const copy = Array.isArray(obj) ? [] : {};

  for (const key of Object.keys(obj)) {
    const value = obj[key];

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      copy[key] = clone(value);
    } else if (Array.isArray(value)) {
      copy[key] = value.slice();
    } else {
      copy[key] = value;
    }
  }

  return copy;
}

function applyPlatformOverrides(persona, platform) {
  if (!platform) return persona;

  const overrides = persona.platformOverrides && persona.platformOverrides[platform];
  if (!overrides) return persona;

  const result = clone(persona);

  if (Array.isArray(overrides.styleRules)) {
    result.styleRules = overrides.styleRules.slice();
  }

  if (typeof overrides.defaultTone === "string") {
    result.defaultTone = overrides.defaultTone;
  }

  return result;
}

function normalizePersona(raw) {
  if (raw.description && Array.isArray(raw.styleRules)) return raw;

  const p = { id: raw.id };

  if (raw.style) {
    p.description = raw.style;
  } else {
    p.description = raw.description || "General-purpose helpful assistant.";
  }

  p.styleRules = Array.isArray(raw.rules) ? raw.rules.slice() : (Array.isArray(raw.styleRules) ? raw.styleRules.slice() : ["be concise", "be friendly"]);

  p.defaultTone = raw.defaultTone || "neutral";

  return p;
}

class PersonaEngine {
  constructor(config = {}) {
    this.personas = {};
    this.bindings = {};

    const builtins = PERSONAS.map(normalizePersona);
    for (const p of builtins) {
      this.personas[p.id] = p;
    }

    const profiles = Array.isArray(config) ? config : (config.personas || []);
    for (const profile of profiles) {
      if (profile && profile.id) {
        this.personas[profile.id] = normalizePersona(clone(profile));
      }
    }
  }

  getPersona(personaId) {
    if (personaId && this.personas[personaId]) {
      return this.personas[personaId];
    }

    return clone(this.personas.default);
  }

  bindPersona(identityKey, personaId) {
    this.bindings[identityKey] = personaId;
  }

  getState(event) {
    let personaId = null;

    if (event?.identityKey && this.bindings[event.identityKey]) {
      personaId = this.bindings[event.identityKey];
    } else {
      for (const key of Object.keys(this.bindings)) {
        if (key.startsWith(`${event?.platform || ""}:`)) {
          personaId = this.bindings[key];
          break;
        }
      }
    }

    if (!personaId) {
      personaId = (event?.context?.raw?.personaId) || "default";
    }

    const platform = event?.context?.platform || null;
    const rawPersona = this.getPersona(personaId);
    const persona = applyPlatformOverrides(rawPersona, platform);

    return {
      personaId: persona.id,
      description: persona.description,
      styleRules: Array.isArray(persona.styleRules) ? persona.styleRules.slice() : [],
      tone: persona.defaultTone
    };
  }
}

module.exports = { PersonaEngine };
