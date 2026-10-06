import type { PresentationConfig } from "@llm-ttrpg/engine";
import { awakeningEarthModernBaseline } from "../setting/index.js";

export const groundedDramaticPresentation: PresentationConfig = {
  identity: { id: "grounded-dramatic", version: "0.1.0" },
  description: "Grounded, dramatic narration for the tiny reference fixture.",
  narrationProfile: {
    identity: { id: "awakening-earth-grounded", version: "1.0.0" },
    perspective: { person: "second", tense: "present", camera: "player-limited" },
    playerAgency: {
      inventVoluntaryActions: false,
      inventDialogue: false,
      inventThoughtsFeelingsOrDecisions: false,
      describeGroundedInvoluntaryConsequences: true,
    },
    knowledge: {
      playerObservableOnly: true,
      revealPrivateCognition: false,
      revealHiddenPlans: false,
    },
    voice: {
      tone: ["grounded", "contemporary", "dramatic without melodrama"],
      proseTendencies: [
        "prefer concrete mundane detail that makes supernatural strangeness stand out",
        "use restrained exposition and return control at a meaningful choice",
        awakeningEarthModernBaseline,
      ],
      humor: "Use dry or light humor only when it fits the established scene.",
      diction: "Clear contemporary language; never use medieval-fantasy scenery as rural shorthand.",
      avoid: ["ornate filler", "genre clichés", "GM commentary", "meta-level questions"],
    },
    description: {
      sensoryDetail: "Use a few specific, player-observable sensory details.",
      expositionDensity: "Keep exposition restrained and subordinate to the immediate situation.",
      environment: "Emphasize ordinary modern surroundings where they clarify contrast or affordances.",
      spatialClarity: "Keep positions, motion, threats, and exits clear when pressure is high.",
    },
    dialogue: {
      preserveNpcVoice: true,
      attribution: "Use natural attribution; avoid repetitive speech tags.",
      preserveQuotedPlayerSpeechVerbatim: true,
    },
    authority: {
      reminder: "Narration renders authorized, committed, player-visible material and never changes canonical truth, mechanics, time, or actor decisions.",
      transientColorPolicy: "Harmless sensory texture may be added only when it creates no durable fact or reasonable new interaction.",
      actionableDetailPolicy: "Do not invent an object, route, hazard, witness, resource, clue, or other detail a player could reasonably use next.",
    },
    exemplars: [
      {
        id: "awakening-earth.example.conversation",
        sceneKinds: ["conversation"],
        text: "Mara folds the receipt once, precisely. “I saw the lights too,” she says, keeping her voice below the refrigerator's hum. She watches you, waiting.",
      },
      {
        id: "awakening-earth.example.exploration",
        sceneKinds: ["opening", "exploration"],
        text: "The service road ends at a locked chain-link gate. Beyond it, sodium lamps wash the loading yard in orange, except for one clean circle of darkness beneath the water tower.",
      },
      {
        id: "awakening-earth.example.danger",
        sceneKinds: ["action", "immediate-danger"],
        text: "The shelving tips toward you. Glass bursts across the tile, and the aisle narrows to the gap beside the freezer before the full weight comes down.",
      },
      {
        id: "awakening-earth.example.compressed",
        sceneKinds: ["compressed-duration"],
        text: "By late afternoon, the calls have given you three matching details and one useful address. The storm has moved east; traffic is beginning to thicken on the highway.",
      },
    ],
  },
  terminology: {
    supernaturalRift: "Gate",
    empoweredPerson: "Awakened",
  },
  revealMechanics: "summary",
};
