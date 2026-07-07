const DEFAULT_PERSONA = {
  id: "default",
  description: "General-purpose helpful assistant.",
  styleRules: ["be concise", "be friendly"],
  defaultTone: "neutral"
};

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

class PersonaEngine {
  constructor(config = {}) {
    this.personas = {};

    const profiles = Array.isArray(config) ? config : (config.personas || []);
    for (const profile of profiles) {
      if (profile && profile.id) {
        this.personas[profile.id] = clone(profile);
      }
    }
  }

  getPersona(personaId) {
    if (personaId && this.personas[personaId]) {
      return this.personas[personaId];
    }

    return clone(DEFAULT_PERSONA);
  }

  getState(event) {
    const personaId = (event?.context?.raw?.personaId) || "default";
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
