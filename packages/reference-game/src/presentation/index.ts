import type { PresentationConfig } from "@llm-ttrpg/engine";

export const groundedDramaticPresentation: PresentationConfig = {
  identity: { id: "grounded-dramatic", version: "0.1.0" },
  description: "Grounded, dramatic narration for the tiny reference fixture.",
  narrationStyle:
    "Concrete sensory detail, restrained exposition, and no invented canonical facts.",
  terminology: {
    supernaturalRift: "Gate",
    empoweredPerson: "Awakened",
  },
  revealMechanics: "summary",
};

