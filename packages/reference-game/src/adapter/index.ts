import type { JsonValue, SettingAdapter } from "@llm-ttrpg/engine";

function mapReinforcementToEffort(source: JsonValue): unknown {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    throw new Error("Reinforcement mapping requires an object input");
  }
  const actorId = source.actorId;
  const base = source.base;
  const difficulty = source.difficulty;
  if (
    typeof actorId !== "string" ||
    typeof base !== "number" ||
    typeof difficulty !== "number"
  ) {
    throw new Error("Reinforcement mapping input is malformed");
  }
  return {
    actorId,
    base,
    modifier: source.reinforced === true ? 2 : 0,
    difficulty,
  };
}

export const awakeningEarthReferenceAdapter: SettingAdapter = {
  identity: { id: "awakening-earth-reference-adapter", version: "0.1.0" },
  description:
    "Minimal pair-specific mapping between Awakening Earth and the reference rules fixture.",
  ruleset: { id: "reference-rules", version: "0.1.0" },
  setting: { id: "awakening-earth", version: "0.1.0" },
  mappings: [
    {
      id: "adapter.mapping.magical-reinforcement",
      description:
        "Translate fictional magical reinforcement into a rules modifier.",
      settingConceptId: "setting.fact.magical-reinforcement",
      operationId: "rules.actions.resolve-effort",
      mapInput: mapReinforcementToEffort,
    },
  ],
};
