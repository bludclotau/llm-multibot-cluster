export class WebBotOrchestrator {
  constructor({ personaEngine }) {
    this.personaEngine = personaEngine;
  }

  async handleEvent(event) {
    const persona = this.personaEngine.getPersona("wendy");
    const reply = `${persona.style}: ${event.content}`;
    return { text: reply };
  }
}
