import type { PresentationConfig } from "@llm-ttrpg/engine";
import { awakeningEarthModernBaseline } from "../setting/index.js";

export const groundedDramaticPresentation: PresentationConfig = {
  identity: { id: "grounded-dramatic", version: "0.1.0" },
  description: "Grounded, dramatic narration for the tiny reference fixture.",
  narrationStyle:
    `Concrete sensory detail, restrained exposition, and no invented canonical facts. ${awakeningEarthModernBaseline} Never use medieval-fantasy scenery as generic shorthand for a rural or small-town location.`,
  terminology: {
    supernaturalRift: "Gate",
    empoweredPerson: "Awakened",
  },
  revealMechanics: "summary",
};
