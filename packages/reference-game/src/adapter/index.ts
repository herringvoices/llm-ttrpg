import type { JsonValue, SettingAdapter } from "@llm-ttrpg/engine";
import { z } from "zod";
import { resolveActionInputSchema } from "../ruleset/action-operation.js";

const reinforcementMappingSchema = z
  .object({
    action: resolveActionInputSchema,
    reinforced: z.boolean(),
  })
  .strict();

function mapReinforcementToPerformance(source: JsonValue): unknown {
  const input = reinforcementMappingSchema.parse(source);
  return {
    ...input.action,
    performance: {
      ...input.action.performance,
      performanceModifiers: input.reinforced
        ? [
            ...input.action.performance.performanceModifiers,
            {
              id: "setting.magical-reinforcement",
              description:
                "The setting adapter maps established reinforcement to overall capability.",
              percent: 10,
            },
          ]
        : input.action.performance.performanceModifiers,
    },
  };
}

export const awakeningEarthReferenceAdapter: SettingAdapter = {
  identity: { id: "awakening-earth-reference-adapter", version: "0.1.0" },
  description:
    "Pair-specific mappings from Awakening Earth concepts into reusable reference-rules inputs.",
  ruleset: { id: "reference-rules", version: "0.2.0" },
  setting: { id: "awakening-earth", version: "0.1.0" },
  eventTypes: [],
  mappings: [
    {
      id: "adapter.mapping.magical-reinforcement",
      description:
        "Translate established magical reinforcement into a significant overall Performance modifier.",
      settingConceptId: "setting.fact.magical-reinforcement",
      operationId: "rules.actions.resolve-action",
      mapInput: mapReinforcementToPerformance,
    },
  ],
};
