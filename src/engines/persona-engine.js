export class PersonaEngine {
  constructor() {
    this.personas = {
      wendy: {
        style: "Wendy (warm, playful)",
      },
    };
  }

  getPersona(name) {
    return this.personas[name];
  }

  bindPersona(identityKey, personaName) {
    // not needed for minimal version
  }
}
