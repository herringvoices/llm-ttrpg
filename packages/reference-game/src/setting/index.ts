import type { Setting } from "@llm-ttrpg/engine";

export const awakeningEarthSetting: Setting = {
  identity: { id: "awakening-earth", version: "0.1.0" },
  description: "A deliberately tiny setting fixture for package contracts.",
  content: {
    entities: [
      {
        id: "setting.entity.awakening-earth",
        kind: "world",
        name: "Awakening Earth",
        summary: "A modern world changed by supernatural awakenings.",
        data: { technologyLevel: "modern" },
      },
      {
        id: "setting.entity.rage-tail",
        kind: "creature-type",
        name: "Rage-tail",
        summary: "A magically reinforced creature type.",
        data: { supernatural: true },
      },
    ],
    facts: [
      {
        id: "setting.fact.gates-public",
        subjectId: "setting.entity.awakening-earth",
        predicate: "world.has-gates",
        value: true,
        visibility: "public",
        tags: ["gates", "public-knowledge"],
      },
      {
        id: "setting.fact.gate-origin-hidden",
        subjectId: "setting.entity.awakening-earth",
        predicate: "gates.true-origin",
        value: "constructed-by-an-unknown-intelligence",
        visibility: "hidden",
        tags: ["gates", "secret"],
      },
      {
        id: "setting.fact.magical-reinforcement",
        subjectId: "setting.entity.rage-tail",
        predicate: "creature.magically-reinforced",
        value: true,
        visibility: "public",
        tags: ["creatures", "mechanical-mapping"],
      },
    ],
    events: [],
    documents: [
      {
        id: "setting.document.gate-field-guide",
        metadata: {
          title: "A Field Guide to Local Gates",
          kind: "field-guide",
          authors: ["Nashville Response Office"],
          tags: ["gates", "safety"],
          relatedEntityIds: ["setting.entity.awakening-earth"],
          visibility: "public",
          publishedAt: "2026-01-10T12:00:00.000Z",
        },
        summary:
          "A practical guide to recognizing gates and reporting unsafe activity.",
        sections: [
          {
            id: "recognition",
            title: "Recognizing a Gate",
            summary: "Common visual and environmental warning signs.",
            content:
              "Stable gates distort nearby light and produce a low vibration before opening.",
          },
          {
            id: "response",
            title: "Safe Civilian Response",
            summary: "How civilians should withdraw and report a gate.",
            content:
              "Leave the marked perimeter, avoid touching residue, and contact the response office.",
          },
        ],
      },
    ],
    beliefs: [],
  },
};

