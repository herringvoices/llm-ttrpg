import type { JsonValue, SettingAdapter } from "@llm-ttrpg/engine";
import { z } from "zod";
import { resolveActionInputSchema } from "../ruleset/action-operation.js";

const magicalResistanceMappingSchema = z
  .object({
    action: resolveActionInputSchema,
    magicalResistanceApplies: z.boolean(),
  })
  .strict();

function mapMagicalResistanceProvenance(source: JsonValue): unknown {
  const input = magicalResistanceMappingSchema.parse(source);
  if (!input.magicalResistanceApplies) return input.action;

  if (input.action.resistance.kind !== "fixed") {
    throw new Error(
      "Awakening Earth magical-resistance provenance currently maps only fixed Resistance; opposed supernatural integration remains part of issue #18.",
    );
  }

  return {
    ...input.action,
    resistance: {
      ...input.action.resistance,
      provenance: {
        ...input.action.resistance.provenance,
        sourceId: "setting.fact.magical-resistance",
        description:
          `${input.action.resistance.provenance.description}; includes Awakening Earth's established magic-resists-the-mundane interaction rule`,
      },
    },
  };
}

export const awakeningEarthReferenceAdapter: SettingAdapter = {
  identity: { id: "awakening-earth-reference-adapter", version: "0.2.0" },
  description:
    "Pair-specific bindings from Awakening Earth truths into reusable reference-rules inputs without inventing unset numeric setting mechanics.",
  ruleset: { id: "reference-rules", version: "0.2.0" },
  setting: { id: "awakening-earth", version: "0.2.0" },
  eventTypes: [],
  mappings: [
    {
      id: "adapter.mapping.magical-resistance-provenance",
      description:
        "Attach the canonical Awakening Earth magical-resistance fact to fixed Resistance provenance while leaving its numeric calibration to first-slice integration work.",
      settingConceptId: "setting.fact.magical-resistance",
      operationId: "rules.actions.resolve-action",
      mapInput: mapMagicalResistanceProvenance,
    },
  ],
};
